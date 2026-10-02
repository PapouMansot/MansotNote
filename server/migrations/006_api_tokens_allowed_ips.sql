-- Migration 006: adresses IP publiques autorisees par jeton (en plus du reseau prive / VPN).
-- Liste vide = le jeton ne fonctionne que depuis le reseau prive.
ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS allowed_ips jsonb NOT NULL DEFAULT '[]'::jsonb;
