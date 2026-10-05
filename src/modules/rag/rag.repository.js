import { pool } from '../../config/database.js';
import pgvector from 'pgvector/pg';
import { normalizeNamespace } from '../../utils/namespace.js';

export const ragRepository = {
  /**
   * Cosine similarity vector search on document_chunks via pgvector.
   *
   * IMPORTANT: The similarity threshold is applied AFTER fetching top-K results,
   * not inside the SQL WHERE clause. This prevents the threshold from wiping out
   * all results when using embedding models with compressed score ranges (e.g.
   * nvidia/nemotron-3-embed produces scores of 0.02–0.15, not 0.3+).
   *
   * Namespace is normalized to underscores to match the ingest normalization.
   */
  async searchSimilarChunks({
    queryVector,
    userId,
    namespace = null,
    topK = 4,
    similarityThreshold = 0.0,
  }) {
    const vectorSql = pgvector.toSql(queryVector);
    const normalizedNs = normalizeNamespace(namespace);

    let rows = [];

    // 1. If namespace specified, attempt search within that specific namespace
    if (normalizedNs) {
      const queryWithNs = `
        SELECT
          c.id,
          c.document_id,
          d.filename,
          c.chunk_index,
          c.content,
          c.metadata,
          ROUND((1 - (c.embedding <=> $1::vector))::numeric, 6) AS similarity_score
        FROM document_chunks c
        JOIN documents d ON c.document_id = d.id
        JOIN knowledge_bases kb ON c.kb_id = kb.id
        WHERE (c.user_id = $2 OR kb.user_id = $2)
          AND c.embedding IS NOT NULL
          AND vector_dims(c.embedding) = vector_dims($1::vector)
          AND kb.namespace = $3
        ORDER BY c.embedding <=> $1::vector ASC
        LIMIT $4;
      `;
      const res = await pool.query(queryWithNs, [vectorSql, userId, normalizedNs, topK]);
      rows = res.rows;
    }

    // 2. If no chunks found in the specific namespace or no namespace was passed,
    //    search across all verified knowledge bases owned by this user
    if (rows.length === 0) {
      const queryAllOwnerKbs = `
        SELECT
          c.id,
          c.document_id,
          d.filename,
          c.chunk_index,
          c.content,
          c.metadata,
          ROUND((1 - (c.embedding <=> $1::vector))::numeric, 6) AS similarity_score
        FROM document_chunks c
        JOIN documents d ON c.document_id = d.id
        JOIN knowledge_bases kb ON c.kb_id = kb.id
        WHERE (c.user_id = $2 OR kb.user_id = $2)
          AND c.embedding IS NOT NULL
          AND vector_dims(c.embedding) = vector_dims($1::vector)
        ORDER BY c.embedding <=> $1::vector ASC
        LIMIT $3;
      `;
      const res = await pool.query(queryAllOwnerKbs, [vectorSql, userId, topK]);
      rows = res.rows;
    }

    // Apply threshold in application layer (after seeing actual score distribution)
    let filtered = rows.filter(r => parseFloat(r.similarity_score) >= similarityThreshold);

    // If threshold filtered out all chunks, but we have valid candidate chunks in this user's workspace:
    // Models like nvidia/nemotron-3-embed-1b produce lower absolute cosine similarity numbers (0.10-0.25)
    // especially for high-level/summary questions ("summarize key documents", "overview").
    // Auto-retain the top candidate chunks (with positive similarity) so the LLM is never starved of context.
    if (filtered.length === 0 && rows.length > 0 && parseFloat(rows[0].similarity_score) > 0) {
      console.log(
        `[pgvector] Threshold ${similarityThreshold} yielded 0 results. Auto-retaining top ${Math.min(rows.length, topK)} candidates (top score: ${rows[0].similarity_score})`
      );
      filtered = rows.slice(0, topK);
    }

    console.log(
      `[pgvector] Top-${topK} results: ${rows.length} found, ${filtered.length} retained (threshold ${similarityThreshold})` +
      (rows.length > 0 ? ` | top score=${rows[0].similarity_score}` : '')
    );

    return filtered.map((r) => ({
      id: r.id,
      docId: r.document_id,
      filename: r.filename,
      chunkIndex: r.chunk_index,
      content: r.content,
      metadata: r.metadata,
      score: parseFloat(r.similarity_score),
    }));
  },

  /**
   * Save conversation message
   */
  async saveMessage({ sessionId, userId, role, content, citations = [], tokensUsed = 0 }) {
    const query = `
      INSERT INTO chat_messages (session_id, user_id, role, content, citations, tokens_used)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *;
    `;
    const { rows } = await pool.query(query, [
      sessionId,
      userId,
      role,
      content,
      JSON.stringify(citations),
      tokensUsed,
    ]);
    return rows[0];
  },

  /**
   * Find or create chat session
   */
  async getOrCreateSession(userId, sessionId = null, title = 'New Conversation') {
    if (sessionId) {
      const query = `SELECT * FROM chat_sessions WHERE id = $1 AND user_id = $2;`;
      const { rows } = await pool.query(query, [sessionId, userId]);
      if (rows[0]) return rows[0];
    }

    const insertQuery = `
      INSERT INTO chat_sessions (user_id, title)
      VALUES ($1, $2)
      RETURNING *;
    `;
    const { rows } = await pool.query(insertQuery, [userId, title]);
    return rows[0];
  },
};
