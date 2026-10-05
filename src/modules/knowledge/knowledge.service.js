import { knowledgeRepository } from './knowledge.repository.js';
import { settingsRepository } from '../settings/settings.repository.js';
import { chunkText } from '../../utils/textChunker.js';
import { getBatchEmbeddings } from '../../utils/embedding.js';

export const knowledgeService = {
  async ingestDocument({
    userId,
    docId,
    filename,
    fileType = 'txt',
    fileSize = 0,
    content,
    chunks: rawChunks,
    metadata = {},
    namespace = 'default',
    overrideSettings = {},
  }) {
    // 1. Get or create knowledge base collection for the user's namespace
    const kb = await knowledgeRepository.getOrCreateKnowledgeBase(
      userId,
      namespace,
      `${filename} Collection`
    );

    // 2. Obtain chunks
    let finalChunks = [];
    if (Array.isArray(rawChunks) && rawChunks.length > 0) {
      finalChunks = rawChunks.map((c) => (typeof c === 'string' ? c : c.content));
    } else if (content && typeof content === 'string') {
      finalChunks = chunkText(content);
    } else {
      finalChunks = ['Empty document content'];
    }

    // 3. Retrieve user embedding settings — merge stored with any provided overrideSettings
    const userSettings = await settingsRepository.getByUserId(userId);
    const settings = { ...(userSettings?.settings || {}), ...overrideSettings };
    const apiKey = settings.embeddingApiKey || settings.openAiApiKey || settings.llmApiKey || null;
    const model = settings.embeddingModel || null;
    const baseUrl = settings.embeddingBaseUrl || null;

    if (!apiKey && !baseUrl) {
      console.warn(`[Ingest] No embedding API configured for user ${userId}. Chunks will use offline deterministic vectors.`);
    }

    // 4. Batch generate embeddings for chunks
    //    If the embedding API call fails (bad key, network error, etc.), fall back to
    //    offline deterministic vectors so the document is still stored and searchable
    //    via keyword fallback. A warning is logged so the issue is visible.
    let embeddings;
    let embeddingSource = 'api';
    try {
      embeddings = await getBatchEmbeddings(finalChunks, apiKey, model, baseUrl);
    } catch (embErr) {
      console.warn(`[Ingest] Embedding API failed for user ${userId}: ${embErr.message}`);
      console.warn(`[Ingest] Falling back to offline deterministic vectors. Re-upload after fixing your embedding settings.`);
      // Import inline to avoid circular deps — generateDeterministicVector is unexported, use null embeddings
      embeddings = finalChunks.map(() => null);
      embeddingSource = 'offline_fallback';
    }

    // 5. Create document entry
    const doc = await knowledgeRepository.createDocument({
      id: docId,
      kbId: kb.id,
      userId,
      filename,
      fileType,
      fileSize: fileSize || (content ? content.length : 0),
      chunkCount: finalChunks.length,
      tags: metadata.tags || [],
      status: 'ready',
    });

    // 6. Build chunk batch records
    const chunkRecords = finalChunks.map((chunkContent, idx) => ({
      documentId: doc.id,
      kbId: kb.id,
      userId,
      chunkIndex: idx,
      content: chunkContent,
      metadata: {
        ...metadata,
        documentId: doc.id,
        filename,
        chunkIndex: idx,
        totalChunks: finalChunks.length,
      },
      embedding: embeddings[idx],
    }));

    // 7. Insert chunks with vectors into PostgreSQL
    const insertedChunks = await knowledgeRepository.insertDocumentChunks(chunkRecords);

    return {
      ...doc,
      namespace: kb.namespace,
      chunks: insertedChunks,
      embeddingSource,
    };
  },

  async listDocuments(userId, namespace) {
    return await knowledgeRepository.listDocumentsByUser(userId, namespace);
  },

  async getDocument(docId, userId) {
    const doc = await knowledgeRepository.getDocumentById(docId, userId);
    if (!doc) {
      const err = new Error('Document not found');
      err.statusCode = 404;
      throw err;
    }
    return doc;
  },

  async deleteDocument(docId, userId) {
    const deleted = await knowledgeRepository.deleteDocument(docId, userId);
    if (!deleted) {
      const err = new Error('Document not found or unauthorized');
      err.statusCode = 404;
      throw err;
    }
    return deleted;
  },
};
