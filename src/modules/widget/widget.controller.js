import { widgetService } from './widget.service.js';
import { successResponse, errorResponse } from '../../utils/response.js';
import { resolveOwner } from '../../utils/userId.js';
import { settingsRepository } from '../settings/settings.repository.js';
import { visitorsService } from '../visitors/visitors.service.js';

export const widgetController = {
  async getConfig(req, res, next) {
    try {
      const rawIdentifier = req.params.userId || req.user?.id || req.query.namespace;
      if (!rawIdentifier) {
        return errorResponse(res, 'Widget owner identifier or namespace required', 400);
      }
      const { ownerUserId } = await resolveOwner(rawIdentifier, req.query.namespace || rawIdentifier);
      if (!ownerUserId) {
        return errorResponse(res, 'Widget configuration not found', 404);
      }
      const config = await widgetService.getConfig(ownerUserId);
      return successResponse(res, config, 'Widget configuration retrieved');
    } catch (err) {
      next(err);
    }
  },

  async updateConfig(req, res, next) {
    try {
      const ownerUserId = req.user.id;
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

      if (!ownerUserId) {
        return errorResponse(res, 'Widget owner or knowledge base not found', 404);
      }

      console.log(`[Widget Chat] Resolved owner for '${rawIdentifier || namespace}' -> ${ownerUserId} via ${source}`);

      // Load the owner's server-stored settings
      const ownerSettingsRecord = await settingsRepository.getByUserId(ownerUserId);
      const ownerSettings = ownerSettingsRecord?.settings || {};

      // Filter overrideSettings: Visitors MUST NOT overwrite the owner's credentials with empty client values
      const safeOverrides = {};
      const incoming = overrideSettings || settings || {};
      for (const [key, val] of Object.entries(incoming)) {
        if (val !== undefined && val !== null && val !== '') {
          if (key === 'llmApiKey' || key === 'embeddingApiKey') continue;
          safeOverrides[key] = val;
        }
      }

      // Merge: owner's configured credentials and settings are authoritative
      const mergedSettings = { ...ownerSettings, ...safeOverrides };

      if (req.body.stream === true || req.headers.accept?.includes('text/event-stream')) {
        return this.publicChatStream(req, res, next);
      }

      const result = await widgetService.publicChat({
        query,
        chatHistory,
        userId: ownerUserId,
        namespace: resolvedNamespace,
        overrideSettings: mergedSettings,
      });

      // Log conversation in visitors system only for genuine non-admin visitors
      const isAdminTraffic =
        Boolean(req.user) ||
        req.body.isAdmin === true ||
        req.query.admin === '1';

      if (!isAdminTraffic && visitorToken && sessionToken) {
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

  async publicChatStream(req, res, next) {
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

      const { ownerUserId, namespace: resolvedNamespace, source } = await resolveOwner(rawIdentifier, namespace);

      if (!ownerUserId) {
        return errorResponse(res, 'Widget owner or knowledge base not found', 404);
      }

      console.log(`[Widget Chat Stream] Resolved owner for '${rawIdentifier || namespace}' -> ${ownerUserId} via ${source}`);

      const ownerSettingsRecord = await settingsRepository.getByUserId(ownerUserId);
      const ownerSettings = ownerSettingsRecord?.settings || {};

      const safeOverrides = {};
      const incoming = overrideSettings || settings || {};
      for (const [key, val] of Object.entries(incoming)) {
        if (val !== undefined && val !== null && val !== '') {
          if (key === 'llmApiKey' || key === 'embeddingApiKey') continue;
          safeOverrides[key] = val;
        }
      }

      const mergedSettings = { ...ownerSettings, ...safeOverrides };

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders?.();

      let clientDisconnected = false;
      req.on('close', () => {
        clientDisconnected = true;
      });

      const sendEvent = (eventType, payload) => {
        if (clientDisconnected || res.writableEnded) return;
        res.write(`data: ${JSON.stringify({ type: eventType, ...payload })}\n\n`);
      };

      const isAdminTraffic =
        Boolean(req.user) ||
        req.body.isAdmin === true ||
        req.query.admin === '1';

      await widgetService.publicChatStream({
        query,
        chatHistory,
        userId: ownerUserId,
        namespace: resolvedNamespace,
        overrideSettings: mergedSettings,
        onEvent: async (event, data) => {
          if (clientDisconnected || res.writableEnded) return;

          if (event === 'sources') {
            sendEvent('sources', { sources: data });
          } else if (event === 'reasoning') {
            sendEvent('reasoning', { delta: data.delta });
          } else if (event === 'token') {
            sendEvent('token', { delta: data.delta });
          } else if (event === 'done') {
            sendEvent('done', {
              answer: data.answer,
              reasoning: data.reasoning || '',
              sources: data.sources,
              model: data.model,
              isError: data.isError || false,
            });

            // Asynchronously log visitor conversation upon completion
            if (!isAdminTraffic && visitorToken && sessionToken) {
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
                  content: data.answer || '',
                  sources: data.sources || [],
                  tokensUsed: data.tokensUsed || 0,
                  model: data.model || 'AI Assistant',
                });
              } catch (visErr) {
                console.warn('[Visitors Stream Chat Log] Non-critical warning:', visErr.message);
              }
            }

            if (!res.writableEnded) {
              res.end();
            }
          }
        },
      });
    } catch (err) {
      if (!res.headersSent) {
        return next(err);
      }
      try {
        res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
        res.end();
      } catch (_) {}
    }
  },
};
