import { pool } from '../../config/database.js';
import pgvector from 'pgvector/pg';

export const knowledgeRepository = {
  async getOrCreateKnowledgeBase(userId, namespace = 'default', name = 'Default Collection') {
    const query = `
      INSERT INTO knowledge_bases (user_id, namespace, name)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, namespace)
      DO UPDATE SET updated_at = CURRENT_TIMESTAMP
      RETURNING id, user_id, namespace, name, embedding_model, embedding_dimension;
    `;
    const { rows } = await pool.query(query, [userId, namespace, name]);
    return rows[0];
  },

  async createDocument({ id, kbId, userId, filename, fileType, fileSize, chunkCount, tags, status = 'ready' }) {
    // Validate UUID format — if the provided id is not a valid UUID (e.g. frontend sends
    // "doc_1790937130801_cev3"), pass null so PostgreSQL generates a proper UUID via gen_random_uuid().
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const validId = id && UUID_REGEX.test(id) ? id : null;

    const query = `
      INSERT INTO documents (id, kb_id, user_id, filename, file_type, file_size, chunk_count, tags, status)
      VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *;
    `;
    const { rows } = await pool.query(query, [
      validId,
      kbId,
      userId,
      filename,
      fileType,
      fileSize,
      chunkCount,
      JSON.stringify(tags || []),
      status,
    ]);
    return rows[0];
  },

  async insertDocumentChunks(chunksData) {
    if (!chunksData || chunksData.length === 0) return [];

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const insertedChunks = [];
      const BATCH_SIZE = 50;

      for (let i = 0; i < chunksData.length; i += BATCH_SIZE) {
        const batch = chunksData.slice(i, i + BATCH_SIZE);
        const valueClauses = [];
        const params = [];
        let paramIdx = 1;

        for (const item of batch) {
          const embeddingSql = item.embedding ? pgvector.toSql(item.embedding) : null;
          valueClauses.push(
            `($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6})`
          );
          params.push(
            item.documentId,
            item.kbId,
            item.userId,
            item.chunkIndex,
            item.content,
            JSON.stringify(item.metadata || {}),
            embeddingSql
          );
          paramIdx += 7;
        }

        const batchQuery = `
          INSERT INTO document_chunks (document_id, kb_id, user_id, chunk_index, content, metadata, embedding)
          VALUES ${valueClauses.join(', ')}
          RETURNING id, document_id, chunk_index, content, metadata;
        `;

        const { rows } = await client.query(batchQuery, params);
        insertedChunks.push(...rows);
      }

      await client.query('COMMIT');
      return insertedChunks;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async listDocumentsByUser(userId, namespace = null) {
    let query = `
      SELECT d.*, kb.namespace, kb.name as kb_name,
        COALESCE(
          json_agg(
            json_build_object(
              'id', dc.id,
              'chunkIndex', dc.chunk_index,
              'content', dc.content,
              'metadata', dc.metadata
            ) ORDER BY dc.chunk_index ASC
          ) FILTER (WHERE dc.id IS NOT NULL),
          '[]'
        ) as chunks
      FROM documents d
      JOIN knowledge_bases kb ON d.kb_id = kb.id
      LEFT JOIN document_chunks dc ON dc.document_id = d.id
      WHERE d.user_id = $1
    `;
    const params = [userId];

    if (namespace) {
      params.push(namespace);
      query += ` AND kb.namespace = $2`;
    }

    query += ` GROUP BY d.id, kb.namespace, kb.name ORDER BY d.created_at DESC;`;

    const { rows } = await pool.query(query, params);
    return rows;
  },

  async getDocumentById(docId, userId) {
    const docQuery = `
      SELECT d.*, kb.namespace
      FROM documents d
      JOIN knowledge_bases kb ON d.kb_id = kb.id
      WHERE d.id = $1 AND d.user_id = $2;
    `;
    const { rows: docRows } = await pool.query(docQuery, [docId, userId]);
    if (docRows.length === 0) return null;

    const doc = docRows[0];

    const chunksQuery = `
      SELECT id, chunk_index, content, metadata, created_at
      FROM document_chunks
      WHERE document_id = $1
      ORDER BY chunk_index ASC;
    `;
    const { rows: chunkRows } = await pool.query(chunksQuery, [docId]);
    doc.chunks = chunkRows;

    return doc;
  },

  async deleteDocument(docId, userId) {
    // Reject non-UUID IDs immediately to avoid PostgreSQL type errors
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!docId || !UUID_REGEX.test(docId)) {
      return null;
    }
    const query = `
      DELETE FROM documents
      WHERE id = $1 AND user_id = $2
      RETURNING id, filename;
    `;
    const { rows } = await pool.query(query, [docId, userId]);
    return rows[0] || null;
  },
};
