import crypto from 'crypto';
import { pool } from '../config/database.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Normalizes any identifier (standard UUID, underscored UUID, namespace, or guest ID)
 * into a valid PostgreSQL UUID string. Returns null if invalid or missing.
 */
export function normalizeUserId(rawId) {
  if (!rawId) return null;

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

  // For arbitrary guest strings (e.g. 'guest_yl6fqnb'), derive a deterministic RFC-4122 v3 UUID via MD5
  const hash = crypto.createHash('md5').update(`aegis-identity:${clean}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-3${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

/**
 * Resolves the calling user ID from the request.
 * Priority:
 * 1. Authenticated user ID from req.user (verified JWT)
 * 2. Guest header 'x-guest-id' or 'x-user-id' (strictly verified as guest or non-registered)
 */
export function getRequestUserId(req) {
  if (!req) return null;

  // 1. Authenticated user from JWT
  if (req.user?.id) {
    return req.user.id;
  }

  // 2. Client headers (guest identity)
  const headerUserId = req.headers?.['x-guest-id'] || req.headers?.['x-user-id'];
  if (headerUserId && typeof headerUserId === 'string' && headerUserId.trim()) {
    return normalizeUserId(headerUserId);
  }

  // 3. Namespace header
  const headerNs = req.headers?.['x-namespace'];
  if (headerNs && typeof headerNs === 'string' && headerNs.startsWith('u_')) {
    const extracted = headerNs.substring(2);
    if (extracted && extracted.trim()) {
      return normalizeUserId(extracted);
    }
  }

  // 4. Query parameters
  const queryId = req.query?.user_id || req.query?.userId || req.query?.guestId;
  if (queryId && typeof queryId === 'string' && queryId.trim()) {
    return normalizeUserId(queryId);
  }
  const queryNs = req.query?.namespace;
  if (queryNs && typeof queryNs === 'string' && queryNs.startsWith('u_')) {
    const extracted = queryNs.substring(2);
    if (extracted && extracted.trim()) {
      return normalizeUserId(extracted);
    }
  }

  // 5. Request body
  const bodyId = req.body?.user_id || req.body?.userId || req.body?.guestId;
  if (bodyId && typeof bodyId === 'string' && bodyId.trim()) {
    return normalizeUserId(bodyId);
  }
  const bodyNs = req.body?.namespace;
  if (bodyNs && typeof bodyNs === 'string' && bodyNs.startsWith('u_')) {
    const extracted = bodyNs.substring(2);
    if (extracted && extracted.trim()) {
      return normalizeUserId(extracted);
    }
  }

  return null;
}

/**
 * Checks if a user ID belongs to a registered non-guest account.
 * Used to prevent unauthenticated guests from impersonating registered users.
 */
export async function isRegisteredUser(userId) {
  if (!userId) return false;
  try {
    const res = await pool.query(
      `SELECT role FROM users WHERE id = $1 LIMIT 1;`,
      [userId]
    );
    if (res.rows.length > 0 && res.rows[0].role !== 'guest') {
      return true;
    }
  } catch (err) {
    console.warn('[isRegisteredUser] DB check error:', err.message);
  }
  return false;
}

/**
 * Ensures that the user record exists in the users table so that foreign keys
 * in knowledge_bases, documents, document_chunks, user_settings succeed.
 */
export async function ensureUserExists(rawId, name = 'Guest User', email = null) {
  const userId = normalizeUserId(rawId);
  if (!userId) return null;

  const userEmail = email || `guest_${userId.replace(/-/g, '')}@aegis.local`;

  try {
    await pool.query(
      `INSERT INTO users (id, email, password_hash, name, role)
       VALUES ($1, $2, 'guest_auto_provisioned', $3, 'guest')
       ON CONFLICT (id) DO NOTHING;`,
      [userId, userEmail, name]
    );
  } catch (err) {
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
 * Completely purges all data belonging to an ephemeral guest user.
 * Deletes knowledge bases, documents, chunks, chat threads, settings, and the guest user record.
 * Protects registered users (role !== 'guest') from accidental deletion.
 */
export async function purgeGuestData(rawId) {
  if (!rawId) return { purged: false, reason: 'No identifier provided' };
  const userId = normalizeUserId(rawId);
  if (!userId) return { purged: false, reason: 'Invalid identifier' };

  const check = await pool.query(`SELECT id, role FROM users WHERE id = $1;`, [userId]);
  if (check.rows.length === 0) {
    return { purged: true, reason: 'No database records found' };
  }
  if (check.rows[0].role !== 'guest') {
    return { purged: false, reason: 'Cannot purge registered non-guest user' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM chat_threads WHERE user_id = $1;`, [userId]);
    await client.query(`DELETE FROM user_settings WHERE user_id = $1;`, [userId]);
    await client.query(`DELETE FROM document_chunks WHERE user_id = $1;`, [userId]);
    await client.query(`DELETE FROM documents WHERE user_id = $1;`, [userId]);
    await client.query(`DELETE FROM knowledge_bases WHERE user_id = $1;`, [userId]);
    await client.query(`DELETE FROM widget_configs WHERE user_id = $1;`, [userId]);
    await client.query(`DELETE FROM users WHERE id = $1 AND role = 'guest';`, [userId]);
    await client.query('COMMIT');
    console.log(`[Guest Purge] Successfully wiped all database records for guest: ${userId}`);
    return { purged: true, userId };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`[Guest Purge] Transaction failed for ${userId}:`, err.message);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Resolves the actual owner of a widget, embed, or knowledge base.
 * ZERO cross-tenant credential harvesting: never falls back to an arbitrary registered user.
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

  // 1. Direct user match in users table
  if (identifier) {
    try {
      const normalized = normalizeUserId(identifier);
      if (normalized) {
        const userRes = await pool.query(
          `SELECT id, name, role FROM users WHERE id = $1 LIMIT 1;`,
          [normalized]
        );
        if (userRes.rows.length > 0) {
          const ownerId = userRes.rows[0].id;
          let userNs = namespace;
          try {
            const kb = await pool.query(
              `SELECT namespace FROM knowledge_bases WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1;`,
              [ownerId]
            );
            if (kb.rows.length > 0 && kb.rows[0].namespace) {
              userNs = kb.rows[0].namespace;
            }
          } catch (_) {}

          return {
            ownerUserId: ownerId,
            namespace: userNs || `u_${ownerId.replace(/-/g, '_')}`,
            source: 'users',
          };
        }
      }
    } catch (_) {}
  }

  // 2. Look up in knowledge_bases table by namespace
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
    } catch (_) {}
  }

  // 3. Look up in widget_configs table by namespace
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
    } catch (_) {}
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
    } catch (_) {}
  }

  // 5. Look up in user_settings table
  if (identifier) {
    try {
      const normalized = normalizeUserId(identifier);
      if (normalized) {
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
      }
    } catch (_) {}
  }

  // If identifier provided for guest, provision an isolated guest user
  if (identifier) {
    const guestId = await ensureUserExists(identifier);
    if (guestId) {
      return {
        ownerUserId: guestId,
        namespace: namespace || `u_${guestId.replace(/-/g, '_')}`,
        source: 'guest_isolated',
      };
    }
  }

  // No owner found - return null rather than stealing another tenant's account
  return {
    ownerUserId: null,
    namespace: namespace || null,
    source: 'unresolved',
  };
}
