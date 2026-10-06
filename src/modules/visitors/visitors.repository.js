import { pool } from '../../config/database.js';

export const visitorsRepository = {
  /**
   * Upsert a visitor record and register a new or existing visit session.
   */
  async upsertVisitorAndSession({
    ownerUserId,
    visitorToken,
    sessionToken,
    fingerprint,
    ip,
    geo,
    device,
    pageUrl,
    pageTitle,
    referrer,
    agentNamespace,
    metadata = {},
  }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Check if session already exists
      const existingSessionRes = await client.query(
        `SELECT id, visitor_id, started_at, duration_seconds FROM visitor_sessions WHERE session_token = $1;`,
        [sessionToken]
      );
      const sessionExists = existingSessionRes.rows.length > 0;

      // 2. Build enriched metadata with fingerprint, bot status, and geo source
      const enrichedMetadata = {
        ...metadata,
        fingerprint: fingerprint || metadata.fingerprint || null,
        is_bot: device.isBot || false,
        geo_source: geo.source || 'default',
        page_title: pageTitle || null,
        last_seen_iso: new Date().toISOString(),
      };

      // 3. Resolve effective visitor identity:
      // If token is unknown but hardware fingerprint matches an existing visitor within the owner's domain, re-link!
      let effectiveVisitorToken = visitorToken;
      const existingVisitorByToken = await client.query(
        `SELECT id, visitor_token, metadata FROM visitors WHERE owner_user_id = $1 AND visitor_token = $2;`,
        [ownerUserId, visitorToken]
      );

      if (
        existingVisitorByToken.rows.length === 0 &&
        fingerprint &&
        fingerprint !== 'fp_basic' &&
        fingerprint !== 'fp_fallback'
      ) {
        const fpMatch = await client.query(
          `SELECT id, visitor_token, metadata FROM visitors 
           WHERE owner_user_id = $1 AND (metadata->>'fingerprint') = $2 
           ORDER BY last_seen_at DESC LIMIT 1;`,
          [ownerUserId, fingerprint]
        );
        if (fpMatch.rows.length > 0) {
          effectiveVisitorToken = fpMatch.rows[0].visitor_token;
        }
      }

      // 4. Upsert visitor profile
      let visitorQuery;
      let visitorParams;

      if (!sessionExists) {
        visitorQuery = `
          INSERT INTO visitors (
            owner_user_id, visitor_token, first_seen_at, last_seen_at,
            total_visits, last_ip, country, country_code, city, region,
            latitude, longitude, timezone, browser, os, device_type,
            last_page_url, last_referrer, agent_namespace, metadata, updated_at
          ) VALUES (
            $1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
            1, $3, $4, $5, $6, $7,
            $8, $9, $10, $11, $12, $13,
            $14, $15, $16, $17, CURRENT_TIMESTAMP
          )
          ON CONFLICT (owner_user_id, visitor_token) DO UPDATE SET
            total_visits = visitors.total_visits + 1,
            last_seen_at = CURRENT_TIMESTAMP,
            last_ip = EXCLUDED.last_ip,
            country = CASE WHEN EXCLUDED.country <> 'Unknown' THEN EXCLUDED.country ELSE visitors.country END,
            country_code = CASE WHEN EXCLUDED.country_code <> 'XX' THEN EXCLUDED.country_code ELSE visitors.country_code END,
            city = CASE WHEN EXCLUDED.city <> 'Unknown City' THEN EXCLUDED.city ELSE visitors.city END,
            region = CASE WHEN EXCLUDED.region <> 'Unknown Region' THEN EXCLUDED.region ELSE visitors.region END,
            latitude = COALESCE(EXCLUDED.latitude, visitors.latitude),
            longitude = COALESCE(EXCLUDED.longitude, visitors.longitude),
            timezone = COALESCE(EXCLUDED.timezone, visitors.timezone),
            browser = EXCLUDED.browser,
            os = EXCLUDED.os,
            device_type = EXCLUDED.device_type,
            last_page_url = EXCLUDED.last_page_url,
            last_referrer = EXCLUDED.last_referrer,
            agent_namespace = COALESCE(EXCLUDED.agent_namespace, visitors.agent_namespace),
            metadata = COALESCE(visitors.metadata, '{}'::jsonb) || EXCLUDED.metadata,
            updated_at = CURRENT_TIMESTAMP
          RETURNING *;
        `;
        visitorParams = [
          ownerUserId,
          effectiveVisitorToken,
          ip,
          geo.country,
          geo.countryCode,
          geo.city,
          geo.region,
          geo.latitude,
          geo.longitude,
          geo.timezone,
          device.browser,
          device.os,
          device.deviceType,
          pageUrl,
          referrer,
          agentNamespace,
          JSON.stringify(enrichedMetadata),
        ];
      } else {
        visitorQuery = `
          UPDATE visitors SET
            last_seen_at = CURRENT_TIMESTAMP,
            last_page_url = COALESCE($3, last_page_url),
            metadata = COALESCE(visitors.metadata, '{}'::jsonb) || $4,
            updated_at = CURRENT_TIMESTAMP
          WHERE owner_user_id = $1 AND visitor_token = $2
          RETURNING *;
        `;
        visitorParams = [ownerUserId, effectiveVisitorToken, pageUrl, JSON.stringify(enrichedMetadata)];
      }

      const visitorRes = await client.query(visitorQuery, visitorParams);
      const visitor = visitorRes.rows[0];

      // 3. Upsert visitor_sessions
      const sessionQuery = `
        INSERT INTO visitor_sessions (
          visitor_id, owner_user_id, session_token, started_at, last_active_at,
          duration_seconds, page_url, referrer, ip_address, country,
          country_code, city, region, browser, os, device_type, agent_namespace, updated_at
        ) VALUES (
          $1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
          0, $4, $5, $6, $7,
          $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP
        )
        ON CONFLICT (session_token) DO UPDATE SET
          last_active_at = CURRENT_TIMESTAMP,
          page_url = COALESCE(EXCLUDED.page_url, visitor_sessions.page_url),
          updated_at = CURRENT_TIMESTAMP
        RETURNING *;
      `;

      const sessionRes = await client.query(sessionQuery, [
        visitor.id,
        ownerUserId,
        sessionToken,
        pageUrl,
        referrer,
        ip,
        geo.country,
        geo.countryCode,
        geo.city,
        geo.region,
        device.browser,
        device.os,
        device.deviceType,
        agentNamespace,
      ]);
      const session = sessionRes.rows[0];

      await client.query('COMMIT');
      return { visitor, session };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * Log an incoming user or assistant message linked to a visitor.
   */
  async logMessage({
    ownerUserId,
    visitorToken,
    sessionToken,
    agentNamespace,
    role,
    content,
    sources = [],
    tokensUsed = 0,
    model = 'AI Assistant',
  }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Locate visitor
      const visitorRes = await client.query(
        `SELECT id FROM visitors WHERE owner_user_id = $1 AND visitor_token = $2;`,
        [ownerUserId, visitorToken]
      );
      if (visitorRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return null;
      }
      const visitorId = visitorRes.rows[0].id;

      // 2. Locate session
      const sessionRes = await client.query(
        `SELECT id, started_at FROM visitor_sessions WHERE session_token = $1;`,
        [sessionToken]
      );
      const sessionId = sessionRes.rows[0]?.id || null;

      // 3. Insert message
      const msgRes = await client.query(
        `INSERT INTO visitor_messages (
          visitor_id, session_id, owner_user_id, session_token,
          agent_namespace, role, content, sources, tokens_used, model
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *;`,
        [
          visitorId,
          sessionId,
          ownerUserId,
          sessionToken,
          agentNamespace,
          role,
          content,
          JSON.stringify(sources || []),
          tokensUsed,
          model,
        ]
      );

      // 4. Update session duration and message count
      if (sessionId) {
        await client.query(
          `UPDATE visitor_sessions SET
            message_count = message_count + 1,
            last_active_at = CURRENT_TIMESTAMP,
            duration_seconds = GREATEST(duration_seconds, EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - started_at))::INT),
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $1;`,
          [sessionId]
        );
      }

      // 5. Update visitor aggregate stats
      await client.query(
        `UPDATE visitors SET
          total_messages = total_messages + 1,
          last_seen_at = CURRENT_TIMESTAMP,
          total_time_spent_seconds = (
            SELECT COALESCE(SUM(duration_seconds), 0)
            FROM visitor_sessions
            WHERE visitor_id = $1
          ),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1;`,
        [visitorId]
      );

      await client.query('COMMIT');
      return msgRes.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * Finalize session duration on client disconnect or pagehide beacon.
   */
  async updateSessionDuration(sessionToken, durationSeconds) {
    if (!sessionToken || !durationSeconds) return;
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const res = await client.query(
          `UPDATE visitor_sessions SET
            duration_seconds = GREATEST(duration_seconds, $2::INT),
            last_active_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
          WHERE session_token = $1
          RETURNING visitor_id;`,
          [sessionToken, Math.max(0, parseInt(durationSeconds, 10) || 0)]
        );

        if (res.rows.length > 0) {
          const visitorId = res.rows[0].visitor_id;
          await client.query(
            `UPDATE visitors SET
              total_time_spent_seconds = (
                SELECT COALESCE(SUM(duration_seconds), 0)
                FROM visitor_sessions
                WHERE visitor_id = $1
              ),
              updated_at = CURRENT_TIMESTAMP
            WHERE id = $1;`,
            [visitorId]
          );
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    } catch (err) {
      console.warn(`[updateSessionDuration] Failed for session ${sessionToken}:`, err.message);
    }
  },

  /**
   * Retrieve list of visitors for the authenticated admin.
   */
  async getVisitorsByOwner(ownerUserId, { search = '', device = '', limit = 50, offset = 0 } = {}) {
    // Purge any accidental admin preview visitors for this owner
    try {
      await pool.query(
        `DELETE FROM visitors 
         WHERE owner_user_id = $1 
           AND (
             (metadata->>'is_admin') = 'true' 
             OR last_page_url LIKE '%/embed%'
             OR last_page_url LIKE '%preview=true%'
             OR last_page_url LIKE '%admin=1%'
           );`,
        [ownerUserId]
      );
    } catch (_) {}

    const conditions = [
      'owner_user_id = $1',
      `(metadata->>'is_admin') IS DISTINCT FROM 'true'`,
      `(last_page_url IS NULL OR (last_page_url NOT LIKE '%/embed%' AND last_page_url NOT LIKE '%preview=true%' AND last_page_url NOT LIKE '%admin=1%'))`,
    ];
    const params = [ownerUserId];
    let paramIdx = 2;

    if (search && search.trim()) {
      const term = `%${search.trim().toLowerCase()}%`;
      conditions.push(`(
        LOWER(visitor_token) LIKE $${paramIdx} OR
        LOWER(last_ip) LIKE $${paramIdx} OR
        LOWER(city) LIKE $${paramIdx} OR
        LOWER(country) LIKE $${paramIdx} OR
        LOWER(agent_namespace) LIKE $${paramIdx} OR
        LOWER(last_page_url) LIKE $${paramIdx}
      )`);
      params.push(term);
      paramIdx++;
    }

    if (device && device !== 'all') {
      conditions.push(`device_type = $${paramIdx}`);
      params.push(device.toLowerCase());
      paramIdx++;
    }

    const whereClause = conditions.join(' AND ');

    const countQuery = `SELECT COUNT(*) AS total FROM visitors WHERE ${whereClause};`;
    const countRes = await pool.query(countQuery, params);
    const totalCount = parseInt(countRes.rows[0]?.total || 0, 10);

    const listQuery = `
      SELECT *
      FROM visitors
      WHERE ${whereClause}
      ORDER BY last_seen_at DESC
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1};
    `;
    params.push(limit, offset);
    const listRes = await pool.query(listQuery, params);

    return {
      visitors: listRes.rows,
      totalCount,
      limit,
      offset,
    };
  },

  /**
   * Get single visitor with all sessions and chat messages.
   */
  async getVisitorDetails(ownerUserId, visitorId) {
    const visitorRes = await pool.query(
      `SELECT * FROM visitors WHERE id = $1 AND owner_user_id = $2;`,
      [visitorId, ownerUserId]
    );
    if (visitorRes.rows.length === 0) return null;
    const visitor = visitorRes.rows[0];

    const sessionsRes = await pool.query(
      `SELECT * FROM visitor_sessions WHERE visitor_id = $1 ORDER BY started_at DESC;`,
      [visitorId]
    );

    const messagesRes = await pool.query(
      `SELECT * FROM visitor_messages WHERE visitor_id = $1 ORDER BY created_at ASC;`,
      [visitorId]
    );

    return {
      visitor,
      sessions: sessionsRes.rows,
      messages: messagesRes.rows,
    };
  },

  /**
   * Aggregate high-level analytics KPIs for dashboard.
   */
  async getAnalyticsOverview(ownerUserId) {
    const nonAdminCondition = `
      owner_user_id = $1
      AND (metadata->>'is_admin') IS DISTINCT FROM 'true'
      AND (last_page_url IS NULL OR (last_page_url NOT LIKE '%/embed%' AND last_page_url NOT LIKE '%preview=true%' AND last_page_url NOT LIKE '%admin=1%'))
    `;

    const kpiQuery = `
      SELECT
        COUNT(id) AS total_visitors,
        COALESCE(SUM(total_visits), 0) AS total_visits,
        COALESCE(SUM(total_messages), 0) AS total_messages,
        COALESCE(AVG(total_time_spent_seconds), 0) AS avg_duration_seconds
      FROM visitors
      WHERE ${nonAdminCondition};
    `;
    const kpiRes = await pool.query(kpiQuery, [ownerUserId]);
    const kpis = kpiRes.rows[0];

    // Top countries
    const countriesQuery = `
      SELECT country, country_code, COUNT(id) AS visitor_count
      FROM visitors
      WHERE ${nonAdminCondition} AND country IS NOT NULL AND country <> 'Unknown'
      GROUP BY country, country_code
      ORDER BY visitor_count DESC
      LIMIT 5;
    `;
    const countriesRes = await pool.query(countriesQuery, [ownerUserId]);

    // Device breakdown
    const devicesQuery = `
      SELECT device_type, COUNT(id) AS count
      FROM visitors
      WHERE ${nonAdminCondition}
      GROUP BY device_type;
    `;
    const devicesRes = await pool.query(devicesQuery, [ownerUserId]);

    return {
      totalVisitors: parseInt(kpis.total_visitors || 0, 10),
      totalVisits: parseInt(kpis.total_visits || 0, 10),
      totalMessages: parseInt(kpis.total_messages || 0, 10),
      avgDurationSeconds: Math.round(parseFloat(kpis.avg_duration_seconds || 0)),
      topCountries: countriesRes.rows,
      devices: devicesRes.rows,
    };
  },

  /**
   * Delete a visitor.
   */
  async deleteVisitor(ownerUserId, visitorId) {
    const res = await pool.query(
      `DELETE FROM visitors WHERE id = $1 AND owner_user_id = $2 RETURNING id;`,
      [visitorId, ownerUserId]
    );
    return res.rows.length > 0;
  },
};
