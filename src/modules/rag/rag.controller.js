import { ragService } from './rag.service.js';
import { successResponse } from '../../utils/response.js';
import { normalizeNamespace } from '../../utils/namespace.js';
import { resolveOwner, ensureUserExists } from '../../utils/userId.js';
import { settingsRepository } from '../settings/settings.repository.js';

export const ragController = {
  async retrieve(req, res, next) {
    try {
      const rawUserId = req.user?.id || req.body.user_id || req.body.userId;
      const { ownerUserId, namespace: resolvedNamespace } = await resolveOwner(rawUserId, req.body.namespace);
      const { query, topK, similarityThreshold, settings, overrideSettings } = req.body;

      // Load stored owner settings to provide embedding credentials if not supplied
      const ownerSettingsRecord = await settingsRepository.getByUserId(ownerUserId);
      const ownerSettings = ownerSettingsRecord?.settings || {};
      const incoming = overrideSettings || settings || {};
      const safeOverrides = {};
      for (const [k, v] of Object.entries(incoming)) {
        if (v !== undefined && v !== null && v !== '') {
          safeOverrides[k] = v;
        }
      }

      const sources = await ragService.retrieveContext({
        query,
        userId: ownerUserId,
        namespace: normalizeNamespace(resolvedNamespace || req.body.namespace),
        topK,
        similarityThreshold,
        overrideSettings: { ...ownerSettings, ...safeOverrides },
      });

      return successResponse(res, { sources }, 'Context retrieved successfully');
    } catch (err) {
      next(err);
    }
  },

  async chat(req, res, next) {
    try {
      const rawUserId = req.user?.id || req.body.user_id || req.body.userId;
      const { ownerUserId, namespace: resolvedNamespace } = await resolveOwner(rawUserId, req.body.namespace);
      const {
        query,
        chatHistory,
        useRag,
        topK,
        similarityThreshold,
        settings,
        overrideSettings,
      } = req.body;

      // Load stored owner settings
      const ownerSettingsRecord = await settingsRepository.getByUserId(ownerUserId);
      const ownerSettings = ownerSettingsRecord?.settings || {};
      const incoming = overrideSettings || settings || {};
      const safeOverrides = {};
      for (const [k, v] of Object.entries(incoming)) {
        if (v !== undefined && v !== null && v !== '') {
          // If unauthenticated call without token, do not let empty client key wipe owner key
          if (!req.user && (k === 'llmApiKey' || k === 'embeddingApiKey')) continue;
          safeOverrides[k] = v;
        }
      }

      const result = await ragService.generateCompletion({
        query,
        chatHistory,
        userId: ownerUserId,
        namespace: normalizeNamespace(resolvedNamespace || req.body.namespace),
        useRag,
        topK,
        similarityThreshold,
        overrideSettings: { ...ownerSettings, ...safeOverrides },
      });

      return successResponse(res, result, 'RAG completion generated successfully');
    } catch (err) {
      next(err);
    }
  },
};
