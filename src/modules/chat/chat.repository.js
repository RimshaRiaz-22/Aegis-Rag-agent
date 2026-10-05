import { pool } from '../../config/database.js';
import { encryptJson, decryptJson } from '../../utils/crypto.js';

const aad = (userId, threadId) => `chat_thread:${userId}:${threadId}`;

export const chatThreadRepository = {
  async getThreadsByUser(userId) {
    const query = `
      SELECT id, payload_encrypted, created_at, updated_at
      FROM chat_threads
      WHERE user_id = $1
      ORDER BY updated_at DESC;
    `;
    const { rows } = await pool.query(query, [userId]);
    return rows.map((r) => {
      const data = decryptJson(r.payload_encrypted, aad(userId, r.id), {});
      return {
        id: r.id,
        title: data?.title || 'New Thread',
        messages: Array.isArray(data?.messages) ? data.messages : [],
        createdAt: data?.createdAt || r.created_at,
        updatedAt: r.updated_at,
      };
    });
  },

  async upsertThread(userId, thread) {
    const threadId = String(thread.id || `session_${Date.now()}`);
    const payload = {
      id: threadId,
      title: thread.title || 'New Thread',
      messages: Array.isArray(thread.messages) ? thread.messages : [],
      createdAt: thread.createdAt || new Date().toISOString(),
    };
    const ciphertext = encryptJson(payload, aad(userId, threadId));

    const query = `
      INSERT INTO chat_threads (id, user_id, payload_encrypted, updated_at)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id, id)
      DO UPDATE SET payload_encrypted = EXCLUDED.payload_encrypted, updated_at = CURRENT_TIMESTAMP
      RETURNING id, updated_at;
    `;
    await pool.query(query, [threadId, userId, ciphertext]);
    return payload;
  },

  async saveAllThreads(userId, threads) {
    if (!Array.isArray(threads)) return [];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const results = [];
      for (const t of threads) {
        if (!t || !t.id) continue;
        const threadId = String(t.id);
        const payload = {
          id: threadId,
          title: t.title || 'New Thread',
          messages: Array.isArray(t.messages) ? t.messages : [],
          createdAt: t.createdAt || new Date().toISOString(),
        };
        const ciphertext = encryptJson(payload, aad(userId, threadId));
        await client.query(
          `INSERT INTO chat_threads (id, user_id, payload_encrypted, updated_at)
           VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
           ON CONFLICT (user_id, id)
           DO UPDATE SET payload_encrypted = EXCLUDED.payload_encrypted, updated_at = CURRENT_TIMESTAMP;`,
          [threadId, userId, ciphertext]
        );
        results.push(payload);
      }
      await client.query('COMMIT');
      return results;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async deleteThread(userId, threadId) {
    const query = `
      DELETE FROM chat_threads
      WHERE user_id = $1 AND id = $2
      RETURNING id;
    `;
    const { rows } = await pool.query(query, [userId, String(threadId)]);
    return rows[0] || null;
  },
};
