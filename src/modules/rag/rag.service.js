import { ragRepository } from './rag.repository.js';
import { settingsRepository } from '../settings/settings.repository.js';
import { getEmbedding } from '../../utils/embedding.js';
import { CONSTANTS } from '../../config/constants.js';
import { buildGuardrailedSystemPrompt, isAdversarialPromptExfiltration } from './rag.guardrails.js';
import { knowledgeService } from '../knowledge/knowledge.service.js';
import { webSearchService } from '../websearch/webSearch.service.js';

/**
 * Detects if user wants to save a fact/policy into workspace knowledge base memory
 */
function detectMemorySaveIntent(query) {
  if (!query || typeof query !== 'string') return null;
  const trimmed = query.trim();
  const patterns = [
    /^(?:please\s+)?(?:can you\s+)?save\s+(?:this\s+)?(?:in|to|into)\s+(?:memory|knowledge\s*base|kb)(?:\s*:\s*|\s+that\s+|\s+)(.+)$/i,
    /^(?:please\s+)?(?:can you\s+)?store\s+(?:this\s+)?(?:in|to|into)\s+(?:memory|knowledge\s*base|kb)(?:\s*:\s*|\s+that\s+|\s+)(.+)$/i,
    /^(?:please\s+)?(?:can you\s+)?remember\s+(?:that|this)(?:\s*:\s*|\s+)(.+)$/i,
    /^(?:please\s+)?(?:can you\s+)?keep\s+in\s+mind\s+(?:that\s+)(.+)$/i,
    /^(?:please\s+)?(?:can you\s+)?add\s+(?:this\s+)?to\s+(?:memory|knowledge\s*base|kb)(?:\s*:\s*|\s+that\s+|\s+)(.+)$/i,
  ];

  for (const p of patterns) {
    const match = trimmed.match(p);
    if (match && match[1] && match[1].trim().length > 2) {
      return match[1].trim();
    }
  }
  return null;
}

export const ragService = {
  /**
   * Enterprise Hybrid Retrieval (Dense Vector + Sparse Full-Text / RRF).
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

    const apiKey = settings.embeddingApiKey || settings.openAiApiKey || settings.llmApiKey || null;
    const model = settings.embeddingModel || null;
    const baseUrl = settings.embeddingBaseUrl || null;

    let queryVector = null;
    try {
      queryVector = await getEmbedding(query, apiKey, model, baseUrl);
    } catch (embErr) {
      console.warn(`[RAG Retrieval] Embedding generation failed, falling back to full-text:`, embErr.message);
    }

    return ragRepository.searchSimilarChunks({
      queryText: query,
      queryVector,
      userId,
      namespace,
      topK,
      similarityThreshold,
    });
  },

  /**
   * Internal hybrid retrieval with already-resolved merged settings.
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

    const apiKey = settings.embeddingApiKey || settings.openAiApiKey || settings.llmApiKey || null;
    const model = settings.embeddingModel || null;
    const baseUrl = settings.embeddingBaseUrl || null;

    let queryVector = null;
    try {
      queryVector = await getEmbedding(query, apiKey, model, baseUrl);
    } catch (embErr) {
      console.warn(`[RAG Retrieval] Query embedding generation failed, using lexical full-text:`, embErr.message);
    }

    const sources = await ragRepository.searchSimilarChunks({
      queryText: query,
      queryVector,
      userId,
      namespace,
      topK,
      similarityThreshold,
    });

    return sources;
  },

  /**
   * End-to-end RAG chat completion with grounded citations (Non-streaming).
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
    enableWebSearch = false,
    isWidget = false,
  }) {
    const stored = await settingsRepository.getByUserId(userId);
    const settings = { ...(stored?.settings || {}), ...overrideSettings };

    // Continuous KB Learning: "save this in memory"
    if (!isWidget) {
      const memoryFact = detectMemorySaveIntent(query);
      if (memoryFact) {
        try {
          const safeTitle =
            memoryFact.slice(0, 35).replace(/[^a-zA-Z0-9 ]/g, '').trim() || 'Learned Fact';
          const filename = `[Memory] ${safeTitle}.txt`;
          const docId = `mem_${Date.now()}`;
          const currentNs = namespace || `u_${String(userId).toLowerCase().replace(/[^a-z0-9_]/g, '_')}`;

          const memoryDoc = await knowledgeService.ingestDocument({
            userId,
            docId,
            filename,
            fileType: 'memory',
            fileSize: memoryFact.length,
            content: memoryFact,
            chunks: [memoryFact],
            metadata: {
              source: 'chat_memory',
              tags: ['memory', 'learned'],
              savedAt: new Date().toISOString(),
            },
            namespace: currentNs,
            overrideSettings: settings,
          });

          return {
            answer: `💾 **Saved to Knowledge Base Memory**\n\n> "${memoryFact}"\n\nThis fact has been vectorized and stored in your workspace knowledge base (\`${currentNs}\`). It is now immediately active and will be used by both your conversations and public visitors via the embed widget.`,
            sources: [
              {
                id: memoryDoc.id || docId,
                filename,
                chunkIndex: 0,
                content: memoryFact,
                score: 1.0,
                metadata: { source: 'chat_memory', tags: ['memory', 'learned'] },
              },
            ],
            model: settings.llmModel || 'Knowledge Base Memory',
            memoryAction: {
              type: 'saved',
              content: memoryFact,
              filename,
              docId: memoryDoc.id || docId,
            },
          };
        } catch (memErr) {
          console.error('[Memory Save Error]', memErr);
        }
      }
    }

    // Hybrid context retrieval
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

    // Live Web Search (if enabled)
    let webSources = [];
    if (enableWebSearch && !isWidget) {
      try {
        webSources = await webSearchService.search(query, {
          maxResults: 4,
          tavilyApiKey: settings.tavilyApiKey,
        });
      } catch (searchErr) {
        console.warn('[RAG Web Search Failed]', searchErr.message);
      }
    }

    // Guardrail prompt exfiltration checks
    if (isAdversarialPromptExfiltration(query)) {
      return {
        answer:
          'I apologize, but I cannot fulfill requests to alter core security policies, reveal system configurations, or bypass safety boundaries. I am here to assist with questions based strictly on the provided knowledge base.',
        sources: [],
        model: settings.llmModel || 'Security Guardrail',
      };
    }

    const persona = settings.systemPrompt || settings.persona || CONSTANTS.DEFAULT_SYSTEM_PROMPT;
    const guardedSystemPrompt = buildGuardrailedSystemPrompt({
      persona,
      sources,
      webSources,
      isWidget,
    });

    const messages = [
      { role: 'system', content: guardedSystemPrompt },
      ...chatHistory.slice(-8).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: query },
    ];

    const llmApiKey = settings.llmApiKey || settings.openAiApiKey || null;
    const llmModel = settings.llmModel || null;
    const llmBaseUrl = settings.llmBaseUrl ? settings.llmBaseUrl.replace(/\/+$/, '') : null;
    const provider = settings.llmProvider || null;

    if (!llmApiKey && provider !== 'ollama') {
      if (sources.length > 0) {
        return {
          answer: `Here is the relevant information found in your files:\n\n${sources[0].content}\n\n*(To get AI-generated answers, please add an API key in **Settings**.)*`,
          sources,
          model: 'API Key Required',
        };
      }
      return {
        answer: `Hello! Please add your AI model API key in **Settings** to start chatting.`,
        sources: [],
        model: 'API Key Required',
      };
    }

    if (!llmModel || !llmBaseUrl) {
      return {
        answer: `Please configure your AI model and API key in **Settings** to start chatting.`,
        sources,
        model: 'Not Configured',
      };
    }

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

      const allSources = [
        ...sources,
        ...webSources.map((w, idx) => ({
          id: `web_${idx}_${Date.now()}`,
          filename: w.title,
          url: w.url,
          content: w.snippet,
          isWeb: true,
          score: 0.95,
        })),
      ];

      return { answer, sources: allSources, model: llmModel, tokensUsed };
    } catch (err) {
      console.error('[RAG LLM Error]', err.message);
      const allSources = [
        ...sources,
        ...webSources.map((w, idx) => ({
          id: `web_${idx}_${Date.now()}`,
          filename: w.title,
          url: w.url,
          content: w.snippet,
          isWeb: true,
          score: 0.95,
        })),
      ];
      return {
        answer: `⚠️ **Service Temporarily Unavailable**\n\nWe encountered an issue while generating a response. Please verify your configuration in Settings or try again shortly.${allSources.length > 0 ? `\n\n---\n*${allSources.length} matching sources were retrieved.*` : ''}`,
        sources: allSources,
        model: llmModel,
        isError: true,
      };
    }
  },

  /**
   * Enterprise Real-Time Streaming RAG Completion (Server-Sent Events).
   * Emits tokens as they arrive from LLM provider.
   */
  async generateCompletionStream({
    query,
    chatHistory = [],
    userId,
    namespace = null,
    useRag = true,
    topK = CONSTANTS.TOP_K_DEFAULT,
    similarityThreshold = CONSTANTS.SIMILARITY_THRESHOLD_DEFAULT,
    overrideSettings = {},
    enableWebSearch = false,
    isWidget = false,
    onEvent,
  }) {
    const stored = await settingsRepository.getByUserId(userId);
    const settings = { ...(stored?.settings || {}), ...overrideSettings };

    // Continuous KB Memory
    if (!isWidget) {
      const memoryFact = detectMemorySaveIntent(query);
      if (memoryFact) {
        try {
          const safeTitle =
            memoryFact.slice(0, 35).replace(/[^a-zA-Z0-9 ]/g, '').trim() || 'Learned Fact';
          const filename = `[Memory] ${safeTitle}.txt`;
          const docId = `mem_${Date.now()}`;
          const currentNs = namespace || `u_${String(userId).toLowerCase().replace(/[^a-z0-9_]/g, '_')}`;

          const memoryDoc = await knowledgeService.ingestDocument({
            userId,
            docId,
            filename,
            fileType: 'memory',
            fileSize: memoryFact.length,
            content: memoryFact,
            chunks: [memoryFact],
            metadata: {
              source: 'chat_memory',
              tags: ['memory', 'learned'],
              savedAt: new Date().toISOString(),
            },
            namespace: currentNs,
            overrideSettings: settings,
          });

          const memoryAns = `💾 **Saved to Knowledge Base Memory**\n\n> "${memoryFact}"\n\nThis fact has been vectorized and stored in your workspace knowledge base (\`${currentNs}\`). It is now immediately active and will be used by both your conversations and public visitors via the embed widget.`;
          onEvent('sources', [{
            id: memoryDoc.id || docId,
            filename,
            chunkIndex: 0,
            content: memoryFact,
            score: 1.0,
            metadata: { source: 'chat_memory', tags: ['memory', 'learned'] },
          }]);
          onEvent('token', { delta: memoryAns });
          onEvent('done', {
            answer: memoryAns,
            sources: [{ id: memoryDoc.id || docId, filename, content: memoryFact, score: 1.0 }],
            model: settings.llmModel || 'Memory Engine',
          });
          return;
        } catch (memErr) {
          console.error('[Memory Save Error]', memErr);
        }
      }
    }

    // Hybrid retrieval
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

    // Web Search
    let webSources = [];
    if (enableWebSearch && !isWidget) {
      try {
        webSources = await webSearchService.search(query, {
          maxResults: 4,
          tavilyApiKey: settings.tavilyApiKey,
        });
      } catch (searchErr) {
        console.warn('[RAG Web Search Failed]', searchErr.message);
      }
    }

    const allSources = [
      ...sources,
      ...webSources.map((w, idx) => ({
        id: `web_${idx}_${Date.now()}`,
        filename: w.title,
        url: w.url,
        content: w.snippet,
        isWeb: true,
        score: 0.95,
      })),
    ];

    // Emit sources immediately before generation begins
    onEvent('sources', allSources);

    // Guardrail prompt exfiltration check
    if (isAdversarialPromptExfiltration(query)) {
      const refusal = 'I apologize, but I cannot fulfill requests to alter core security policies, reveal system configurations, or bypass safety boundaries.';
      onEvent('token', { delta: refusal });
      onEvent('done', { answer: refusal, sources: [], model: 'Security Guardrail' });
      return;
    }

    const persona = settings.systemPrompt || settings.persona || CONSTANTS.DEFAULT_SYSTEM_PROMPT;
    const guardedSystemPrompt = buildGuardrailedSystemPrompt({
      persona,
      sources,
      webSources,
      isWidget,
    });

    const messages = [
      { role: 'system', content: guardedSystemPrompt },
      ...chatHistory.slice(-8).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: query },
    ];

    const llmApiKey = settings.llmApiKey || settings.openAiApiKey || null;
    const llmModel = settings.llmModel || null;
    const llmBaseUrl = settings.llmBaseUrl ? settings.llmBaseUrl.replace(/\/+$/, '') : null;
    const provider = settings.llmProvider || null;

    if (!llmApiKey && provider !== 'ollama') {
      const msg = sources.length > 0
        ? `Here is the relevant information found in your files:\n\n${sources[0].content}\n\n*(To get AI-generated answers, please add an API key in **Settings**.)*`
        : `Hello! Please add your AI model API key in **Settings** to start chatting.`;
      onEvent('token', { delta: msg });
      onEvent('done', { answer: msg, sources: allSources, model: 'API Key Required' });
      return;
    }

    if (!llmModel || !llmBaseUrl) {
      const msg = `Please configure your AI model and API key in **Settings** to start chatting.`;
      onEvent('token', { delta: msg });
      onEvent('done', { answer: msg, sources: allSources, model: 'Not Configured' });
      return;
    }

    // Call LLM with stream: true
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
          stream: true,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`LLM HTTP Error (${response.status}): ${errText.slice(0, 200)}`);
      }

      let fullAnswer = '';
      let fullReasoning = '';
      let inThinkTag = false;

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;
          if (trimmed === 'data: [DONE]') break;
          if (trimmed.startsWith('data: ')) {
            try {
              const json = JSON.parse(trimmed.slice(6));
              const choice = json.choices?.[0];
              const delta = choice?.delta || {};

              // 1. Direct reasoning content (DeepSeek R1, Groq, OpenRouter, Qwen)
              const reasoningDelta = delta.reasoning_content || delta.reasoning || '';
              if (reasoningDelta) {
                fullReasoning += reasoningDelta;
                onEvent('reasoning', { delta: reasoningDelta });
              }

              // 2. Regular content & inline <think> tags (Ollama, vLLM)
              let contentDelta = delta.content || '';
              if (contentDelta) {
                if (!inThinkTag && contentDelta.includes('<think>')) {
                  inThinkTag = true;
                  const parts = contentDelta.split('<think>');
                  if (parts[0]) {
                    fullAnswer += parts[0];
                    onEvent('token', { delta: parts[0] });
                  }
                  contentDelta = parts[1] || '';
                }

                if (inThinkTag) {
                  if (contentDelta.includes('</think>')) {
                    const parts = contentDelta.split('</think>');
                    if (parts[0]) {
                      fullReasoning += parts[0];
                      onEvent('reasoning', { delta: parts[0] });
                    }
                    inThinkTag = false;
                    contentDelta = parts[1] || '';
                  } else {
                    fullReasoning += contentDelta;
                    onEvent('reasoning', { delta: contentDelta });
                    contentDelta = '';
                  }
                }

                if (contentDelta) {
                  fullAnswer += contentDelta;
                  onEvent('token', { delta: contentDelta });
                }
              }
            } catch (_) {}
          }
        }
      }

      onEvent('done', {
        answer: fullAnswer,
        reasoning: fullReasoning,
        sources: allSources,
        model: llmModel,
      });
    } catch (err) {
      console.error('[RAG Stream Error]', err.message);
      const errMsg = `\n\n⚠️ **Service Unavailable**: Unable to complete the response stream. Please try again in a moment.`;
      onEvent('token', { delta: errMsg });
      onEvent('done', { answer: errMsg, sources: allSources, model: llmModel, isError: true });
    }
  },
};
