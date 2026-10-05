-- Migration 003: Knowledge Bases and Documents Metadata
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
