import { chatThreadRepository } from './chat.repository.js';
import { successResponse, errorResponse } from '../../utils/response.js';

export const chatController = {
  async getSessions(req, res, next) {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return errorResponse(res, 'Tenant identity required', 401);
      }
      const threads = await chatThreadRepository.getThreadsByUser(tenantId);
      return successResponse(res, threads, 'Chat sessions retrieved successfully');
    } catch (err) {
      next(err);
    }
  },

  async saveSessions(req, res, next) {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return errorResponse(res, 'Tenant identity required', 401);
      }
      const { sessions } = req.body;
      const saved = await chatThreadRepository.saveAllThreads(tenantId, sessions || []);
      return successResponse(res, saved, 'Chat sessions saved successfully');
    } catch (err) {
      next(err);
    }
  },

  async saveSingleSession(req, res, next) {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return errorResponse(res, 'Tenant identity required', 401);
      }
      const saved = await chatThreadRepository.upsertThread(tenantId, req.body);
      return successResponse(res, saved, 'Chat session saved successfully');
    } catch (err) {
      next(err);
    }
  },

  async deleteSession(req, res, next) {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return errorResponse(res, 'Tenant identity required', 401);
      }
      const { id } = req.params;
      const deleted = await chatThreadRepository.deleteThread(tenantId, id);
      return successResponse(res, deleted, 'Chat session deleted successfully');
    } catch (err) {
      next(err);
    }
  },

  async togglePin(req, res, next) {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return errorResponse(res, 'Tenant identity required', 401);
      }
      const { id } = req.params;
      const { isPinned } = req.body || {};
      const updated = await chatThreadRepository.togglePin(
        tenantId,
        id,
        typeof isPinned === 'boolean' ? isPinned : null
      );
      return successResponse(res, updated, 'Chat pin toggled successfully');
    } catch (err) {
      next(err);
    }
  },

  async deleteAllSessions(req, res, next) {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return errorResponse(res, 'Tenant identity required', 401);
      }
      await chatThreadRepository.deleteAllThreads(tenantId);
      return successResponse(res, [], 'All chat sessions deleted successfully');
    } catch (err) {
      next(err);
    }
  },
};
