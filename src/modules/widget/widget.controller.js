import { widgetService } from './widget.service.js';
import { successResponse } from '../../utils/response.js';
import { resolveOwner, ensureUserExists } from '../../utils/userId.js';
import { settingsRepository } from '../settings/settings.repository.js';
import { visitorsService } from '../visitors/visitors.service.js';

export const widgetController = {
  async getConfig(req, res, next) {
    try {
      const rawIdentifier = req.params.userId || req.user?.id || req.query.namespace;
      const { ownerUserId } = await resolveOwner(rawIdentifier, req.query.namespace || rawIdentifier);
      const config = await widgetService.getConfig(ownerUserId);
      return successResponse(res, config, 'Widget configuration retrieved');
    } catch (err) {
      next(err);
    }
  },

  async updateConfig(req, res, next) {
    try {
      const rawUserId = req.user?.id || req.body.userId;
      const { ownerUserId } = await resolveOwner(rawUserId, req.body.config?.namespace);
      const { config, isPublic } = req.body;
      const updated = await widgetService.updateConfig(ownerUserId, config, isPublic);
      return successResponse(res, updated, 'Widget configuration updated');
    } catch (err) {
      next(err);
    }
  },

  async publicChat(req, res, next) {
    try {
      const {
        query,
        chatHistory,
        userId,
        namespace,
        settings,
        overrideSettings,
        visitorToken,
        sessionToken,
      } = req.body;
      const rawIdentifier = userId || req.params.userId;

      // Resolve the true owner of this widget or namespace
      const { ownerUserId, namespace: resolvedNamespace, source } = await resolveOwner(rawIdentifier, namespace);

      console.log(`[Widget Chat] Resolved owner for '${rawIdentifier || namespace}' -> ${ownerUserId} via ${source}`);

      // Load the owner's server-stored settings (Groq/OpenRouter keys, models, etc.)
      const ownerSettingsRecord = await settingsRepository.getByUserId(ownerUserId);
      const ownerSettings = ownerSettingsRecord?.settings || {};

      // Filter overrideSettings: Visitors MUST NOT overwrite the owner's credentials with empty client values
      const safeOverrides = {};
      const incoming = overrideSettings || settings || {};
      for (const [key, val] of Object.entries(incoming)) {
        if (val !== undefined && val !== null && val !== '') {
          // Never allow external visitors to replace or erase server-configured credentials
          if (key === 'llmApiKey' || key === 'embeddingApiKey') continue;
          safeOverrides[key] = val;
        }
      }

      // Merge: owner's configured credentials and settings are authoritative
      const mergedSettings = { ...ownerSettings, ...safeOverrides };

      const result = await widgetService.publicChat({
        query,
        chatHistory,
        userId: ownerUserId,
        namespace: resolvedNamespace,
        overrideSettings: mergedSettings,
      });

      // Log conversation in visitors system if tokens are provided
      if (visitorToken && sessionToken) {
        try {
          await visitorsService.logChatMessage({
            ownerUserId,
            visitorToken,
            sessionToken,
            agentNamespace: resolvedNamespace,
            role: 'user',
            content: query,
          });

          await visitorsService.logChatMessage({
            ownerUserId,
            visitorToken,
            sessionToken,
            agentNamespace: resolvedNamespace,
            role: 'assistant',
            content: result?.answer || '',
            sources: result?.sources || [],
            tokensUsed: result?.tokensUsed || 0,
            model: result?.model || 'AI Assistant',
          });
        } catch (visErr) {
          console.warn('[Visitors Chat Log] Non-critical warning:', visErr.message);
        }
      }

      return successResponse(res, result, 'Response generated');
    } catch (err) {
      next(err);
    }
  },
};
