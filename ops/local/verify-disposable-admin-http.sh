#!/usr/bin/env bash
# Drive the offline admin-authentication and reconciliation proof.
#
# Everything here runs against a throwaway database on TEST_DATABASE_URL. The
# script refuses a URL that looks like the pilot, starts the reviewed app on a
# loopback port, and drops the database afterwards. No provider, connector or
# pilot resource is touched.
set -euo pipefail

repo=$(cd "$(dirname "$0")/../.." && pwd)
source_url=${TEST_DATABASE_URL:?TEST_DATABASE_URL must reference the disposable PostgreSQL instance}
db=zalo_admin_http_test
port=${DISPOSABLE_ADMIN_PORT:-3110}
base=http://127.0.0.1:$port

case $source_url in
  *pilot*) printf 'disposable-admin: FAIL refusing a URL that references the pilot\n' >&2; exit 1 ;;
esac
case ${source_url%%\?*} in
  */$db) printf 'disposable-admin: FAIL TEST_DATABASE_URL must point at a database other than %s\n' "$db" >&2; exit 1 ;;
esac
disposable=${source_url%%\?*}; disposable=${disposable%/*}/$db

command -v psql >/dev/null || { printf 'disposable-admin: FAIL psql is required\n' >&2; exit 1; }

tmp=$(mktemp -d)
app_pid=
cleanup() {
  if [ -n "$app_pid" ] && kill -0 "$app_pid" 2>/dev/null; then
    kill "$app_pid" 2>/dev/null || true
    wait "$app_pid" 2>/dev/null || true
  fi
  psql "$source_url" -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE)" >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT
chmod 0700 "$tmp"

say() { printf 'disposable-admin: %s\n' "$*"; }

say "recreating $db on the disposable instance"
psql "$source_url" -v ON_ERROR_STOP=1 -q \
  -c "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE)" \
  -c "CREATE DATABASE \"$db\""

MIGRATION_DATABASE_URL=$disposable node "$repo/dist/server/migrate.js"

DISPOSABLE_ALLOW=1 \
DISPOSABLE_STATE=setup \
DISPOSABLE_DATABASE_URL=$disposable \
DISPOSABLE_DB_NAME=$db \
DISPOSABLE_CREDENTIAL_FILE=$tmp/credentials.env \
  node "$repo/ops/local/verify-disposable-admin-http.mjs"

DATABASE_URL=$disposable HOST=127.0.0.1 PORT=$port PUBLIC_ORIGIN=$base \
PROVIDER_MODE=disabled NODE_ENV=test LOGIN_RATE_LIMIT=100 \
  node "$repo/dist/server/main.js" >"$tmp/app.log" 2>&1 &
app_pid=$!

ready=
for _ in $(seq 1 80); do
  if curl -fsS "$base/health/live" >/dev/null 2>&1; then ready=1; break; fi
  if ! kill -0 "$app_pid" 2>/dev/null; then
    printf 'disposable-admin: FAIL the app exited during startup\n' >&2
    cat "$tmp/app.log" >&2
    exit 1
  fi
  sleep 0.25
done
[ -n "$ready" ] || { printf 'disposable-admin: FAIL the app did not become ready\n' >&2; cat "$tmp/app.log" >&2; exit 1; }
say "app listening on $base (loopback, disposable database)"

DISPOSABLE_ALLOW=1 \
DISPOSABLE_STATE=run \
DISPOSABLE_DATABASE_URL=$disposable \
DISPOSABLE_DB_NAME=$db \
DISPOSABLE_CREDENTIAL_FILE=$tmp/credentials.env \
DISPOSABLE_BASE_URL=$base \
  node "$repo/ops/local/verify-disposable-admin-http.mjs"
