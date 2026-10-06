-- Migration 012: Add tsvector full-text search index for Hybrid Search (Dense + Sparse BM25 / RRF)
CREATE INDEX IF NOT EXISTS idx_chunks_content_fts ON document_chunks USING gin(to_tsvector('english', content));
