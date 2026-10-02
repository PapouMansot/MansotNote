-- Migration 004: Contrôle d'accès granulaire et restrictions par jeton API (Bots / IA)

ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '{"read": true, "write": true, "delete": false}'::jsonb;
ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS allowed_folder_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS denied_tag_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS auto_tag_id text;
