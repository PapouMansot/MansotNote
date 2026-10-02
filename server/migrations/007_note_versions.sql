-- Migration 007: historique des notes, a la Git. Chaque modification d'une note est une version (auteur, date,
-- message) ; la diff entre deux versions se calcule a la demande. Le declencheur voit toutes les ecritures :
-- navigateur, bots, suppression et modifications directes dans Supabase Studio.
CREATE TABLE IF NOT EXISTS note_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_id text NOT NULL, -- pas de cle etrangere : l'historique survit a la suppression de la note
  seq integer NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  folder_id text,
  tag_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  actor text NOT NULL DEFAULT 'externe',
  message text,
  deleted boolean NOT NULL DEFAULT false, -- true : etat de la note au moment de sa suppression
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS note_versions_note_seq_idx ON note_versions(note_id, seq);
CREATE INDEX IF NOT EXISTS note_versions_user_idx ON note_versions(user_id, created_at DESC);

CREATE OR REPLACE FUNCTION note_versioning() RETURNS trigger AS $$
DECLARE
  v_actor text := COALESCE(NULLIF(current_setting('mansot.actor', true), ''), 'externe');
  v_message text := NULLIF(current_setting('mansot.message', true), '');
  v_last note_versions%ROWTYPE;
  src record;
  v_deleted boolean := false;
BEGIN
  IF TG_OP = 'DELETE' THEN
    src := OLD;
    v_deleted := true;
  ELSE
    src := NEW;
  END IF;

  -- Ni l'epinglage, ni l'archivage, ni la date de mise a jour ne creent de version.
  IF TG_OP = 'UPDATE' AND NOT (
    OLD.title IS DISTINCT FROM NEW.title OR OLD.content IS DISTINCT FROM NEW.content
    OR OLD.folder_id IS DISTINCT FROM NEW.folder_id OR OLD.tag_ids IS DISTINCT FROM NEW.tag_ids
  ) THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_last FROM note_versions WHERE note_id = src.id ORDER BY seq DESC LIMIT 1;

  IF TG_OP = 'UPDATE' AND FOUND AND NOT v_last.deleted AND v_actor = 'navigateur' AND v_last.actor = 'navigateur'
     AND v_message IS NULL AND v_last.message IS NULL AND v_last.created_at > now() - interval '10 minutes' THEN
    -- Autosave du navigateur (toutes les 1,5 s) : la meme rafale d'edition reste une seule version.
    UPDATE note_versions SET title = NEW.title, content = NEW.content, folder_id = NEW.folder_id, tag_ids = NEW.tag_ids
    WHERE id = v_last.id;
  ELSE
    INSERT INTO note_versions (user_id, note_id, seq, title, content, folder_id, tag_ids, actor, message, deleted)
    VALUES (src.user_id, src.id, COALESCE(v_last.seq, 0) + 1, src.title, src.content, src.folder_id, src.tag_ids, v_actor, v_message, v_deleted);
  END IF;

  -- Retention : 50 versions par note.
  DELETE FROM note_versions WHERE note_id = src.id
    AND seq <= (SELECT MAX(seq) FROM note_versions WHERE note_id = src.id) - 50;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Etat de depart : une version initiale pour chaque note existante (rejouable).
INSERT INTO note_versions (user_id, note_id, seq, title, content, folder_id, tag_ids, actor, message)
SELECT n.user_id, n.id, 1, n.title, n.content, n.folder_id, n.tag_ids, 'initial', 'État avant le suivi de l''historique'
FROM notes n WHERE NOT EXISTS (SELECT 1 FROM note_versions v WHERE v.note_id = n.id);

DROP TRIGGER IF EXISTS notes_versioning ON notes;
CREATE TRIGGER notes_versioning AFTER INSERT OR UPDATE OR DELETE ON notes
  FOR EACH ROW EXECUTE FUNCTION note_versioning();
