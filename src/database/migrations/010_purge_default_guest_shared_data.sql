-- 010_purge_default_guest_shared_data.sql
-- Purges any global shared data accidentally saved under the default guest UUID
-- so that different guest devices are 100% isolated and never inherit shared chats/settings.

DELETE FROM chat_threads WHERE user_id = '00000000-0000-0000-0000-000000000000';
DELETE FROM user_settings WHERE user_id = '00000000-0000-0000-0000-000000000000';
