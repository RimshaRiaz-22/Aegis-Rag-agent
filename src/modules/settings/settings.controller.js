import { settingsService } from './settings.service.js';
import { successResponse } from '../../utils/response.js';
import { ensureUserExists } from '../../utils/userId.js';

export const settingsController = {
  async getSettings(req, res, next) {
    try {
      const rawUserId = req.user?.id || req.query.user_id || req.headers['x-user-id'] || '00000000-0000-0000-0000-000000000000';
      const userId = await ensureUserExists(rawUserId);
      const settings = await settingsService.getSettings(userId);
      return successResponse(res, settings, 'Settings retrieved successfully');
    } catch (err) {
      next(err);
    }
  },

  async updateSettings(req, res, next) {
    try {
      const rawUserId = req.user?.id || req.body.user_id || req.headers['x-user-id'] || '00000000-0000-0000-0000-000000000000';
      const userId = await ensureUserExists(rawUserId);
      const settings = await settingsService.updateSettings(userId, req.body);
      return successResponse(res, settings, 'Settings updated successfully');
    } catch (err) {
      next(err);
    }
  },
};
