import { visitorsService } from './visitors.service.js';
import { successResponse, errorResponse } from '../../utils/response.js';
import { resolveOwner } from '../../utils/userId.js';

export const visitorsController = {
  /**
   * Public: Track or initialize a visitor session when embed widget opens.
   */
  async trackSession(req, res, next) {
    try {
      const {
        visitorToken,
        sessionToken,
        namespace,
        pageUrl,
        referrer,
        fingerprint,
        pageTitle,
        metadata,
        isAdmin,
      } = req.body;

      if (!visitorToken || !sessionToken) {
        return errorResponse(res, 'visitorToken and sessionToken are required', 400);
      }

      // Check if this request is from an admin, account owner, simulator, or preview
      const isAdminTraffic =
        Boolean(req.user) ||
        isAdmin === true ||
        req.query.admin === '1' ||
        metadata?.is_admin === true ||
        req.headers['x-admin-preview'] === 'true' ||
        (pageUrl &&
          (pageUrl.includes('/embed') ||
            pageUrl.includes('preview=true') ||
            pageUrl.includes('admin=1')));

      if (isAdminTraffic) {
        return successResponse(
          res,
          { ignored: true, reason: 'Admin traffic excluded from visitor tracking' },
          'Admin visit ignored'
        );
      }

      const targetNamespace = namespace || req.query.namespace;
      if (!targetNamespace) {
        return errorResponse(res, 'Target namespace is required for visitor tracking', 400);
      }

      const result = await visitorsService.trackSession({
        req,
        namespace: targetNamespace,
        visitorToken,
        sessionToken,
        fingerprint,
        pageUrl,
        pageTitle,
        referrer,
        metadata,
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
      const { sessionToken, durationSeconds, isAdmin } = req.body;
      const isAdminTraffic =
        Boolean(req.user) || isAdmin === true || req.query.admin === '1';

      if (isAdminTraffic) {
        return successResponse(res, { ignored: true }, 'Admin duration ignored');
      }

      if (sessionToken && durationSeconds) {
        await visitorsService.updateSessionDuration(sessionToken, durationSeconds);
      }
      return successResponse(res, { updated: true }, 'Duration updated');
    } catch (err) {
      next(err);
    }
  },

  /**
   * Authenticated: List visitors for the current logged-in user.
   */
  async getVisitors(req, res, next) {
    try {
      const ownerUserId = req.user.id;
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
      const ownerUserId = req.user.id;
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
      const ownerUserId = req.user.id;
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
      const ownerUserId = req.user.id;
      const { visitorId } = req.params;

      const deleted = await visitorsService.deleteVisitor(ownerUserId, visitorId);
      return successResponse(res, { deleted }, 'Visitor deleted successfully');
    } catch (err) {
      next(err);
    }
  },
};
