#!/usr/bin/env bash
set -euo pipefail
umask 077
# libpq uses PGHOST/PGPORT/PGUSER/PGDATABASE and PGPASSFILE, never URL in argv.
: "${PGDATABASE:?Set source PGDATABASE}"
: "${AGE_RECIPIENT:?Set separately managed age public recipient}"
: "${QUIESCED:?Stop app and worker, then set QUIESCED=yes}"
[[ "$QUIESCED" == yes ]] || exit 2
[[ $# == 1 && ! -e "$1" && ! -e "$1.sha256" ]] || { echo 'Usage: backup.sh NEW_ARCHIVE.age' >&2; exit 2; }
command -v age >/dev/null
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
pg_dump --format=custom --no-owner --no-acl --file="$work/database.dump"
psql -X -v ON_ERROR_STOP=1 -At -f "$(dirname "$0")/counts.sql" > "$work/counts.tsv"
psql -X -v ON_ERROR_STOP=1 -At -f "$(dirname "$0")/integrity.sql" > "$work/integrity.tsv"
(cd "$work" && sha256sum database.dump counts.tsv integrity.tsv > manifest.sha256)
date -u +%FT%TZ > "$work/created-utc.txt"
tar -C "$work" -cf - database.dump counts.tsv integrity.tsv manifest.sha256 created-utc.txt | age -r "$AGE_RECIPIENT" -o "$1"
sha256sum "$1" > "$1.sha256"
echo 'Encrypted backup created. Perform a fresh-database restore drill before relying on it.'
