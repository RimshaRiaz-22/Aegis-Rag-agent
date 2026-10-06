import { settingsService } from './settings.service.js';
import { successResponse, errorResponse } from '../../utils/response.js';

export const settingsController = {
  async getSettings(req, res, next) {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return errorResponse(res, 'Tenant identity required', 401);
      }
      const settings = await settingsService.getSettings(tenantId);
      return successResponse(res, settings, 'Settings retrieved successfully');
    } catch (err) {
      next(err);
    }
  },

  async updateSettings(req, res, next) {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return errorResponse(res, 'Tenant identity required', 401);
      }
      const settings = await settingsService.updateSettings(tenantId, req.body);
      return successResponse(res, settings, 'Settings updated successfully');
    } catch (err) {
      next(err);
    }
  },
};
