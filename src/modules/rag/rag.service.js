import { ragRepository } from './rag.repository.js';
import { settingsRepository } from '../settings/settings.repository.js';
import { getEmbedding } from '../../utils/embedding.js';
import { CONSTANTS } from '../../config/constants.js';

export const ragService = {
  /**
   * Semantic context retrieval using pgvector cosine similarity.
   * Reads embedding config strictly from user DB settings — no hardcoded defaults.
   */
  async retrieveContext({
    query,
    userId,
    namespace = null,
    topK = CONSTANTS.TOP_K_DEFAULT,
    similarityThreshold = CONSTANTS.SIMILARITY_THRESHOLD_DEFAULT,
    overrideSettings = {},
  }) {
    if (!query || !userId) return [];

    const userSettings = await settingsRepository.getByUserId(userId);
    const settings = { ...(userSettings?.settings || {}), ...overrideSettings };

    // Strictly use what the user configured — no silent OpenAI/model fallbacks
    const apiKey = settings.embeddingApiKey || settings.openAiApiKey || settings.llmApiKey || null;
    const model = settings.embeddingModel || null;
    const baseUrl = settings.embeddingBaseUrl || null;

    const queryVector = await getEmbedding(query, apiKey, model, baseUrl);

    return ragRepository.searchSimilarChunks({
      queryVector,
      userId,
      namespace,
      topK,
      similarityThreshold,
    });
  },

  /**
   * Internal retrieval using already-resolved merged settings.
   * Called by generateCompletion to ensure overrideSettings are not lost.
   */
  async _retrieveContextWithSettings({
    query,
    userId,
    namespace = null,
    topK = CONSTANTS.TOP_K_DEFAULT,
    similarityThreshold = CONSTANTS.SIMILARITY_THRESHOLD_DEFAULT,
    settings = {},
  }) {
    if (!query || !userId) return [];

    // Strictly use what is in the merged settings — no fallback to hardcoded OpenAI values
    const apiKey = settings.embeddingApiKey || settings.openAiApiKey || settings.llmApiKey || null;
    const model = settings.embeddingModel || null;
    const baseUrl = settings.embeddingBaseUrl || null;

    console.log(
      `[RAG Retrieval] model=${model || '(none)'} baseUrl=${baseUrl || '(none)'} keyPresent=${!!apiKey}`
    );

    let queryVector;
    try {
      queryVector = await getEmbedding(query, apiKey, model, baseUrl);
    } catch (embErr) {
      console.warn(`[RAG Retrieval] Query embedding failed: ${embErr.message}`);
      console.warn(`[RAG Retrieval] Returning empty sources. Check your embedding settings.`);
      return [];
    }

    const sources = await ragRepository.searchSimilarChunks({
      queryVector,
      userId,
      namespace,
      topK,
      similarityThreshold,
    });

    console.log(
      `[RAG Retrieval] Found ${sources.length} chunks above threshold ${similarityThreshold}`
    );
    return sources;
  },

  /**
   * End-to-end RAG chat completion with grounded citations.
   */
  async generateCompletion({
    query,
    chatHistory = [],
    userId,
    namespace = null,
    useRag = true,
    topK = CONSTANTS.TOP_K_DEFAULT,
    similarityThreshold = CONSTANTS.SIMILARITY_THRESHOLD_DEFAULT,
    overrideSettings = {},
  }) {
    // 1. Load user settings and merge with any client-side overrides
    const stored = await settingsRepository.getByUserId(userId);
    const settings = { ...(stored?.settings || {}), ...overrideSettings };

    // 2. Retrieve vector context using merged settings so embeddingApiKey/Model/BaseUrl
    //    from overrideSettings are actually used — not discarded by a separate DB re-fetch.
    let sources = [];
    if (useRag) {
      sources = await this._retrieveContextWithSettings({
        query,
        userId,
        namespace,
        topK: parseInt(topK || settings.topK || CONSTANTS.TOP_K_DEFAULT, 10),
        similarityThreshold: parseFloat(
          similarityThreshold ||
            settings.similarityThreshold ||
            CONSTANTS.SIMILARITY_THRESHOLD_DEFAULT
        ),
        settings,
      });
    }

    // 3. Build system prompt and context block
    let contextPrompt = '';
    if (sources.length > 0) {
      contextPrompt =
        `\n\n--- RETRIEVED USER KNOWLEDGE BASE CONTEXT (ISOLATED) ---\n` +
        sources
          .map(
            (s, idx) =>
              `[Source ${idx + 1}: ${s.filename} (Chunk #${s.chunkIndex + 1})]\n${s.content}`
          )
          .join('\n\n') +
        `\n--- END CONTEXT ---\n`;
    }

    const systemPrompt = settings.systemPrompt || CONSTANTS.DEFAULT_SYSTEM_PROMPT;
    const messages = [
      { role: 'system', content: `${systemPrompt}${contextPrompt}` },
      ...chatHistory.slice(-8).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: query },
    ];

    // 4. LLM configuration — no hardcoded provider fallbacks
    const llmApiKey = settings.llmApiKey || settings.openAiApiKey || null;
    const llmModel = settings.llmModel || null;
    const llmBaseUrl = settings.llmBaseUrl ? settings.llmBaseUrl.replace(/\/+$/, '') : null;
    const provider = settings.llmProvider || null;

    if (!llmApiKey && provider !== 'ollama') {
      if (sources.length > 0) {
        return {
          answer: `I found **${sources.length} matching passage${sources.length > 1 ? 's' : ''}** in your knowledge base via pgvector, but no **LLM API Key** is configured in Settings to generate AI responses.\n\n### Top Retrieved Passage (${sources[0].filename}, chunk #${sources[0].chunkIndex + 1}):\n\n${sources[0].content}`,
          sources,
          model: 'Local pgvector (LLM Key Required)',
        };
      }
      return {
        answer: `Hello! I'm Aegis. Please configure your **LLM API Key** in **Settings \u2192 AI Model (LLM)** to enable AI responses.`,
        sources: [],
        model: 'Not Configured',
      };
    }

    if (!llmModel || !llmBaseUrl) {
      return {
        answer: `LLM is not fully configured. Please set the **Model Identifier** and **Base URL** in Settings.`,
        sources,
        model: 'Not Configured',
      };
    }

    // 5. Invoke LLM API
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (llmApiKey) headers['Authorization'] = `Bearer ${llmApiKey}`;

      const response = await fetch(`${llmBaseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: llmModel,
          messages,
          temperature: parseFloat(settings.temperature) || 0.7,
          max_tokens: parseInt(settings.maxTokens) || 2048,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LLM Error (${response.status}): ${errorText.slice(0, 300)}`);
      }

      const data = await response.json();
      const answer = data.choices?.[0]?.message?.content || 'No response generated.';
      const tokensUsed = data.usage?.total_tokens || 0;

      return { answer, sources, model: llmModel, tokensUsed };
    } catch (err) {
      console.error('[RAG LLM Error]', err.message);
      return {
        answer: `\u26a0\ufe0f **LLM Error**\n\n${err.message}${sources.length > 0 ? `\n\n---\n*${sources.length} matching passages were retrieved via pgvector.*` : ''}`,
        sources,
        model: llmModel,
        isError: true,
      };
    }
  },
};
