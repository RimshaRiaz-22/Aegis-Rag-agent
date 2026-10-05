-- ============================================================================
-- Aegis RAG - Complete Unified Database Schema (Relational + pgvector)
--
-- This script initializes the complete production database schema.
-- Includes:
--   1. Extensions (pgcrypto, uuid-ossp, vector)
--   2. Relational user & authentication tables
--   3. AES-256-GCM encrypted user settings & key storage
--   4. Knowledge bases & document metadata
--   5. Document chunks with dynamic pgvector embedding support
--   6. Chat sessions, messages, and encrypted chat threads
--   7. Embed widget configuration
--   8. Migration tracking metadata
--
-- Safe to run repeatedly (IDEMPOTENT with IF NOT EXISTS).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. PostgreSQL Extensions
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ----------------------------------------------------------------------------
-- 2. Users Table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'user',
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(LOWER(email));

-- ----------------------------------------------------------------------------
-- 3. User Settings Table (AES-256-GCM Encrypted at Rest)
-- ----------------------------------------------------------------------------
-- Sensitive keys (llmApiKey, embeddingApiKey, custom endpoints, system prompts)
-- are stored exclusively as AES-256-GCM ciphertext inside `settings_encrypted`.
-- The plaintext `settings` column is kept as empty JSONB '{}'.
CREATE TABLE IF NOT EXISTS user_settings (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    settings_encrypted TEXT,
    has_llm_key BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_settings_has_llm_key ON user_settings(has_llm_key);

-- ----------------------------------------------------------------------------
-- 4. Knowledge Bases Table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge_bases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    namespace VARCHAR(100) NOT NULL,
    embedding_model VARCHAR(100) DEFAULT 'text-embedding-3-small',
    embedding_dimension INT DEFAULT 1536,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_user_namespace UNIQUE (user_id, namespace)
);

CREATE INDEX IF NOT EXISTS idx_kb_user_id ON knowledge_bases(user_id);
CREATE INDEX IF NOT EXISTS idx_kb_namespace ON knowledge_bases(namespace);

-- ----------------------------------------------------------------------------
-- 5. Documents Table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kb_id UUID REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    file_type VARCHAR(50) DEFAULT 'txt',
    file_size BIGINT DEFAULT 0,
    chunk_count INT DEFAULT 0,
    tags JSONB DEFAULT '[]'::jsonb,
    status VARCHAR(50) DEFAULT 'ready', -- ready | processing | failed
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_documents_kb_id ON documents(kb_id);
CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at DESC);

-- ----------------------------------------------------------------------------
-- 6. Document Chunks Table (Vector Store with dynamic dimension support)
-- ----------------------------------------------------------------------------
-- The embedding column uses unconstrained `vector` so any dimension model
-- (384d, 768d, 1536d, 2048d, 3072d) is natively accepted without errors.
CREATE TABLE IF NOT EXISTS document_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    kb_id UUID REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chunk_index INT NOT NULL,
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    embedding vector,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chunks_user_kb ON document_chunks(user_id, kb_id);
CREATE INDEX IF NOT EXISTS idx_chunks_doc_id ON document_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_chunks_created_at ON document_chunks(created_at);

-- ----------------------------------------------------------------------------
-- 7. Chat Sessions & Messages (Relational)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) DEFAULT 'New Conversation',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id);

CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL, -- 'user' | 'assistant' | 'system'
    content TEXT NOT NULL,
    citations JSONB DEFAULT '[]'::jsonb,
    tokens_used INT DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);

-- ----------------------------------------------------------------------------
-- 8. Chat Threads Table (AES-256-GCM Encrypted at Rest)
-- ----------------------------------------------------------------------------
-- Full conversational threads preserved per-user in encrypted form.
CREATE TABLE IF NOT EXISTS chat_threads (
    id VARCHAR(120) NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    payload_encrypted TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS idx_chat_threads_user_updated ON chat_threads(user_id, updated_at DESC);

-- ----------------------------------------------------------------------------
-- 9. Widget Configurations Table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS widget_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_public BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_widget_user UNIQUE (user_id)
);

-- ----------------------------------------------------------------------------
-- 10. Migrations Meta Tracking
-- ----------------------------------------------------------------------------
-- Ensures the Node.js migrate tool knows all migrations 001-008 are satisfied.
CREATE TABLE IF NOT EXISTS migrations_meta (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    executed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO migrations_meta (name)
VALUES 
    ('001_init_extensions.sql'),
    ('002_create_users_and_settings.sql'),
    ('003_create_knowledge_and_documents.sql'),
    ('004_create_chunks_and_pgvector.sql'),
    ('005_create_chat_and_widgets.sql'),
    ('006_fix_embedding_dimension.sql'),
    ('007_normalize_namespaces.sql'),
    ('008_encryption_and_chat_threads.sql')
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- End of init.sql
-- ============================================================================
