import { knowledgeService } from './knowledge.service.js';
import { successResponse } from '../../utils/response.js';
import { normalizeNamespace } from '../../utils/namespace.js';
import { ensureUserExists } from '../../utils/userId.js';

export const knowledgeController = {
  async ingest(req, res, next) {
    try {
      const rawUserId = req.user?.id || req.body.user_id || req.body.userId;
      const userId = await ensureUserExists(rawUserId);
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

      // Normalize namespace to underscores — must match what ragRepository.searchSimilarChunks uses
      const rawNamespace = namespace || `u_${userId.replace(/-/g, '_')}`;
      const normalizedNamespace = normalizeNamespace(rawNamespace);

      const result = await knowledgeService.ingestDocument({
        userId,
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
      const rawUserId = req.user?.id || req.query.user_id || req.query.userId;
      const userId = await ensureUserExists(rawUserId);
      const { namespace } = req.query;
      const documents = await knowledgeService.listDocuments(userId, namespace);
      return successResponse(res, documents, 'Documents retrieved successfully');
    } catch (err) {
      next(err);
    }
  },

  async getDocument(req, res, next) {
    try {
      const rawUserId = req.user?.id || req.query.user_id || req.query.userId;
      const userId = await ensureUserExists(rawUserId);
      const { id } = req.params;
      const document = await knowledgeService.getDocument(id, userId);
      return successResponse(res, document, 'Document retrieved successfully');
    } catch (err) {
      next(err);
    }
  },

  async deleteDocument(req, res, next) {
    try {
      const rawUserId = req.user?.id || req.body.userId || req.body.user_id;
      const userId = await ensureUserExists(rawUserId);
      const id = req.params.id || req.body.docId || req.body.documentId;
      const result = await knowledgeService.deleteDocument(id, userId);
      return successResponse(res, result, 'Document deleted successfully');
    } catch (err) {
      next(err);
    }
  },
};
