-- Migration 011: Add is_pinned to chat_threads and index for quick retrieval
ALTER TABLE chat_threads ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_chat_threads_user_pinned ON chat_threads(user_id, is_pinned DESC, updated_at DESC);
