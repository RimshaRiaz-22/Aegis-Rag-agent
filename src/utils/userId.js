import crypto from 'crypto';
import { pool } from '../config/database.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_GUEST_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Normalizes any identifier (standard UUID, underscored UUID, namespace, or guest ID)
 * into a valid PostgreSQL UUID string.
 */
export function normalizeUserId(rawId) {
  if (!rawId) return DEFAULT_GUEST_ID;

  let clean = String(rawId).trim().toLowerCase();

  // Strip leading namespace prefix 'u_' if present
  if (clean.startsWith('u_')) {
    clean = clean.substring(2);
  }

  // Check if already a valid UUID
  if (UUID_REGEX.test(clean)) {
    return clean;
  }

  // Check if it is a 32-character hex string (e.g. UUID with underscores or stripped hyphens)
  const hexOnly = clean.replace(/[^0-9a-f]/g, '');
  if (hexOnly.length === 32) {
    return `${hexOnly.slice(0, 8)}-${hexOnly.slice(8, 12)}-${hexOnly.slice(12, 16)}-${hexOnly.slice(16, 20)}-${hexOnly.slice(20, 32)}`;
  }

  // For arbitrary guest strings (e.g. 'guest_yl6fqnb', 'guest_user'), derive a deterministic RFC-4122 v3 UUID via MD5
  const hash = crypto.createHash('md5').update(`aegis-identity:${clean}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-3${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

/**
 * Ensures that the user record exists in the users table so that any foreign key
 * constraints in knowledge_bases, documents, document_chunks, user_settings, etc.
 * will always succeed.
 */
export async function ensureUserExists(rawId, name = 'Guest User', email = null) {
  const userId = normalizeUserId(rawId);
  const userEmail = email || `guest_${userId.replace(/-/g, '')}@aegis.local`;

  try {
    await pool.query(
      `INSERT INTO users (id, email, password_hash, name, role)
       VALUES ($1, $2, 'guest_auto_provisioned', $3, 'guest')
       ON CONFLICT (id) DO NOTHING;`,
      [userId, userEmail, name]
    );
  } catch (err) {
    // If conflict on email, attempt with unique timestamp
    if (err.code === '23505' && err.constraint === 'users_email_key') {
      const fallbackEmail = `guest_${userId.replace(/-/g, '')}_${Date.now()}@aegis.local`;
      await pool.query(
        `INSERT INTO users (id, email, password_hash, name, role)
         VALUES ($1, $2, 'guest_auto_provisioned', $3, 'guest')
         ON CONFLICT (id) DO NOTHING;`,
        [userId, fallbackEmail, name]
      );
    } else {
      console.warn(`[ensureUserExists] Failed to provision user ${userId}:`, err.message);
    }
  }

  return userId;
}

/**
 * Resolves the actual owner of a widget, embed, or knowledge base.
 * Given any namespace (e.g. 'u_guest_0vhrpro') or user identifier:
 * 1. Finds the owner in knowledge_bases table (WHERE namespace = $1)
 * 2. Finds the owner in widget_configs table (WHERE config->>'namespace' = $1)
 * 3. Finds the owner in users table (by UUID or name)
 * 4. Finds the owner in documents table (by knowledge base namespace)
 * 5. Finds the owner in user_settings table
 * 6. Finds the active configured owner with saved LLM API key
 * 7. Falls back to guest provision
 */
export async function resolveOwner(identifier, namespace) {
  const nsCandidates = new Set();

  if (namespace && typeof namespace === 'string' && namespace.trim()) {
    const cleanNs = namespace.trim();
    nsCandidates.add(cleanNs);
    if (cleanNs.startsWith('u_')) {
      nsCandidates.add(cleanNs.substring(2));
    } else {
      nsCandidates.add(`u_${cleanNs}`);
    }
  }

  if (identifier && typeof identifier === 'string' && identifier.trim()) {
    const cleanId = identifier.trim();
    nsCandidates.add(cleanId);
    if (cleanId.startsWith('u_')) {
      nsCandidates.add(cleanId.substring(2));
    } else {
      nsCandidates.add(`u_${cleanId}`);
    }
  }

  // 1. Look up in knowledge_bases table by namespace
  for (const ns of nsCandidates) {
    try {
      const kbRes = await pool.query(
        `SELECT user_id, namespace FROM knowledge_bases WHERE namespace = $1 ORDER BY created_at ASC LIMIT 1;`,
        [ns]
      );
      if (kbRes.rows.length > 0 && kbRes.rows[0].user_id) {
        return {
          ownerUserId: kbRes.rows[0].user_id,
          namespace: kbRes.rows[0].namespace,
          source: 'knowledge_bases',
        };
      }
    } catch (e) {
      // Continue search
    }
  }

  // 2. Look up in widget_configs table by namespace
  for (const ns of nsCandidates) {
    try {
      const widgetRes = await pool.query(
        `SELECT user_id, config FROM widget_configs 
         WHERE config->>'namespace' = $1 
            OR config->>'namespace' = $2
         LIMIT 1;`,
        [ns, `u_${ns.replace(/^u_/, '')}`]
      );
      if (widgetRes.rows.length > 0 && widgetRes.rows[0].user_id) {
        return {
          ownerUserId: widgetRes.rows[0].user_id,
          namespace: widgetRes.rows[0].config?.namespace || namespace,
          source: 'widget_configs',
        };
      }
    } catch (e) {
      // Continue search
    }
  }

  // 3. Look up if identifier matches a user directly in the users table
  if (identifier) {
    try {
      const normalized = normalizeUserId(identifier);
      const userRes = await pool.query(
        `SELECT id, name, role FROM users WHERE id = $1 LIMIT 1;`,
        [normalized]
      );
      if (userRes.rows.length > 0) {
        return {
          ownerUserId: userRes.rows[0].id,
          namespace: namespace || `u_${userRes.rows[0].id.replace(/-/g, '_')}`,
          source: 'users',
        };
      }
    } catch (e) {
      // Continue search
    }
  }

  // 4. Look up in documents table joined with knowledge_bases
  for (const ns of nsCandidates) {
    try {
      const docRes = await pool.query(
        `SELECT d.user_id, kb.namespace 
         FROM documents d
         JOIN knowledge_bases kb ON d.kb_id = kb.id
         WHERE kb.namespace = $1
         LIMIT 1;`,
        [ns]
      );
      if (docRes.rows.length > 0 && docRes.rows[0].user_id) {
        return {
          ownerUserId: docRes.rows[0].user_id,
          namespace: docRes.rows[0].namespace,
          source: 'documents',
        };
      }
    } catch (e) {
      // Continue search
    }
  }

  // 5. Look up in user_settings table
  if (identifier) {
    try {
      const normalized = normalizeUserId(identifier);
      const setRes = await pool.query(
        `SELECT user_id FROM user_settings WHERE user_id = $1 LIMIT 1;`,
        [normalized]
      );
      if (setRes.rows.length > 0) {
        return {
          ownerUserId: setRes.rows[0].user_id,
          namespace: namespace || `u_${normalized.replace(/-/g, '_')}`,
          source: 'user_settings',
        };
      }
    } catch (e) {
      // Continue search
    }
  }

  // 6. Configured owner fallback:
  // If an unmapped or shared link is opened, find the registered workspace user
  // who configured an LLM API key and settings.
  try {
    const configuredUserRes = await pool.query(
      `SELECT u.id, u.role
       FROM users u
       JOIN user_settings us ON u.id = us.user_id
       WHERE us.has_llm_key = true
          OR ((us.settings->>'llmApiKey') IS NOT NULL AND length(us.settings->>'llmApiKey') > 5)
       ORDER BY (u.role = 'user') DESC, us.updated_at DESC
       LIMIT 1;`
    );
    if (configuredUserRes.rows.length > 0) {
      return {
        ownerUserId: configuredUserRes.rows[0].id,
        namespace: namespace || `u_${configuredUserRes.rows[0].id.replace(/-/g, '_')}`,
        source: 'primary_configured_owner',
      };
    }
  } catch (e) {
    // Continue search
  }

  // 7. Ultimate fallback: auto-provision guest user
  const fallbackId = await ensureUserExists(identifier || 'default_user');
  return {
    ownerUserId: fallbackId,
    namespace: namespace || `u_${fallbackId.replace(/-/g, '_')}`,
    source: 'fallback_guest',
  };
}
