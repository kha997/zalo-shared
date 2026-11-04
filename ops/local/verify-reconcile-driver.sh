#!/usr/bin/env bash
# End-to-end proof of ops/local/reconcile-pilot-state.mjs against a throwaway
# database. It proves the window refusal, the confirmation guard, the single
# applied request, the separate read-only verification and the refusal to reuse
# a request id. No pilot resource, provider or connector is touched.
set -euo pipefail
umask 077

repo=$(cd "$(dirname "$0")/../.." && pwd)
source_url=${TEST_DATABASE_URL:?TEST_DATABASE_URL must reference the disposable PostgreSQL instance}
db=zalo_reconcile_driver_test
port=${DRIVER_TEST_PORT:-3112}
base=http://127.0.0.1:$port

case $source_url in
  *pilot*) printf 'reconcile-driver-test: FAIL refusing a URL that references the pilot\n' >&2; exit 1 ;;
esac
case ${source_url%%\?*} in
  */$db) printf 'reconcile-driver-test: FAIL TEST_DATABASE_URL must point at another database\n' >&2; exit 1 ;;
esac
disposable=${source_url%%\?*}; disposable=${disposable%/*}/$db

command -v psql >/dev/null || { printf 'reconcile-driver-test: FAIL psql is required\n' >&2; exit 1; }

tmp=$(mktemp -d)
app_pid=
cleanup() {
  local code=$?
  trap - EXIT
  if [ -n "$app_pid" ] && kill -0 "$app_pid" 2>/dev/null; then
    kill "$app_pid" 2>/dev/null || true
    wait "$app_pid" 2>/dev/null || true
  fi
  psql "$source_url" -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE)" >/dev/null 2>&1 || true
  rm -rf "$tmp"
  exit "$code"
}
trap cleanup EXIT
chmod 0700 "$tmp"

say() { printf 'reconcile-driver-test: %s\n' "$*"; }
failed=0
check() {
  if [ "$2" = "$3" ]; then
    say "PASS $1 ($3)"
  else
    say "FAIL $1 (expected $2, got $3)"; failed=$((failed + 1))
  fi
}

say "recreating $db on the disposable instance"
psql "$source_url" -v ON_ERROR_STOP=1 -q \
  -c "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE)" \
  -c "CREATE DATABASE \"$db\""

MIGRATION_DATABASE_URL=$disposable node "$repo/dist/server/migrate.js"

DISPOSABLE_ALLOW=1 \
DISPOSABLE_STATE=setup \
DISPOSABLE_DATABASE_URL=$disposable \
DISPOSABLE_DB_NAME=$db \
DISPOSABLE_CREDENTIAL_FILE=$tmp/disposable.env \
  node "$repo/ops/local/verify-disposable-admin-http.mjs"

owner=$(sed -n 's/^DISPOSABLE_OWNER_ID=//p' "$tmp/disposable.env")
email=$(sed -n 's/^DISPOSABLE_ADMIN_EMAIL=//p' "$tmp/disposable.env")
password=$(sed -n 's/^DISPOSABLE_ADMIN_PASSWORD=//p' "$tmp/disposable.env")
printf 'PILOT_ADMIN_EMAIL=%s\nPILOT_ADMIN_PASSWORD=%s\n' "$email" "$password" >"$tmp/admin.env"
chmod 0600 "$tmp/admin.env"

DATABASE_URL=$disposable HOST=127.0.0.1 PORT=$port PUBLIC_ORIGIN=$base \
PROVIDER_MODE=disabled NODE_ENV=test LOGIN_RATE_LIMIT=100 \
  node "$repo/dist/server/main.js" >"$tmp/app.log" 2>&1 &
app_pid=$!
ready=
for _ in $(seq 1 80); do
  if curl -fsS "$base/health/live" >/dev/null 2>&1; then ready=1; break; fi
  if ! kill -0 "$app_pid" 2>/dev/null; then
    printf 'reconcile-driver-test: FAIL the app exited during startup\n' >&2
    cat "$tmp/app.log" >&2
    exit 1
  fi
  sleep 0.25
done
[ -n "$ready" ] || { printf 'reconcile-driver-test: FAIL the app did not become ready\n' >&2; cat "$tmp/app.log" >&2; exit 1; }
say "app listening on $base (disposable database)"

export DATABASE_URL=$disposable
export PILOT_ADMIN_CREDENTIAL_FILE=$tmp/admin.env
export PILOT_ADMIN_BASE_URL=$base
export PILOT_RECONCILE_EXPECTED_OWNER_ID=$owner
export PILOT_RECONCILE_EXPECTED_EPOCH=1
export PILOT_RECONCILE_EXPECTED_GAP=1
export PILOT_RECONCILE_EXPECTED_DATABASE=$db
export PILOT_RECONCILE_DISPOSABLE=1
export PILOT_RECONCILE_EVIDENCE_REF='driver-test.md#1'
export PILOT_RECONCILE_REQUEST_ID=$(cat /proc/sys/kernel/random/uuid)
now=$(date -u +%s)
future_start=$(date -u -d "@$((now + 3600))" +%Y-%m-%dT%H:%M:%SZ)
future_end=$(date -u -d "@$((now + 4200))" +%Y-%m-%dT%H:%M:%SZ)
past_start=$(date -u -d "@$((now - 120))" +%Y-%m-%dT%H:%M:%SZ)
past_end=$(date -u -d "@$((now + 900))" +%Y-%m-%dT%H:%M:%SZ)

run() {
  local out=$1 status=0
  shift
  env "$@" node "$repo/ops/local/reconcile-pilot-state.mjs" >"$out" 2>"$out.err" || status=$?
  printf '%s' "$status"
}

say "negative: confirmation guard"
status=$(run "$tmp/no-confirm.json" PILOT_RECONCILE_CONFIRM=NO PILOT_RECONCILE_NOT_BEFORE="$past_start" PILOT_RECONCILE_NOT_AFTER="$past_end")
check "missing confirmation is refused" 3 "$status"

say "negative: window gate"
status=$(run "$tmp/window.json" PILOT_RECONCILE_CONFIRM=ONE_SHOT PILOT_RECONCILE_NOT_BEFORE="$future_start" PILOT_RECONCILE_NOT_AFTER="$future_end")
check "outside-window is refused" 2 "$status"
check "outside-window sends nothing" '"outcome":"outside-window"' "$(grep -o '"outcome":"outside-window"' "$tmp/window.json")"
check "outside-window opens no session" 0 "$(psql "$disposable" -tAc 'SELECT count(*) FROM sessions')"

say "negative: pilot-only guard"
status=$(run "$tmp/pilot-guard.json" PILOT_RECONCILE_CONFIRM=ONE_SHOT PILOT_RECONCILE_NOT_BEFORE="$past_start" PILOT_RECONCILE_NOT_AFTER="$past_end" PILOT_RECONCILE_EXPECTED_DATABASE=zalo PILOT_RECONCILE_DISPOSABLE=0)
check "a non-pilot database name in a non-disposable run is refused" 3 "$status"

say "positive: one applied reconciliation"
status=$(run "$tmp/applied.json" PILOT_RECONCILE_CONFIRM=ONE_SHOT PILOT_RECONCILE_NOT_BEFORE="$past_start" PILOT_RECONCILE_NOT_AFTER="$past_end")
check "the driver exits zero" 0 "$status"
check "the driver reports reconciled" '"outcome":"reconciled"' "$(grep -o '"outcome":"reconciled"' "$tmp/applied.json" | head -1)"
check "the state is idle at epoch 2" 'idle|2|false' "$(psql "$disposable" -tAc "SELECT phase||'|'||epoch||'|'||reconciliation_required FROM connector_ownership o JOIN provider_state p USING(account_id)")"
check "the gap advanced" 2 "$(psql "$disposable" -tAc 'SELECT gap_version FROM provider_state')"
check "the owner was cleared and fenced" "|$owner|1" "$(psql "$disposable" -tAc "SELECT coalesce(owner_id::text,'')||'|'||coalesce(last_fenced_owner_id::text,'')||'|'||coalesce(last_fenced_epoch::text,'') FROM connector_ownership")"
check "exactly one reconciliation audit row exists" 1 "$(psql "$disposable" -tAc "SELECT count(*) FROM audit WHERE action='connector.reconciled'")"
check "the audit row carries the request id" "$PILOT_RECONCILE_REQUEST_ID" "$(psql "$disposable" -tAc "SELECT metadata->>'requestId' FROM audit WHERE action='connector.reconciled'")"
check "no session survives" 0 "$(psql "$disposable" -tAc 'SELECT count(*) FROM sessions')"
check "delivery state is unchanged" '0|0|0' "$(psql "$disposable" -tAc "SELECT (SELECT count(*) FROM messages)||'|'||(SELECT count(*) FROM outbox)||'|'||(SELECT count(*) FROM delivery_parts)")"

say "negative: replay of the same request id"
status=$(run "$tmp/replay.json" PILOT_RECONCILE_CONFIRM=ONE_SHOT PILOT_RECONCILE_NOT_BEFORE="$past_start" PILOT_RECONCILE_NOT_AFTER="$past_end")
check "a reused request id is refused before any request" 3 "$status"
check "no second reconciliation audit row appears" 1 "$(psql "$disposable" -tAc "SELECT count(*) FROM audit WHERE action='connector.reconciled'")"
check "the epoch did not advance again" 2 "$(psql "$disposable" -tAc 'SELECT epoch FROM connector_ownership')"

say "report generator"
status=0
node "$repo/ops/local/reconcile-report.mjs" "$tmp/applied.json" "$tmp/report.md" >"$tmp/token.json" 2>"$tmp/report.err" || status=$?
check "the pass report exits zero" 0 "$status"
check "the report returns the pass token" '"token":"G5A_RECONCILIATION_PASS_AWAITING_BOOTSTRAP_DECISION"' "$(grep -o '"token":"G5A_RECONCILIATION_PASS_AWAITING_BOOTSTRAP_DECISION"' "$tmp/token.json")"
printf '{"ok":false,"outcome":"outside-window","checks":[]}\n' >"$tmp/blocked.json"
status=0
node "$repo/ops/local/reconcile-report.mjs" "$tmp/blocked.json" "$tmp/report-blocked.md" >"$tmp/token-blocked.json" 2>/dev/null || status=$?
check "the blocked report exits two" 2 "$status"
check "the blocked report returns the blocked token" '"token":"G5A_RECONCILIATION_BLOCKED"' "$(grep -o '"token":"G5A_RECONCILIATION_BLOCKED"' "$tmp/token-blocked.json")"

cp "$tmp/applied.json" /tmp/reconcile-driver-test-applied.json
cp "$tmp/report.md" /tmp/reconcile-driver-test-report.md

unset DATABASE_URL PILOT_ADMIN_CREDENTIAL_FILE PILOT_ADMIN_BASE_URL PILOT_RECONCILE_EXPECTED_OWNER_ID \
  PILOT_RECONCILE_EXPECTED_EPOCH PILOT_RECONCILE_EXPECTED_GAP PILOT_RECONCILE_EXPECTED_DATABASE \
  PILOT_RECONCILE_DISPOSABLE PILOT_RECONCILE_EVIDENCE_REF PILOT_RECONCILE_REQUEST_ID

if [ "$failed" -ne 0 ]; then
  say "$failed assertion(s) FAILED"
  exit 1
fi
say "all assertions PASS"
