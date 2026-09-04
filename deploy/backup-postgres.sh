#!/bin/sh
set -eu
mkdir -p /backups
while true; do
  stamp=$(date -u +%Y%m%d-%H%M%S)
  PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -h mansotnote-db -U mansotnote -d mansotnote -Fc > "/backups/mansotnote-$stamp.dump"
  find /backups -type f -name 'mansotnote-*.dump' -mtime +14 -delete
  sleep 86400
done
