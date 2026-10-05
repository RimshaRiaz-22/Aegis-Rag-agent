import { pool } from '../../config/database.js';
import { settingsRepository } from '../settings/settings.repository.js';

export const authRepository = {
  async findByEmail(email) {
    const query = `
      SELECT id, email, password_hash, name, role, status, created_at, updated_at
      FROM users
      WHERE LOWER(email) = LOWER($1)
      LIMIT 1;
    `;
    const { rows } = await pool.query(query, [email]);
    return rows[0] || null;
  },

  async findById(id) {
    const query = `
      SELECT id, email, name, role, status, created_at, updated_at
      FROM users
      WHERE id = $1
      LIMIT 1;
    `;
    const { rows } = await pool.query(query, [id]);
    return rows[0] || null;
  },

  async createUser({ email, passwordHash, name, role = 'user' }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const userInsert = `
        INSERT INTO users (email, password_hash, name, role)
        VALUES ($1, $2, $3, $4)
        RETURNING id, email, name, role, status, created_at, updated_at;
      `;
      const { rows: userRows } = await client.query(userInsert, [
        email.toLowerCase().trim(),
        passwordHash,
        name.trim(),
        role,
      ]);
      const user = userRows[0];

      // Auto-create initial settings — only provider-agnostic defaults.
      // Never seed llmModel, llmBaseUrl, embeddingModel etc. here;
      // those must be configured by the user in the Settings page.
      // Stored encrypted (AES-256-GCM) via the settings repository.
      await settingsRepository.upsert(
        user.id,
        {
          systemPrompt: 'You are Aegis, a helpful workspace RAG assistant.',
          topK: 4,
          similarityThreshold: 0.3,
          temperature: 0.7,
          maxTokens: 2048,
        },
        client
      );

      // Auto-create default knowledge base collection
      const kbInsert = `
        INSERT INTO knowledge_bases (user_id, name, namespace, description)
        VALUES ($1, $2, $3, $4);
      `;
      await client.query(kbInsert, [
        user.id,
        'Default Knowledge Base',
        `u_${user.id.replace(/-/g, '_')}`,
        'Default document collection',
      ]);

      await client.query('COMMIT');
      return user;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
};
