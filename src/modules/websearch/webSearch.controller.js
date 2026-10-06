import { webSearchService } from './webSearch.service.js';
import { successResponse } from '../../utils/response.js';
import { settingsRepository } from '../settings/settings.repository.js';

export const webSearchController = {
  async search(req, res, next) {
    try {
      const { query, maxResults } = req.body;
      const tenantId = req.tenantId;
      let tavilyApiKey = null;
      if (tenantId) {
        const stored = await settingsRepository.getByUserId(tenantId);
        tavilyApiKey = stored?.settings?.tavilyApiKey || null;
      }
      const results = await webSearchService.search(query, {
        maxResults: maxResults || 5,
        tavilyApiKey,
      });
      return successResponse(res, results, 'Web search completed');
    } catch (err) {
      next(err);
    }
  },
};
