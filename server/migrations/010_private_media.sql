-- Les médias MansotNote se lisent désormais via l'API du propriétaire.
-- Une installation PostgreSQL sans Supabase Storage ne possède pas ce schéma.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    UPDATE storage.buckets SET public=false WHERE id='mansotnote-media';
  END IF;
END $$;
