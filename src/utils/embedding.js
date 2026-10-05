import { config } from '../config/env.js';

/**
 * Generates an embedding vector using the configured embedding API.
 * Falls back to a deterministic local vector ONLY when no API key AND no custom baseUrl
 * is provided (pure offline/dev mode). Never silently falls back when a key/url is set.
 *
 * @throws {Error} if API key is present but the API call fails — errors must surface.
 */
export async function getEmbedding(text, apiKey, model, baseUrl) {
  const key = apiKey || config.rag.openAiApiKey || null;
  const resolvedModel = model || null;
  const resolvedBaseUrl = (baseUrl || '').replace(/\/+$/, '') || null;

  // Only call the API if we have a key or a custom (non-default) base URL
  if (key || resolvedBaseUrl) {
    const url = resolvedBaseUrl || 'https://api.openai.com/v1';
    const headers = { 'Content-Type': 'application/json' };
    if (key) headers['Authorization'] = `Bearer ${key}`;

    const response = await fetch(`${url}/embeddings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: resolvedModel,
        input: text,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      if (data.data && data.data[0] && Array.isArray(data.data[0].embedding)) {
        return data.data[0].embedding;
      }
      throw new Error(
        `[Embedding] Unexpected API response shape: ${JSON.stringify(data).slice(0, 200)}`
      );
    }

    const errorText = await response.text();
    throw new Error(`[Embedding] API error ${response.status}: ${errorText.slice(0, 300)}`);
  }

  // Truly no configuration at all — offline/dev fallback only
  console.warn('[Embedding] No embedding API configured. Using local deterministic vector (offline mode).');
  return generateDeterministicVector(text, 1536);
}

/**
 * Batch generates embeddings for an array of texts.
 * @throws {Error} if API call fails when a key/url is configured.
 */
export async function getBatchEmbeddings(texts, apiKey, model, baseUrl) {
  const key = apiKey || config.rag.openAiApiKey || null;
  const resolvedModel = model || null;
  const resolvedBaseUrl = (baseUrl || '').replace(/\/+$/, '') || null;

  if (texts.length === 0) return [];

  if (key || resolvedBaseUrl) {
    const url = resolvedBaseUrl || 'https://api.openai.com/v1';
    const headers = { 'Content-Type': 'application/json' };
    if (key) headers['Authorization'] = `Bearer ${key}`;

    const response = await fetch(`${url}/embeddings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: resolvedModel,
        input: texts,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      if (data.data && Array.isArray(data.data)) {
        // Sort by index to guarantee order (some providers reorder)
        return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
      }
      throw new Error(
        `[Batch Embedding] Unexpected API response shape: ${JSON.stringify(data).slice(0, 200)}`
      );
    }

    const errorText = await response.text();
    throw new Error(`[Batch Embedding] API error ${response.status}: ${errorText.slice(0, 300)}`);
  }

  // Truly no configuration — offline/dev fallback only
  console.warn('[Batch Embedding] No embedding API configured. Using local deterministic vectors (offline mode).');
  return texts.map((t) => generateDeterministicVector(t, 1536));
}

/**
 * Generates a unit-normalized deterministic 1536-dimensional vector for a text string.
 * Used only in offline/dev mode when no embedding API is configured.
 */
function generateDeterministicVector(text, dimension = 1536) {
  const vector = new Array(dimension).fill(0);
  if (!text || typeof text !== 'string') return vector;

  const normalized = text.toLowerCase();
  for (let i = 0; i < normalized.length; i++) {
    const charCode = normalized.charCodeAt(i);
    const index = (charCode * 31 + i * 17) % dimension;
    vector[index] += 1;
  }

  // Bigram boost
  for (let i = 0; i < normalized.length - 1; i++) {
    const bigramHash =
      (normalized.charCodeAt(i) * 37 + normalized.charCodeAt(i + 1) * 43) % dimension;
    vector[bigramHash] += 1.5;
  }

  // L2 unit normalization for cosine similarity
  let sumSq = 0;
  for (let i = 0; i < dimension; i++) sumSq += vector[i] * vector[i];
  const norm = Math.sqrt(sumSq) || 1;
  for (let i = 0; i < dimension; i++) {
    vector[i] = Number((vector[i] / norm).toFixed(6));
  }

  return vector;
}
