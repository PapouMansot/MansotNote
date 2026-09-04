CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL,
  username_normalized text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz
);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ip inet,
  user_agent text
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS workspaces (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  state jsonb NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS note_chunks (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_id text NOT NULL,
  chunk_key text NOT NULL,
  note_title text NOT NULL,
  heading text NOT NULL DEFAULT '',
  content text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash char(64) NOT NULL,
  embedding vector(1024),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, note_id, chunk_key)
);
CREATE INDEX IF NOT EXISTS note_chunks_user_idx ON note_chunks(user_id);
CREATE INDEX IF NOT EXISTS note_chunks_fts_idx ON note_chunks USING gin(
  to_tsvector('simple', coalesce(note_title, '') || ' ' || coalesce(heading, '') || ' ' || content)
);
-- HNSW accélère la recherche cosinus avec qwen3-embedding (dimension 1024).
CREATE INDEX IF NOT EXISTS note_chunks_embedding_idx
  ON note_chunks USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;
