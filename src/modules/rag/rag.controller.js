import { ragService } from './rag.service.js';
import { successResponse, errorResponse } from '../../utils/response.js';
import { normalizeNamespace } from '../../utils/namespace.js';
import { settingsRepository } from '../settings/settings.repository.js';

export const ragController = {
  async retrieve(req, res, next) {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return errorResponse(res, 'Tenant identity required', 401);
      }

      const { query, topK, similarityThreshold, settings, overrideSettings, namespace } = req.body;
      const targetNamespace = normalizeNamespace(namespace || `u_${tenantId.replace(/-/g, '_')}`);

      // Load this tenant's stored settings (never another user's)
      const userSettingsRecord = await settingsRepository.getByUserId(tenantId);
      const userSettings = userSettingsRecord?.settings || {};
      const incoming = overrideSettings || settings || {};
      const safeOverrides = {};
      for (const [k, v] of Object.entries(incoming)) {
        if (v !== undefined && v !== null && v !== '') {
          safeOverrides[k] = v;
        }
      }

      const sources = await ragService.retrieveContext({
        query,
        userId: tenantId,
        namespace: targetNamespace,
        topK,
        similarityThreshold,
        overrideSettings: { ...userSettings, ...safeOverrides },
      });

      return successResponse(res, { sources }, 'Context retrieved successfully');
    } catch (err) {
      next(err);
    }
  },

  async chat(req, res, next) {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return errorResponse(res, 'Tenant identity required', 401);
      }

      const {
        query,
        chatHistory,
        useRag,
        topK,
        similarityThreshold,
        settings,
        overrideSettings,
        enableWebSearch,
        webSearch,
        namespace,
      } = req.body;

      const targetNamespace = normalizeNamespace(namespace || `u_${tenantId.replace(/-/g, '_')}`);

      // Load this tenant's stored settings (never another user's)
      const userSettingsRecord = await settingsRepository.getByUserId(tenantId);
      const userSettings = userSettingsRecord?.settings || {};
      const incoming = overrideSettings || settings || {};
      const safeOverrides = {};
      for (const [k, v] of Object.entries(incoming)) {
        if (v !== undefined && v !== null && v !== '') {
          safeOverrides[k] = v;
        }
      }

      if (req.body.stream === true || req.headers.accept?.includes('text/event-stream')) {
        return this.chatStream(req, res, next);
      }

      const result = await ragService.generateCompletion({
        query,
        chatHistory,
        userId: tenantId,
        namespace: targetNamespace,
        useRag,
        topK,
        similarityThreshold,
        overrideSettings: { ...userSettings, ...safeOverrides },
        enableWebSearch: Boolean(enableWebSearch || webSearch),
        isWidget: false,
      });

      return successResponse(res, result, 'RAG completion generated successfully');
    } catch (err) {
      next(err);
    }
  },

  async chatStream(req, res, next) {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return errorResponse(res, 'Tenant identity required', 401);
      }

      const {
        query,
        chatHistory,
        useRag,
        topK,
        similarityThreshold,
        settings,
        overrideSettings,
        enableWebSearch,
        webSearch,
        namespace,
      } = req.body;

      const targetNamespace = normalizeNamespace(namespace || `u_${tenantId.replace(/-/g, '_')}`);

      const userSettingsRecord = await settingsRepository.getByUserId(tenantId);
      const userSettings = userSettingsRecord?.settings || {};
      const incoming = overrideSettings || settings || {};
      const safeOverrides = {};
      for (const [k, v] of Object.entries(incoming)) {
        if (v !== undefined && v !== null && v !== '') {
          safeOverrides[k] = v;
        }
      }

      // Establish Server-Sent Events headers
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

      await ragService.generateCompletionStream({
        query,
        chatHistory,
        userId: tenantId,
        namespace: targetNamespace,
        useRag,
        topK,
        similarityThreshold,
        overrideSettings: { ...userSettings, ...safeOverrides },
        enableWebSearch: Boolean(enableWebSearch || webSearch),
        isWidget: false,
        onEvent: (event, data) => {
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
