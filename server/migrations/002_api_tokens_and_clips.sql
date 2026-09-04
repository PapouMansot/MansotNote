-- Migration 002: Support des tokens API pour extensions/webhooks et table des clips entrants

CREATE TABLE IF NOT EXISTS api_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  expires_at timestamptz
);
CREATE INDEX IF NOT EXISTS api_tokens_user_id_idx ON api_tokens(user_id);
CREATE INDEX IF NOT EXISTS api_tokens_token_hash_idx ON api_tokens(token_hash);

CREATE TABLE IF NOT EXISTS clips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL, -- 'note' ou 'card'
  title text NOT NULL,
  content text NOT NULL,
  url text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotent_key text,
  status text NOT NULL DEFAULT 'pending', -- 'pending', 'processed', 'dismissed'
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE(user_id, idempotent_key)
);
CREATE INDEX IF NOT EXISTS clips_user_status_idx ON clips(user_id, status);
CREATE INDEX IF NOT EXISTS clips_created_at_idx ON clips(created_at);
