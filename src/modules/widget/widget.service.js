import { widgetRepository } from './widget.repository.js';
import { ragService } from '../rag/rag.service.js';

export const widgetService = {
  async getConfig(userId) {
    let record = await widgetRepository.getByUserId(userId);
    if (!record) {
      const defaultConfig = {
        title: 'Aegis Knowledge Assistant',
        welcomeMessage: 'Hello! Ask me anything about our knowledge base.',
        primaryColor: '#6366f1',
        theme: 'dark',
      };
      record = await widgetRepository.upsert(userId, defaultConfig, true);
    }
    return record;
  },

  async updateConfig(userId, config, isPublic = true) {
    return await widgetRepository.upsert(userId, config, isPublic);
  },

  async publicChat({ query, chatHistory, userId, namespace, overrideSettings = {} }) {
    // Forward to ragService with strict user isolation
    return await ragService.generateCompletion({
      query,
      chatHistory,
      userId,
      namespace,
      useRag: true,
      overrideSettings,
    });
  },
};
