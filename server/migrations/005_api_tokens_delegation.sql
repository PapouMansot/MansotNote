-- Migration 005: délégation de droits. Un jeton gestionnaire crée des jetons enfants ;
-- révoquer le gestionnaire révoque aussi ses enfants (ON DELETE CASCADE).
ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS created_by_token_id uuid REFERENCES api_tokens(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS api_tokens_created_by_idx ON api_tokens(created_by_token_id);
