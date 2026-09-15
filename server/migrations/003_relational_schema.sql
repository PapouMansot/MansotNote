-- Migration 003: Schéma relationnel propre pour Supabase (notes, dossiers, tags, kanban)

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'notes') THEN
    DROP VIEW public.notes CASCADE;
  END IF;
END $$;

-- 1. Folders
CREATE TABLE IF NOT EXISTS folders (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  parent_id text,
  order_index integer NOT NULL DEFAULT 0,
  created_at bigint NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint
);
CREATE INDEX IF NOT EXISTS folders_user_id_idx ON folders(user_id);

-- 2. Tags
CREATE TABLE IF NOT EXISTS tags (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#64748b',
  created_at bigint NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint
);
CREATE INDEX IF NOT EXISTS tags_user_id_idx ON tags(user_id);

-- 3. Notes (vraie table relationnelle)
CREATE TABLE IF NOT EXISTS notes (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id text REFERENCES folders(id) ON DELETE SET NULL,
  title text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  tag_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  pinned boolean NOT NULL DEFAULT false,
  archived boolean NOT NULL DEFAULT false,
  archived_at bigint,
  created_at bigint NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint,
  updated_at bigint NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint
);
CREATE INDEX IF NOT EXISTS notes_user_id_idx ON notes(user_id);
CREATE INDEX IF NOT EXISTS notes_folder_id_idx ON notes(folder_id);
CREATE INDEX IF NOT EXISTS notes_updated_at_idx ON notes(updated_at DESC);

-- 4. Kanban Columns
CREATE TABLE IF NOT EXISTS kanban_columns (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  order_index integer NOT NULL DEFAULT 0,
  created_at bigint NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint
);
CREATE INDEX IF NOT EXISTS kanban_columns_user_id_idx ON kanban_columns(user_id);

-- 5. Kanban Labels
CREATE TABLE IF NOT EXISTS kanban_labels (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#64748b',
  created_at bigint NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint
);
CREATE INDEX IF NOT EXISTS kanban_labels_user_id_idx ON kanban_labels(user_id);

-- 6. Kanban Cards
CREATE TABLE IF NOT EXISTS kanban_cards (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  column_id text NOT NULL REFERENCES kanban_columns(id) ON DELETE CASCADE,
  order_index integer NOT NULL DEFAULT 0,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  label_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  priority text NOT NULL DEFAULT 'medium',
  due_date text,
  checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  linked_note_id text REFERENCES notes(id) ON DELETE SET NULL,
  archived boolean NOT NULL DEFAULT false,
  archived_at bigint,
  created_at bigint NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint,
  updated_at bigint NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint
);
CREATE INDEX IF NOT EXISTS kanban_cards_user_id_idx ON kanban_cards(user_id);
CREATE INDEX IF NOT EXISTS kanban_cards_column_id_idx ON kanban_cards(column_id);

-- Migration initiale depuis workspaces.state vers les tables relationnelles
INSERT INTO folders (id, user_id, name, parent_id, order_index, created_at)
SELECT 
  f->>'id',
  w.user_id,
  f->>'name',
  f->>'parentId',
  COALESCE((f->>'order')::integer, 0),
  COALESCE((f->>'createdAt')::bigint, (extract(epoch from now()) * 1000)::bigint)
FROM workspaces w, jsonb_array_elements(COALESCE(w.state->'folders', '[]'::jsonb)) AS f
ON CONFLICT (id) DO NOTHING;

INSERT INTO tags (id, user_id, name, color, created_at)
SELECT 
  t->>'id',
  w.user_id,
  t->>'name',
  t->>'color',
  COALESCE((t->>'createdAt')::bigint, (extract(epoch from now()) * 1000)::bigint)
FROM workspaces w, jsonb_array_elements(COALESCE(w.state->'tags', '[]'::jsonb)) AS t
ON CONFLICT (id) DO NOTHING;

INSERT INTO notes (id, user_id, folder_id, title, content, tag_ids, pinned, archived, archived_at, created_at, updated_at)
SELECT 
  n->>'id',
  w.user_id,
  CASE WHEN n->>'folderId' IS NOT NULL AND EXISTS(SELECT 1 FROM folders WHERE id = n->>'folderId') THEN n->>'folderId' ELSE NULL END,
  COALESCE(n->>'title', ''),
  COALESCE(n->>'content', ''),
  COALESCE(n->'tagIds', '[]'::jsonb),
  COALESCE((n->>'pinned')::boolean, false),
  COALESCE((n->>'archived')::boolean, false),
  (n->>'archivedAt')::bigint,
  COALESCE((n->>'createdAt')::bigint, (extract(epoch from now()) * 1000)::bigint),
  COALESCE((n->>'updatedAt')::bigint, (extract(epoch from now()) * 1000)::bigint)
FROM workspaces w, jsonb_array_elements(COALESCE(w.state->'notes', '[]'::jsonb)) AS n
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  content = EXCLUDED.content,
  tag_ids = EXCLUDED.tag_ids,
  pinned = EXCLUDED.pinned,
  archived = EXCLUDED.archived,
  updated_at = EXCLUDED.updated_at;

INSERT INTO kanban_columns (id, user_id, title, order_index, created_at)
SELECT 
  c->>'id',
  w.user_id,
  c->>'title',
  COALESCE((c->>'order')::integer, 0),
  COALESCE((c->>'createdAt')::bigint, (extract(epoch from now()) * 1000)::bigint)
FROM workspaces w, jsonb_array_elements(COALESCE(w.state->'columns', '[]'::jsonb)) AS c
ON CONFLICT (id) DO NOTHING;

INSERT INTO kanban_labels (id, user_id, name, color, created_at)
SELECT 
  l->>'id',
  w.user_id,
  l->>'name',
  l->>'color',
  COALESCE((l->>'createdAt')::bigint, (extract(epoch from now()) * 1000)::bigint)
FROM workspaces w, jsonb_array_elements(COALESCE(w.state->'labels', '[]'::jsonb)) AS l
ON CONFLICT (id) DO NOTHING;

INSERT INTO kanban_cards (id, user_id, column_id, order_index, title, description, label_ids, priority, due_date, checklist, linked_note_id, archived, archived_at, created_at, updated_at)
SELECT 
  cd->>'id',
  w.user_id,
  cd->>'columnId',
  COALESCE((cd->>'order')::integer, 0),
  COALESCE(cd->>'title', ''),
  COALESCE(cd->>'description', ''),
  COALESCE(cd->'labelIds', '[]'::jsonb),
  COALESCE(cd->>'priority', 'medium'),
  cd->>'dueDate',
  COALESCE(cd->'checklist', '[]'::jsonb),
  CASE WHEN cd->>'linkedNoteId' IS NOT NULL AND EXISTS(SELECT 1 FROM notes WHERE id = cd->>'linkedNoteId') THEN cd->>'linkedNoteId' ELSE NULL END,
  COALESCE((cd->>'archived')::boolean, false),
  (cd->>'archivedAt')::bigint,
  COALESCE((cd->>'createdAt')::bigint, (extract(epoch from now()) * 1000)::bigint),
  COALESCE((cd->>'updatedAt')::bigint, (extract(epoch from now()) * 1000)::bigint)
FROM workspaces w, jsonb_array_elements(COALESCE(w.state->'cards', '[]'::jsonb)) AS cd
ON CONFLICT (id) DO NOTHING;
