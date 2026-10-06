import { knowledgeService } from './knowledge.service.js';
import { urlScraperService } from './urlScraper.service.js';
import { successResponse, errorResponse } from '../../utils/response.js';
import { normalizeNamespace } from '../../utils/namespace.js';

export const knowledgeController = {
  async scrapeUrl(req, res, next) {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return errorResponse(res, 'Tenant identity required', 401);
      }

      const { url, title, namespace, overrideSettings, settings, metadata } = req.body;
      if (!url) {
        return errorResponse(res, 'Target URL is required', 400);
      }

      const rawNamespace = namespace || `u_${tenantId.replace(/-/g, '_')}`;
      const normalizedNamespace = normalizeNamespace(rawNamespace);

      const result = await urlScraperService.scrapeAndIngest({
        url,
        userId: tenantId,
        namespace: normalizedNamespace,
        customTitle: title,
        overrideSettings: overrideSettings || settings || {},
        metadata: metadata || {},
      });

      return successResponse(res, result, 'Webpage scraped and indexed successfully', 201);
    } catch (err) {
      next(err);
    }
  },
  async ingest(req, res, next) {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return errorResponse(res, 'Tenant identity required for document upload', 401);
      }

      const {
        docId,
        documentId,
        filename,
        fileType,
        fileSize,
        content,
        chunks,
        metadata,
        namespace,
        settings,
        overrideSettings,
      } = req.body;

      // Normalize namespace to underscores
      const rawNamespace = namespace || `u_${tenantId.replace(/-/g, '_')}`;
      const normalizedNamespace = normalizeNamespace(rawNamespace);

      const result = await knowledgeService.ingestDocument({
        userId: tenantId,
        docId: docId || documentId,
        filename: filename || 'Uploaded Document',
        fileType,
        fileSize,
        content,
        chunks,
        metadata,
        namespace: normalizedNamespace,
        overrideSettings: overrideSettings || settings || {},
      });

      return successResponse(res, result, 'Document ingested and indexed successfully', 201);
    } catch (err) {
      next(err);
    }
  },

  async listDocuments(req, res, next) {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return errorResponse(res, 'Tenant identity required', 401);
      }
      const { namespace } = req.query;
      const documents = await knowledgeService.listDocuments(tenantId, namespace);
      return successResponse(res, documents, 'Documents retrieved successfully');
    } catch (err) {
      next(err);
    }
  },

  async getDocument(req, res, next) {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return errorResponse(res, 'Tenant identity required', 401);
      }
      const { id } = req.params;
      const document = await knowledgeService.getDocument(id, tenantId);
      return successResponse(res, document, 'Document retrieved successfully');
    } catch (err) {
      next(err);
    }
  },

  async deleteDocument(req, res, next) {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return errorResponse(res, 'Tenant identity required', 401);
      }
      const id = req.params.id || req.body?.docId || req.body?.documentId;
      const result = await knowledgeService.deleteDocument(id, tenantId);
      return successResponse(res, result, 'Document deleted successfully');
    } catch (err) {
      next(err);
    }
  },
};
