import { settingsRepository } from './settings.repository.js';
import { CONSTANTS } from '../../config/constants.js';

/**
 * Settings service — NO CACHE.
 *
 * Caching was removed because stale settings could prevent updated embedding
 * keys/models from being picked up immediately during ingest and retrieval.
 * Settings are small and DB reads are fast (indexed by user_id), so the
 * overhead of bypassing cache is negligible.
 */
export const settingsService = {
  async getSettings(userId) {
    const record = await settingsRepository.getByUserId(userId);
    if (!record) {
      // Seed ONLY provider-agnostic defaults.
      // Never seed llmModel, llmBaseUrl, embeddingModel, embeddingBaseUrl, apiKeys —
      // those must come from the user's own Settings page.
      const minimalDefaults = {
        systemPrompt: CONSTANTS.DEFAULT_SYSTEM_PROMPT,
        topK: CONSTANTS.TOP_K_DEFAULT,
        similarityThreshold: CONSTANTS.SIMILARITY_THRESHOLD_DEFAULT,
        temperature: 0.7,
        maxTokens: 2048,
      };
      const created = await settingsRepository.upsert(userId, minimalDefaults);
      return created.settings;
    }
    return record.settings;
  },

  async updateSettings(userId, newSettings) {
    // Always merge with existing to avoid overwriting fields not included in this update
    const existing = await this.getSettings(userId);
    const cleanedUpdates = { ...newSettings };
    // Prevent accidental wipe of existing credentials if incoming update contains blank/empty strings
    if (existing.llmApiKey && (cleanedUpdates.llmApiKey === '' || cleanedUpdates.llmApiKey === null || cleanedUpdates.llmApiKey === undefined)) {
      delete cleanedUpdates.llmApiKey;
    }
    if (existing.embeddingApiKey && (cleanedUpdates.embeddingApiKey === '' || cleanedUpdates.embeddingApiKey === null || cleanedUpdates.embeddingApiKey === undefined)) {
      delete cleanedUpdates.embeddingApiKey;
    }
    const merged = { ...existing, ...cleanedUpdates };
    const updated = await settingsRepository.upsert(userId, merged);
    return updated.settings;
  },
};
