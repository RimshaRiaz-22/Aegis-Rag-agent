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
      for (const item of chunksData) {
        const query = `
          INSERT INTO document_chunks (document_id, kb_id, user_id, chunk_index, content, metadata, embedding)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id, document_id, chunk_index, content, metadata;
        `;
        const embeddingSql = item.embedding ? pgvector.toSql(item.embedding) : null;
        const { rows } = await client.query(query, [
          item.documentId,
          item.kbId,
          item.userId,
          item.chunkIndex,
          item.content,
          JSON.stringify(item.metadata || {}),
          embeddingSql,
        ]);
        insertedChunks.push(rows[0]);
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
      SELECT d.*, kb.namespace, kb.name as kb_name
      FROM documents d
      JOIN knowledge_bases kb ON d.kb_id = kb.id
      WHERE d.user_id = $1
    `;
    const params = [userId];

    if (namespace) {
      params.push(namespace);
      query += ` AND kb.namespace = $2`;
    }

    query += ` ORDER BY d.created_at DESC;`;

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
