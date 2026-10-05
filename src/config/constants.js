export const CONSTANTS = {
  CHUNK_SIZE_DEFAULT: 500,
  CHUNK_OVERLAP_DEFAULT: 50,
  TOP_K_DEFAULT: 5,
  // Default threshold is 0 so all embedding models work out of the box.
  // Models like nvidia/nemotron produce cosine scores of 0.02–0.15 which a
  // threshold of 0.3 would completely eliminate. Users can raise this in Settings.
  SIMILARITY_THRESHOLD_DEFAULT: 0.0,
  MAX_UPLOAD_SIZE_BYTES: 20 * 1024 * 1024, // 20 MB

  ROLES: {
    USER: 'user',
    ADMIN: 'admin',
  },

  DOCUMENT_STATUS: {
    READY: 'ready',
    PROCESSING: 'processing',
    FAILED: 'failed',
  },

  DEFAULT_SYSTEM_PROMPT:
    'You are Aegis, a context-grounded AI assistant. Use the following retrieved document context to answer questions accurately. Format all responses using clean standard Markdown. Do not include raw HTML tags such as <br>, <div>, or <span>. If the answer cannot be found in the context, clearly state that you do not know based on the provided documents.',
};
