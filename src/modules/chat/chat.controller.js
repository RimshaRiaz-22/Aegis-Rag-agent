import { chatThreadRepository } from './chat.repository.js';
import { successResponse } from '../../utils/response.js';
import { ensureUserExists } from '../../utils/userId.js';

export const chatController = {
  async getSessions(req, res, next) {
    try {
      const rawUserId = req.user?.id || req.query.user_id || req.headers['x-user-id'] || '00000000-0000-0000-0000-000000000000';
      const userId = await ensureUserExists(rawUserId);
      const threads = await chatThreadRepository.getThreadsByUser(userId);
      return successResponse(res, threads, 'Chat sessions retrieved successfully');
    } catch (err) {
      next(err);
    }
  },

  async saveSessions(req, res, next) {
    try {
      const rawUserId = req.user?.id || req.body.user_id || req.headers['x-user-id'] || '00000000-0000-0000-0000-000000000000';
      const userId = await ensureUserExists(rawUserId);
      const { sessions } = req.body;
      const saved = await chatThreadRepository.saveAllThreads(userId, sessions || []);
      return successResponse(res, saved, 'Chat sessions saved successfully');
    } catch (err) {
      next(err);
    }
  },

  async saveSingleSession(req, res, next) {
    try {
      const rawUserId = req.user?.id || req.body.user_id || req.headers['x-user-id'] || '00000000-0000-0000-0000-000000000000';
      const userId = await ensureUserExists(rawUserId);
      const saved = await chatThreadRepository.upsertThread(userId, req.body);
      return successResponse(res, saved, 'Chat session saved successfully');
    } catch (err) {
      next(err);
    }
  },

  async deleteSession(req, res, next) {
    try {
      const rawUserId = req.user?.id || req.query.user_id || req.headers['x-user-id'] || '00000000-0000-0000-0000-000000000000';
      const userId = await ensureUserExists(rawUserId);
      const { id } = req.params;
      const deleted = await chatThreadRepository.deleteThread(userId, id);
      return successResponse(res, deleted, 'Chat session deleted successfully');
    } catch (err) {
      next(err);
    }
  },
};
