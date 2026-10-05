-- Migration 009: Visitors, Sessions, Geolocation, and Embed Analytics
CREATE TABLE IF NOT EXISTS visitors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    visitor_token VARCHAR(100) NOT NULL,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    total_visits INT NOT NULL DEFAULT 1,
    total_time_spent_seconds INT NOT NULL DEFAULT 0,
    total_messages INT NOT NULL DEFAULT 0,
    last_ip VARCHAR(45),
    country VARCHAR(100) DEFAULT 'Unknown',
    country_code VARCHAR(10) DEFAULT 'XX',
    city VARCHAR(100) DEFAULT 'Unknown',
    region VARCHAR(100) DEFAULT 'Unknown',
    latitude FLOAT,
    longitude FLOAT,
    timezone VARCHAR(50),
    browser VARCHAR(50),
    os VARCHAR(50),
    device_type VARCHAR(50) DEFAULT 'desktop',
    last_page_url TEXT,
    last_referrer TEXT,
    agent_namespace VARCHAR(120),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_owner_visitor_token UNIQUE (owner_user_id, visitor_token)
);

CREATE INDEX IF NOT EXISTS idx_visitors_owner_last_seen ON visitors(owner_user_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_visitors_token ON visitors(visitor_token);

CREATE TABLE IF NOT EXISTS visitor_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visitor_id UUID NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
    owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_token VARCHAR(100) NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    duration_seconds INT NOT NULL DEFAULT 0,
    message_count INT NOT NULL DEFAULT 0,
    page_url TEXT,
    referrer TEXT,
    ip_address VARCHAR(45),
    country VARCHAR(100) DEFAULT 'Unknown',
    country_code VARCHAR(10) DEFAULT 'XX',
    city VARCHAR(100) DEFAULT 'Unknown',
    region VARCHAR(100) DEFAULT 'Unknown',
    browser VARCHAR(50),
    os VARCHAR(50),
    device_type VARCHAR(50) DEFAULT 'desktop',
    agent_namespace VARCHAR(120),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_visitor_session_token UNIQUE (session_token)
);

CREATE INDEX IF NOT EXISTS idx_visitor_sessions_visitor ON visitor_sessions(visitor_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_visitor_sessions_owner ON visitor_sessions(owner_user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS visitor_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visitor_id UUID NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
    session_id UUID REFERENCES visitor_sessions(id) ON DELETE SET NULL,
    owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_token VARCHAR(100),
    agent_namespace VARCHAR(120),
    role VARCHAR(20) NOT NULL, -- 'user' | 'assistant'
    content TEXT NOT NULL,
    sources JSONB DEFAULT '[]'::jsonb,
    tokens_used INT DEFAULT 0,
    model VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_visitor_messages_visitor ON visitor_messages(visitor_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_visitor_messages_session ON visitor_messages(session_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_visitor_messages_owner ON visitor_messages(owner_user_id, created_at DESC);
