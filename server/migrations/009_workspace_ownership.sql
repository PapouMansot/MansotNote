-- Les identifiants restent globaux pour préserver les intégrations existantes.
-- Une collision doit échouer, jamais modifier un objet d'un autre compte.
CREATE OR REPLACE FUNCTION enforce_workspace_owner() RETURNS trigger AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.user_id IS DISTINCT FROM NEW.user_id THEN
    RAISE EXCEPTION 'Object owner cannot change' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME='notes' THEN
    IF EXISTS (SELECT 1 FROM note_versions WHERE note_id=NEW.id AND user_id<>NEW.user_id) THEN
      RAISE EXCEPTION 'Note identifier already reserved' USING ERRCODE='23514';
    END IF;
    IF NEW.folder_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM folders WHERE id=NEW.folder_id AND user_id=NEW.user_id) THEN
      RAISE EXCEPTION 'Invalid folder owner' USING ERRCODE='23514';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(NEW.tag_ids) t(id)
               WHERE NOT EXISTS (SELECT 1 FROM tags WHERE tags.id=t.id AND user_id=NEW.user_id)) THEN
      RAISE EXCEPTION 'Invalid tag owner' USING ERRCODE='23514';
    END IF;
  ELSIF TG_TABLE_NAME='folders' THEN
    IF NEW.parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM folders WHERE id=NEW.parent_id AND user_id=NEW.user_id) THEN
      RAISE EXCEPTION 'Invalid parent folder owner' USING ERRCODE='23514';
    END IF;
  ELSIF TG_TABLE_NAME='kanban_cards' THEN
    IF NOT EXISTS (SELECT 1 FROM kanban_columns WHERE id=NEW.column_id AND user_id=NEW.user_id) THEN
      RAISE EXCEPTION 'Invalid column owner' USING ERRCODE='23514';
    END IF;
    IF NEW.linked_note_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM notes WHERE id=NEW.linked_note_id AND user_id=NEW.user_id) THEN
      RAISE EXCEPTION 'Invalid linked note owner' USING ERRCODE='23514';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(NEW.label_ids) l(id)
               WHERE NOT EXISTS (SELECT 1 FROM kanban_labels WHERE kanban_labels.id=l.id AND user_id=NEW.user_id)) THEN
      RAISE EXCEPTION 'Invalid label owner' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['folders','tags','notes','kanban_columns','kanban_labels','kanban_cards'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS workspace_owner ON %I', t);
    EXECUTE format('CREATE TRIGGER workspace_owner BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION enforce_workspace_owner()', t);
  END LOOP;
END $$;
