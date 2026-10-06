import { pool } from '../../config/database.js';
import pgvector from 'pgvector/pg';
import { normalizeNamespace } from '../../utils/namespace.js';

export const ragRepository = {
  /**
   * Enterprise Hybrid Search: Dense Vector (pgvector Cosine Similarity) +
   * Sparse Lexical Full-Text Search (PostgreSQL tsvector / BM25) combined via
   * Reciprocal Rank Fusion (RRF).
   *
   * RRF Formula: Score(d) = Σ [ 1 / (rrfK + rank_i(d)) ]
   * Default rrfK = 60 (standard in state-of-the-art information retrieval).
   */
  async searchSimilarChunks({
    queryText = '',
    queryVector = null,
    userId,
    namespace = null,
    topK = 4,
    similarityThreshold = 0.0,
    rrfK = 60,
  }) {
    const normalizedNs = normalizeNamespace(namespace);
    const candidateLimit = Math.max(topK * 3, 15);

    // Run dense vector search and sparse lexical search concurrently for maximum throughput & lowest latency
    const vectorSearchPromise = (async () => {
      if (!queryVector || !Array.isArray(queryVector)) return [];
      try {
        const vectorSql = pgvector.toSql(queryVector);

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
          const res = await pool.query(queryWithNs, [vectorSql, userId, normalizedNs, candidateLimit]);
          if (res.rows.length > 0) return res.rows;
        }

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
        const res = await pool.query(queryAllOwnerKbs, [vectorSql, userId, candidateLimit]);
        return res.rows;
      } catch (vecErr) {
        console.warn('[Hybrid Search] Dense vector query warning:', vecErr.message);
        return [];
      }
    })();

    const textSearchPromise = (async () => {
      const cleanTextQuery = (queryText || '').replace(/[^a-zA-Z0-9\s"'-]/g, ' ').trim();
      if (cleanTextQuery.length <= 1) return [];

      try {
        if (normalizedNs) {
          const ftsWithNs = `
            SELECT
              c.id,
              c.document_id,
              d.filename,
              c.chunk_index,
              c.content,
              c.metadata,
              ROUND(ts_rank_cd(to_tsvector('english', c.content), websearch_to_tsquery('english', $1))::numeric, 6) AS text_score
            FROM document_chunks c
            JOIN documents d ON c.document_id = d.id
            JOIN knowledge_bases kb ON c.kb_id = kb.id
            WHERE (c.user_id = $2 OR kb.user_id = $2)
              AND to_tsvector('english', c.content) @@ websearch_to_tsquery('english', $1)
              AND kb.namespace = $3
            ORDER BY text_score DESC
            LIMIT $4;
          `;
          const res = await pool.query(ftsWithNs, [cleanTextQuery, userId, normalizedNs, candidateLimit]);
          if (res.rows.length > 0) return res.rows;
        }

        const ftsAllOwnerKbs = `
          SELECT
            c.id,
            c.document_id,
            d.filename,
            c.chunk_index,
            c.content,
            c.metadata,
            ROUND(ts_rank_cd(to_tsvector('english', c.content), websearch_to_tsquery('english', $1))::numeric, 6) AS text_score
          FROM document_chunks c
          JOIN documents d ON c.document_id = d.id
          JOIN knowledge_bases kb ON c.kb_id = kb.id
          WHERE (c.user_id = $2 OR kb.user_id = $2)
            AND to_tsvector('english', c.content) @@ websearch_to_tsquery('english', $1)
          ORDER BY text_score DESC
          LIMIT $3;
        `;
        const res = await pool.query(ftsAllOwnerKbs, [cleanTextQuery, userId, candidateLimit]);
        return res.rows;
      } catch (textErr) {
        // Fallback to plainto_tsquery if websearch syntax fails on special tokens
        try {
          const fallbackSql = `
            SELECT
              c.id,
              c.document_id,
              d.filename,
              c.chunk_index,
              c.content,
              c.metadata,
              ROUND(ts_rank_cd(to_tsvector('english', c.content), plainto_tsquery('english', $1))::numeric, 6) AS text_score
            FROM document_chunks c
            JOIN documents d ON c.document_id = d.id
            JOIN knowledge_bases kb ON c.kb_id = kb.id
            WHERE (c.user_id = $2 OR kb.user_id = $2)
              AND to_tsvector('english', c.content) @@ plainto_tsquery('english', $1)
            ORDER BY text_score DESC
            LIMIT $3;
          `;
          const res = await pool.query(fallbackSql, [cleanTextQuery, userId, candidateLimit]);
          return res.rows;
        } catch (fbErr) {
          console.warn('[Hybrid Search] Full-text query fallback warning:', fbErr.message);
          return [];
        }
      }
    })();

    const [vectorRows, textRows] = await Promise.all([vectorSearchPromise, textSearchPromise]);

    // 3. Reciprocal Rank Fusion (RRF) Merger
    // Maps each unique chunk ID to its merged score and metadata
    const fusedMap = new Map();

    // Dense Vector Ranks: rank 1, 2, 3...
    vectorRows.forEach((row, idx) => {
      const rank = idx + 1;
      const rrfContribution = 1 / (rrfK + rank);
      fusedMap.set(row.id, {
        id: row.id,
        docId: row.document_id,
        filename: row.filename,
        chunkIndex: row.chunk_index,
        content: row.content,
        metadata: row.metadata,
        vectorScore: parseFloat(row.similarity_score) || 0,
        textScore: 0,
        rrfScore: rrfContribution,
        matchedIn: ['vector'],
      });
    });

    // Sparse Full-Text Ranks: rank 1, 2, 3...
    textRows.forEach((row, idx) => {
      const rank = idx + 1;
      const rrfContribution = 1 / (rrfK + rank);

      if (fusedMap.has(row.id)) {
        const existing = fusedMap.get(row.id);
        existing.rrfScore += rrfContribution;
        existing.textScore = parseFloat(row.text_score) || 0;
        existing.matchedIn.push('text');
      } else {
        fusedMap.set(row.id, {
          id: row.id,
          docId: row.document_id,
          filename: row.filename,
          chunkIndex: row.chunk_index,
          content: row.content,
          metadata: row.metadata,
          vectorScore: 0,
          textScore: parseFloat(row.text_score) || 0,
          rrfScore: rrfContribution,
          matchedIn: ['text'],
        });
      }
    });

    // Convert map to sorted candidate list
    const candidates = Array.from(fusedMap.values()).sort((a, b) => b.rrfScore - a.rrfScore);

    // Apply similarity threshold if vector results present
    let filtered = candidates;
    if (similarityThreshold > 0) {
      filtered = candidates.filter((c) => {
        // If matched both or matched full-text with keywords, keep
        if (c.matchedIn.includes('text') && c.textScore > 0.05) return true;
        return c.vectorScore >= similarityThreshold;
      });
    }

    // Auto-retain top candidate chunks so context is preserved
    if (filtered.length === 0 && candidates.length > 0) {
      filtered = candidates.slice(0, topK);
    }

    const finalResults = filtered.slice(0, topK).map((r) => ({
      id: r.id,
      docId: r.docId,
      filename: r.filename,
      chunkIndex: r.chunkIndex,
      content: r.content,
      metadata: r.metadata,
      score: r.vectorScore > 0 ? r.vectorScore : Math.min(1.0, r.rrfScore * 30),
      hybridMeta: {
        rrfScore: Math.round(r.rrfScore * 10000) / 10000,
        matchedIn: r.matchedIn,
      },
    }));

    console.log(
      `[Hybrid RRF Search] Top-${topK}: ${vectorRows.length} vector candidates, ${textRows.length} text candidates -> ${candidates.length} fused -> ${finalResults.length} selected.`
    );

    return finalResults;
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
