#!/usr/bin/env bash
set -euo pipefail
: "${APP_DATABASE_PASSWORD:?Set independent runtime role password}"
# psql getenv + quoted literal never interpolate password as SQL or argv.
psql -X -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
\getenv runtime_password APP_DATABASE_PASSWORD
CREATE ROLE zs_app LOGIN PASSWORD :'runtime_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
SQL
