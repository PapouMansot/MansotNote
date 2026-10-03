-- Le compte historique devient administrateur une seule fois, lors de l'ajout
-- de la colonne. Les redémarrages ne rétablissent jamais un rôle retiré.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema=current_schema() AND table_name='users' AND column_name='role') THEN
    ALTER TABLE users ADD COLUMN role text NOT NULL DEFAULT 'user'
      CHECK (role IN ('admin', 'user'));
    UPDATE users SET role='admin' WHERE id=(
      SELECT id FROM users WHERE disabled_at IS NULL ORDER BY created_at, id LIMIT 1
    );
  END IF;
END $$;
