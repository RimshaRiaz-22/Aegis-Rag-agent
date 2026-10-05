-- Migration 006: Fix embedding column to support any model dimension
-- The previous vector(1536) was hardcoded for OpenAI text-embedding-3-small.
-- Models like nvidia/nemotron-3-embed-1b return 2048 dims and were silently rejected.

-- Drop HNSW index (dimension-specific, must be recreated with correct size)
DROP INDEX IF EXISTS idx_document_chunks_embedding_hnsw;

-- Alter embedding column to remove fixed dimension constraint
-- This accepts vectors of ANY dimension — dimension enforced at app layer
ALTER TABLE document_chunks
  ALTER COLUMN embedding TYPE vector
  USING embedding::vector;

-- NOTE: A new HNSW index will be created by the app once the actual
-- embedding dimension is known (see knowledge.service.js auto-migration logic).
