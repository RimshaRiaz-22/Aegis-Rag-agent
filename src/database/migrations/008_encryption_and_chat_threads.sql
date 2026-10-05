-- Migration 008: Encryption at rest + server-side chat thread persistence
--
-- user_settings.settings_encrypted : AES-256-GCM encrypted JSON blob of all user settings
--                                    (API keys, models, prompts...). The legacy plaintext
--                                    `settings` JSONB column is wiped to '{}' by the server
--                                    on startup once rows are encrypted.
-- user_settings.has_llm_key        : non-secret flag so owner resolution no longer needs to
--                                    read the API key in SQL.
-- chat_threads                     : per-user chat history, whole thread encrypted as one blob.

ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS settings_encrypted TEXT;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS has_llm_key BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS chat_threads (
    id VARCHAR(120) NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    payload_encrypted TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS idx_chat_threads_user_updated ON chat_threads(user_id, updated_at DESC);
