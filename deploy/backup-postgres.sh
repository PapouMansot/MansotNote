#!/bin/sh
set -eu
mkdir -p /backups
while true; do
  stamp=$(date -u +%Y%m%d-%H%M%S)
  PGPASSWORD="${SUPABASE_POSTGRES_PASSWORD:-$POSTGRES_PASSWORD}" pg_dump -h "${POSTGRES_HOST:-supabase-db}" -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-postgres}" -Fc > "/backups/mansotnote-$stamp.dump"
  find /backups -type f -name 'mansotnote-*.dump' -mtime +14 -delete
  sleep 86400
done
