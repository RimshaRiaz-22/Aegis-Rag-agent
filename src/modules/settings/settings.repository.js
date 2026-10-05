import { pool } from '../../config/database.js';
import { encryptJson, decryptJson } from '../../utils/crypto.js';

/**
 * All user settings (API keys, model config, prompts...) are stored ONLY as an
 * AES-256-GCM encrypted blob in `settings_encrypted`. The legacy plaintext `settings`
 * JSONB column is always written as '{}'.
 *
 * Callers keep receiving `{ user_id, settings, updated_at }` with decrypted settings,
 * so encryption is fully transparent to the rest of the codebase.
 */
const aad = (userId) => `user_settings:${userId}`;

function hasLlmKey(settings) {
  return Boolean(settings && typeof settings.llmApiKey === 'string' && settings.llmApiKey.length > 5);
}

function toRecord(row) {
  if (!row) return null;
  let settings;
  if (row.settings_encrypted) {
    settings = decryptJson(row.settings_encrypted, aad(row.user_id), {});
  } else {
    // Legacy plaintext row (pre-encryption) — readable until migrated on startup / next write
    settings = row.settings || {};
  }
  return { user_id: row.user_id, settings: settings || {}, updated_at: row.updated_at };
}

export const settingsRepository = {
  async getByUserId(userId) {
    const query = `
      SELECT user_id, settings, settings_encrypted, updated_at
      FROM user_settings
      WHERE user_id = $1
      LIMIT 1;
    `;
    const { rows } = await pool.query(query, [userId]);
    return toRecord(rows[0]);
  },

  async upsert(userId, settings, client = pool) {
    const query = `
      INSERT INTO user_settings (user_id, settings, settings_encrypted, has_llm_key, updated_at)
      VALUES ($1, '{}'::jsonb, $2, $3, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id)
      DO UPDATE SET settings = '{}'::jsonb,
                    settings_encrypted = EXCLUDED.settings_encrypted,
                    has_llm_key = EXCLUDED.has_llm_key,
                    updated_at = CURRENT_TIMESTAMP
      RETURNING user_id, settings, settings_encrypted, updated_at;
    `;
    const { rows } = await client.query(query, [
      userId,
      encryptJson(settings || {}, aad(userId)),
      hasLlmKey(settings),
    ]);
    return toRecord(rows[0]);
  },

  /**
   * One-time migration: encrypt any legacy plaintext settings rows and wipe the
   * plaintext column. Safe to run on every startup (no-op once done).
   */
  async encryptLegacyRows() {
    const { rows } = await pool.query(`
      SELECT user_id, settings
      FROM user_settings
      WHERE settings_encrypted IS NULL
         OR settings::text <> '{}';
    `);
    let migrated = 0;
    for (const row of rows) {
      const existing = await this.getByUserId(row.user_id);
      // Merge: encrypted values win, legacy plaintext only fills gaps
      const merged = { ...(row.settings || {}), ...(existing?.settings || {}) };
      await this.upsert(row.user_id, merged);
      migrated++;
    }
    return migrated;
  },
};
