import { visitorsService } from './visitors.service.js';
import { successResponse, errorResponse } from '../../utils/response.js';
import { resolveOwner } from '../../utils/userId.js';

export const visitorsController = {
  /**
   * Public: Track or initialize a visitor session when embed widget opens.
   */
  async trackSession(req, res, next) {
    try {
      const { visitorToken, sessionToken, namespace, pageUrl, referrer } = req.body;
      if (!visitorToken || !sessionToken) {
        return errorResponse(res, 'visitorToken and sessionToken are required', 400);
      }

      const result = await visitorsService.trackSession({
        req,
        namespace: namespace || req.query.namespace || 'default_user',
        visitorToken,
        sessionToken,
        pageUrl,
        referrer,
      });

      return successResponse(res, result, 'Visitor session tracked');
    } catch (err) {
      next(err);
    }
  },

  /**
   * Public: Update session duration (via beacon or unload).
   */
  async updateDuration(req, res, next) {
    try {
      const { sessionToken, durationSeconds } = req.body;
      if (sessionToken && durationSeconds) {
        await visitorsService.updateSessionDuration(sessionToken, durationSeconds);
      }
      return successResponse(res, { updated: true }, 'Duration updated');
    } catch (err) {
      next(err);
    }
  },

  /**
   * Authenticated: List visitors for the current logged in user.
   */
  async getVisitors(req, res, next) {
    try {
      const rawUserId = req.user?.id || req.headers['x-guest-id'] || 'default_user';
      const { ownerUserId } = await resolveOwner(rawUserId, req.query.namespace);
      const data = await visitorsService.getVisitors(ownerUserId, req.query);
      return successResponse(res, data, 'Visitors retrieved successfully');
    } catch (err) {
      next(err);
    }
  },

  /**
   * Authenticated: Get single visitor details and chat history.
   */
  async getVisitorDetails(req, res, next) {
    try {
      const rawUserId = req.user?.id || req.headers['x-guest-id'] || 'default_user';
      const { ownerUserId } = await resolveOwner(rawUserId, req.query.namespace);
      const { visitorId } = req.params;

      const data = await visitorsService.getVisitorDetails(ownerUserId, visitorId);
      return successResponse(res, data, 'Visitor details retrieved');
    } catch (err) {
      next(err);
    }
  },

  /**
   * Authenticated: Analytics overview metrics.
   */
  async getAnalytics(req, res, next) {
    try {
      const rawUserId = req.user?.id || req.headers['x-guest-id'] || 'default_user';
      const { ownerUserId } = await resolveOwner(rawUserId, req.query.namespace);
      const data = await visitorsService.getAnalytics(ownerUserId);
      return successResponse(res, data, 'Analytics retrieved');
    } catch (err) {
      next(err);
    }
  },

  /**
   * Authenticated: Delete visitor.
   */
  async deleteVisitor(req, res, next) {
    try {
      const rawUserId = req.user?.id || req.headers['x-guest-id'] || 'default_user';
      const { ownerUserId } = await resolveOwner(rawUserId, req.query.namespace);
      const { visitorId } = req.params;

      const deleted = await visitorsService.deleteVisitor(ownerUserId, visitorId);
      return successResponse(res, { deleted }, 'Visitor deleted successfully');
    } catch (err) {
      next(err);
    }
  },
};
