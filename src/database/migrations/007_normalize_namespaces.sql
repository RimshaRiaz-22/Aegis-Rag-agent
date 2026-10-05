-- Migration: normalize all knowledge_base namespaces to use underscores (not hyphens)
-- This fixes the namespace mismatch between frontend-generated namespaces (underscores)
-- and old DB-stored namespaces that had hyphens from raw UUID values.

UPDATE knowledge_bases
SET namespace = LOWER(REGEXP_REPLACE(namespace, '[^a-z0-9_]', '_', 'g'))
WHERE namespace ~ '[^a-z0-9_]';

-- Verify
SELECT id, user_id, namespace FROM knowledge_bases ORDER BY created_at;
