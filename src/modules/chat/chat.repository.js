import { pool } from '../../config/database.js';
import { encryptJson, decryptJson } from '../../utils/crypto.js';

const aad = (userId, threadId) => `chat_thread:${userId}:${threadId}`;

export const chatThreadRepository = {
  async getThreadsByUser(userId) {
    const query = `
      SELECT id, payload_encrypted, is_pinned, created_at, updated_at
      FROM chat_threads
      WHERE user_id = $1
      ORDER BY is_pinned DESC, updated_at DESC;
    `;
    const { rows } = await pool.query(query, [userId]);
    return rows.map((r) => {
      const data = decryptJson(r.payload_encrypted, aad(userId, r.id), {});
      return {
        id: r.id,
        title: data?.title || 'New Thread',
        isPinned: Boolean(r.is_pinned ?? data?.isPinned),
        messages: Array.isArray(data?.messages) ? data.messages : [],
        createdAt: data?.createdAt || r.created_at,
        updatedAt: r.updated_at,
      };
    });
  },

  async upsertThread(userId, thread) {
    const threadId = String(thread.id || `session_${Date.now()}`);
    const isPinned = Boolean(thread.isPinned);
    const payload = {
      id: threadId,
      title: thread.title || 'New Thread',
      isPinned,
      messages: Array.isArray(thread.messages) ? thread.messages : [],
      createdAt: thread.createdAt || new Date().toISOString(),
    };
    const ciphertext = encryptJson(payload, aad(userId, threadId));

    const query = `
      INSERT INTO chat_threads (id, user_id, payload_encrypted, is_pinned, updated_at)
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id, id)
      DO UPDATE SET
        payload_encrypted = EXCLUDED.payload_encrypted,
        is_pinned = EXCLUDED.is_pinned,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id, is_pinned, updated_at;
    `;
    await pool.query(query, [threadId, userId, ciphertext, isPinned]);
    return payload;
  },

  async togglePin(userId, threadId, explicitState = null) {
    const threadIdStr = String(threadId);
    let nextPinnedState = explicitState;

    if (nextPinnedState === null) {
      const checkRes = await pool.query(
        `SELECT is_pinned, payload_encrypted FROM chat_threads WHERE user_id = $1 AND id = $2`,
        [userId, threadIdStr]
      );
      if (checkRes.rows.length === 0) return null;
      nextPinnedState = !checkRes.rows[0].is_pinned;
    }

    const { rows } = await pool.query(
      `UPDATE chat_threads
       SET is_pinned = $3, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1 AND id = $2
       RETURNING id, is_pinned, payload_encrypted, updated_at;`,
      [userId, threadIdStr, Boolean(nextPinnedState)]
    );

    if (rows.length === 0) return null;
    const r = rows[0];
    const data = decryptJson(r.payload_encrypted, aad(userId, r.id), {});
    const updatedPayload = {
      ...data,
      id: r.id,
      isPinned: Boolean(r.is_pinned),
    };
    const newCiphertext = encryptJson(updatedPayload, aad(userId, r.id));
    await pool.query(
      `UPDATE chat_threads SET payload_encrypted = $3 WHERE user_id = $1 AND id = $2`,
      [userId, threadIdStr, newCiphertext]
    );

    return {
      id: r.id,
      title: updatedPayload.title || 'New Thread',
      isPinned: Boolean(r.is_pinned),
      messages: Array.isArray(updatedPayload.messages) ? updatedPayload.messages : [],
      createdAt: updatedPayload.createdAt || r.created_at,
      updatedAt: r.updated_at,
    };
  },

  async saveAllThreads(userId, threads) {
    if (!Array.isArray(threads)) return [];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const keepIds = threads.map((t) => String(t.id)).filter(Boolean);

      // Clean up any threads belonging to this user that were deleted
      if (keepIds.length > 0) {
        await client.query(
          `DELETE FROM chat_threads WHERE user_id = $1 AND id != ALL($2::text[])`,
          [userId, keepIds]
        );
      } else {
        // If all threads were deleted, purge them from DB
        await client.query(`DELETE FROM chat_threads WHERE user_id = $1`, [userId]);
      }

      const results = [];
      for (const t of threads) {
        if (!t || !t.id) continue;
        const threadId = String(t.id);
        const isPinned = Boolean(t.isPinned);
        const payload = {
          id: threadId,
          title: t.title || 'New Thread',
          isPinned,
          messages: Array.isArray(t.messages) ? t.messages : [],
          createdAt: t.createdAt || new Date().toISOString(),
        };
        const ciphertext = encryptJson(payload, aad(userId, threadId));
        await client.query(
          `INSERT INTO chat_threads (id, user_id, payload_encrypted, is_pinned, updated_at)
           VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
           ON CONFLICT (user_id, id)
           DO UPDATE SET
             payload_encrypted = EXCLUDED.payload_encrypted,
             is_pinned = EXCLUDED.is_pinned,
             updated_at = CURRENT_TIMESTAMP;`,
          [threadId, userId, ciphertext, isPinned]
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

  async deleteAllThreads(userId) {
    const query = `
      DELETE FROM chat_threads
      WHERE user_id = $1
      RETURNING id;
    `;
    const { rows } = await pool.query(query, [userId]);
    return rows;
  },
};
