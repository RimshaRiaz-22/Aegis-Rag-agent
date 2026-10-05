import { pool } from '../../config/database.js';

export const widgetRepository = {
  async getByUserId(userId) {
    const query = `
      SELECT id, user_id, config, is_public, updated_at
      FROM widget_configs
      WHERE user_id = $1
      LIMIT 1;
    `;
    const { rows } = await pool.query(query, [userId]);
    return rows[0] || null;
  },

  async upsert(userId, config, isPublic = true) {
    const query = `
      INSERT INTO widget_configs (user_id, config, is_public, updated_at)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id)
      DO UPDATE SET config = EXCLUDED.config, is_public = EXCLUDED.is_public, updated_at = CURRENT_TIMESTAMP
      RETURNING *;
    `;
    const { rows } = await pool.query(query, [userId, JSON.stringify(config), isPublic]);
    return rows[0];
  },
};
