import { visitorsRepository } from './visitors.repository.js';
import { resolveOwner } from '../../utils/userId.js';
import { extractClientIp, resolveLocationFromIp } from '../../utils/geo.js';
import { parseUserAgent } from '../../utils/device.js';

export const visitorsService = {
  /**
   * Track or refresh a visitor session upon loading the widget.
   */
  async trackSession({ req, namespace, visitorToken, sessionToken, pageUrl, referrer }) {
    if (!visitorToken || !sessionToken) {
      throw new Error('visitorToken and sessionToken are required');
    }

    // 1. Resolve agent owner
    const { ownerUserId, namespace: resolvedNamespace } = await resolveOwner(namespace, namespace);

    // 2. Resolve IP and geolocation
    const ip = extractClientIp(req);
    const geo = resolveLocationFromIp(ip);

    // 3. Resolve device & browser info
    const uaString = req.headers['user-agent'] || '';
    const device = parseUserAgent(uaString);

    // 4. Save in repository
    const result = await visitorsRepository.upsertVisitorAndSession({
      ownerUserId,
      visitorToken,
      sessionToken,
      ip,
      geo,
      device,
      pageUrl: pageUrl || referrer || 'Direct / Standalone',
      referrer: referrer || null,
      agentNamespace: resolvedNamespace || namespace,
    });

    return result;
  },

  /**
   * Update session duration on pagehide / leave.
   */
  async updateSessionDuration(sessionToken, durationSeconds) {
    return await visitorsRepository.updateSessionDuration(sessionToken, durationSeconds);
  },

  /**
   * Log chat message exchange between visitor and agent.
   */
  async logChatMessage({
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
    if (!visitorToken || !sessionToken || !ownerUserId) return null;

    return await visitorsRepository.logMessage({
      ownerUserId,
      visitorToken,
      sessionToken,
      agentNamespace,
      role,
      content,
      sources,
      tokensUsed,
      model,
    });
  },

  /**
   * Get list of visitors for authenticated admin.
   */
  async getVisitors(ownerUserId, query) {
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 50));
    const offset = Math.max(0, parseInt(query.offset, 10) || 0);
    const search = query.search || '';
    const device = query.device || '';

    return await visitorsRepository.getVisitorsByOwner(ownerUserId, {
      search,
      device,
      limit,
      offset,
    });
  },

  /**
   * Get single visitor profile, sessions, and chat transcripts.
   */
  async getVisitorDetails(ownerUserId, visitorId) {
    const data = await visitorsRepository.getVisitorDetails(ownerUserId, visitorId);
    if (!data) {
      throw new Error('Visitor not found or unauthorized');
    }
    return data;
  },

  /**
   * Get aggregate overview statistics.
   */
  async getAnalytics(ownerUserId) {
    return await visitorsRepository.getAnalyticsOverview(ownerUserId);
  },

  /**
   * Delete a visitor record.
   */
  async deleteVisitor(ownerUserId, visitorId) {
    return await visitorsRepository.deleteVisitor(ownerUserId, visitorId);
  },
};
