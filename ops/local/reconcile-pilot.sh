#!/usr/bin/env bash
# Preflight or execute the single Owner-authorized reconciliation of the failed
# G5-A bootstrap.
#
# preflight: read-only checks only; never starts the app, never touches the API.
# execute:   re-runs every check, starts the pilot database and a loopback-only
#            application container, invokes the reviewed admin route at most
#            once, verifies the result through a separate read-only connection,
#            writes a sanitized report and returns the gate token.
#
# The window below is the one named by the Owner authorization. Nothing outside
# it is executed, and no request is retried or replayed.
set -euo pipefail
umask 077

repo=$(cd "$(dirname "$0")/../.." && pwd)
base=/home/zen/pilot-private/zalo-shared
image=zalo-shared:g2-adf8ceca9bd6
app_image_sha=sha256:9d3454015db1d8c6558c2d461fde86a2f71de0a26193d997432352115a890d65
network=zalo-shared-pilot-db
expected_owner=9c52ed22-6df9-463f-87eb-28a83d30fdd7
expected_epoch=3
expected_gap=3
window_start=2026-11-06T23:52:00Z
window_expiry=2026-11-07T00:12:00Z
evidence_ref='G5A-BOOTSTRAP-REPORT.md#11-second-bootstrap-attempt-2026-11-06'
previous_fenced_owner=d4729725-5302-42d6-a4ee-ff55971fbdbb
previous_fenced_epoch=1
gateway_contact_ts=2026-11-06T23:44:34.618Z
app_name=pilot-reconcile-app
mode=${1:-preflight}
db_started=0
envfile=
appenv=
preflight_result=
state_dir=${PILOT_RECONCILE_STATE_DIR:-$base/pilot-admin}
attempt_file=$state_dir/reconcile-attempt-20261106.json
lock_file=$state_dir/reconcile-20261106.lock
attempt_written=0
run_started=
request_id=
result_outcome=
result_token=

say() { printf 'reconcile-pilot: %s\n' "$*"; }
fail() { printf 'reconcile-pilot: FAIL %s\n' "$*" >&2; exit "${2:-1}"; }
refuse() { printf '{"ok":false,"outcome":"%s","message":"%s"}\n' "$1" "$2"; exit "$3"; }

[ "$mode" = preflight ] || [ "$mode" = execute ] || fail "mode must be preflight or execute" 3
[ "$(id -u)" != 0 ] || fail "run as the dedicated non-root pilot user, not root" 3
[ -d "$state_dir" ] || fail "the private state directory is missing" 3

exec 9>"$lock_file"
chmod 0600 "$lock_file"
flock -n 9 || refuse concurrent-invocation "another reconciliation run holds the host lock; nothing was started or sent" 3

finish_marker() {
  [ "$attempt_written" = 1 ] || return 0
  local tmp="$state_dir/.attempt-$$"
  printf '{"startedAt":"%s","finishedAt":"%s","requestId":"%s","outcome":"%s","exitCode":%s,"token":"%s"}\n' \
    "$run_started" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$request_id" "${result_outcome:-interrupted}" "$1" "${result_token:-}" >"$tmp" &&
    chmod 0600 "$tmp" && mv -f "$tmp" "$attempt_file" || true
}

cleanup() {
  local code=$?
  trap - EXIT
  finish_marker "$code"
  docker rm -f "$app_name" >/dev/null 2>&1 || true
  [ -z "$envfile" ] || rm -f "$envfile"
  [ -z "$appenv" ] || rm -f "$appenv"
  [ -z "$preflight_result" ] || rm -f "$preflight_result"
  if [ "$db_started" = 1 ]; then
    docker stop pilot-postgres >/dev/null 2>&1 || true
  fi
  exit "$code"
}
trap cleanup EXIT

if [ "$mode" = execute ]; then
  [ "${PILOT_RECONCILE_CONFIRM:-}" = ONE_SHOT ] || fail "PILOT_RECONCILE_CONFIRM=ONE_SHOT is required" 3
  if [ -e "$attempt_file" ]; then
    printf '{"ok":false,"outcome":"already-attempted","attempt":"%s","message":"a previous attempt was recorded; nothing was started or sent and no retry is permitted"}\n' "$attempt_file"
    exit 3
  fi
  now=$(date -u +%s)
  start=$(date -u -d "$window_start" +%s)
  end=$(date -u -d "$window_expiry" +%s)
  if [ "$now" -lt "$start" ]; then
    printf '{"ok":false,"outcome":"outside-window","now":"%s","notBefore":"%s","notAfter":"%s","message":"the authorized window has not opened; nothing was started or sent"}\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$window_start" "$window_expiry"
    exit 2
  fi
  if [ "$now" -ge "$end" ]; then
    printf '{"ok":false,"outcome":"expired","token":"G5A_RECONCILIATION_AUTHORIZATION_EXPIRED","now":"%s","notAfter":"%s","message":"the authorized window expired; nothing was started or executed late"}\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$window_expiry"
    exit 2
  fi
  request_id=$(cat /proc/sys/kernel/random/uuid)
  run_started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  ( set -o noclobber; printf '{"startedAt":"%s","requestId":"%s","outcome":"started"}\n' "$run_started" "$request_id" >"$attempt_file" ) ||
    fail "the single-attempt marker could not be recorded" 3
  chmod 0600 "$attempt_file"
  attempt_written=1
  say "started_utc=$run_started request_id=$request_id"
fi

say "mode=$mode utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# --- reviewed identity -------------------------------------------------------
head=$(git -C "$repo" rev-parse HEAD)
say "head=$head"
[ -z "$(git -C "$repo" status --porcelain -- server connector ops/local/migrate-pilot-db.sh)" ] ||
  fail "the reviewed source tree has uncommitted changes" 3
expect_blob() {
  local file=$1 want=$2 got
  got=$(git -C "$repo" hash-object "$file")
  [ "$got" = "$want" ] || fail "reviewed blob mismatch for $file ($got)" 3
}
expect_blob server/connector-operations.ts 01e249aad193cf2509851af3fac8a080fa946f1a
expect_blob server/connector-operations-http.ts a2cd0b7157bdc724167a10920fe18185464c69a8
expect_blob server/app.ts 8646de43aceb6799fe01174ad153b4d15f74a2c0
expect_blob server/db.ts cb44d29cbfd8e2e9b2a598213c23fedd510436e0
expect_blob server/provider-schema.ts 0dcdc44f0f768d24daa02a0a4c98ee7abe3e3463
expect_blob ops/local/migrate-pilot-db.sh 041403c81e1288075f0b4dafbaa65790f93bfb43
got_image=$(docker image inspect "$image" --format '{{.Id}}')
[ "$got_image" = "$app_image_sha" ] || fail "the reviewed application image is not present ($got_image)" 3
say "reviewed_source=verified app_image=$got_image"

# --- no connector, bootstrap or verification container -----------------------
stale=$(docker ps -a --format '{{.Names}}' | grep -E 'connector|bootstrap|pilot-reconcile-app' || true)
[ -z "$stale" ] || fail "a connector or bootstrap container exists: $stale" 3
hostproc=$(pgrep -af 'zalo-shared/(dist|connector)|pilot-bootstrap' || true)
[ -z "$hostproc" ] || fail "a connector or bootstrap process is running: $hostproc" 3
say "workers=none"

gateway=$(docker inspect zalo-shared-pilot-egress-gateway-1 --format '{{.State.Status}} {{.State.Health.Status}}' 2>/dev/null || echo missing)
[ "$gateway" = "running healthy" ] || fail "the egress gateway is not running healthy ($gateway)" 3
gateway_last=$(docker logs zalo-shared-pilot-egress-gateway-1 2>&1 | tail -1)
case $gateway_last in
  *"\"ts\":\"$gateway_contact_ts\""*'"sni_allow"'*'"sni":"id.zalo.me"'*) ;;
  *) fail "the gateway log does not end at the recorded 23:44:34Z contact" 3 ;;
esac
say "gateway=running healthy last_contact=$gateway_contact_ts"

# --- private filesystem ------------------------------------------------------
sudo -n true 2>/dev/null || fail "passwordless sudo is required to inspect the private pilot state" 3
if sudo -n test -e "$base/pilot/session.enc"; then fail "a session file exists" 3; fi
if sudo -n test -e "$base/pilot/qr.png"; then fail "a QR file exists" 3; fi
if sudo -n test -e "$base/pilot/quarantine"; then fail "a quarantine artefact exists" 3; fi
sudo -n test -f "$base/pilot/session.key" || fail "the expected session key is missing" 3
view_files=$(sudo -n find "$base/pilot/state/view" -type f 2>/dev/null | wc -l)
[ "$view_files" = 0 ] || fail "the private view directory is not empty" 3
say "private_state=session-key-only view-files=0 session.enc=absent qr=absent quarantine=absent"

# --- database ----------------------------------------------------------------
if [ "$(docker inspect -f '{{.State.Running}}' pilot-postgres 2>/dev/null)" != true ]; then
  docker start pilot-postgres >/dev/null
  db_started=1
fi
for _ in $(seq 1 60); do
  docker exec pilot-postgres pg_isready -q && break
  sleep 0.5
done
docker exec pilot-postgres pg_isready -q || fail "the pilot database did not become ready" 3
members=$(docker network inspect "$network" --format '{{range .Containers}}{{.Name}} {{end}}')
[ "$(echo "$members" | tr -s ' ' '\n' | sed '/^$/d' | sort | tr '\n' ' ')" = "pilot-postgres " ] ||
  fail "unexpected containers on the pilot database network: $members" 3
say "database=ready network=postgres-only"

envfile=$(mktemp /tmp/pilot-reconcile-preflight-XXXXXX.env)
app_url=$(grep -m1 '^DATABASE_URL=' "$base/pilot-db/secrets/pilot-connector.env" | cut -d= -f2-)
case $app_url in
  postgresql://*'sslmode=verify-full'*) ;;
  *) fail "the runtime database URL is not verify-full" 3 ;;
esac
{
  printf 'DATABASE_URL=%s\n' "$app_url"
  printf 'NODE_EXTRA_CA_CERTS=/run/pilot/db-ca.crt\n'
  printf 'EXPECTED_OWNER_ID=%s\n' "$expected_owner"
  printf 'EXPECTED_OWNER_EPOCH=%s\n' "$expected_epoch"
  printf 'EXPECTED_GAP_VERSION=%s\n' "$expected_gap"
  printf 'EXPECTED_LAST_FENCED_OWNER_ID=%s\n' "$previous_fenced_owner"
  printf 'EXPECTED_LAST_FENCED_EPOCH=%s\n' "$previous_fenced_epoch"
  printf 'EXPECTED_PRIOR_RECONCILIATIONS=1\n'
  printf 'EXPECTED_DATABASE=zalo\n'
} >"$envfile"
chmod 0600 "$envfile"

preflight_result=$(mktemp /tmp/pilot-reconcile-preflight-XXXXXX.json)
pre_status=0
docker run --rm --name pilot-reconcile-preflight \
  --network "$network" \
  --user "$(id -u):$(id -g)" \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --cap-drop=ALL \
  --security-opt no-new-privileges:true \
  --entrypoint /nodejs/bin/node \
  -v "$repo:/src:ro" \
  -v "$base/pilot-db/pki/ca.crt:/run/pilot/db-ca.crt:ro" \
  --env-file "$envfile" \
  "$image" /src/ops/local/preflight-pilot-reconciliation.mjs | tee "$preflight_result" || pre_status=$?
[ "$pre_status" = 0 ] || fail "the read-only preflight container failed" 3
grep -q '"ok":true' "$preflight_result" || fail "the read-only preflight did not pass" 3
rm -f "$preflight_result"
preflight_result=
say "preflight=pass"

if [ "$mode" = preflight ]; then
  say "preflight-only: no application, no session, no request"
  exit 0
fi

# --- application container (loopback only, no published port) ----------------
appenv=$(mktemp /tmp/pilot-reconcile-app-XXXXXX.env)
{
  printf 'DATABASE_URL=%s\n' "$app_url"
  printf 'NODE_EXTRA_CA_CERTS=/run/pilot/db-ca.crt\n'
  printf 'HOST=127.0.0.1\nPORT=3100\nPUBLIC_ORIGIN=http://127.0.0.1:3100\n'
  printf 'PROVIDER_MODE=disabled\nNODE_ENV=production\nLOGIN_RATE_LIMIT=10\n'
} >"$appenv"
chmod 0600 "$appenv"
unset app_url

docker run -d --name "$app_name" \
  --network "$network" \
  --user "$(id -u):$(id -g)" \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --cap-drop=ALL \
  --security-opt no-new-privileges:true \
  --entrypoint /nodejs/bin/node \
  -v "$repo:/src:ro" \
  -v "$base/pilot-admin:/run/pilot-admin:ro" \
  -v "$base/pilot-db/pki/ca.crt:/run/pilot/db-ca.crt:ro" \
  --env-file "$appenv" \
  "$image" /src/dist/server/main.js >/dev/null

ready=
for _ in $(seq 1 80); do
  if docker exec "$app_name" /nodejs/bin/node -e "fetch('http://127.0.0.1:3100/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    ready=1; break
  fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$app_name" 2>/dev/null)" != true ]; then
    docker logs "$app_name" 2>&1 | tail -20
    fail "the application container exited during startup" 3
  fi
  sleep 0.25
done
[ -n "$ready" ] || fail "the application did not become ready" 3
[ -z "$(docker port "$app_name" 2>/dev/null)" ] || fail "the application container published a port" 3
say "app=ready published_ports=none"

# --- the single request ------------------------------------------------------
ts=$(date -u +%Y%m%dT%H%M%SZ)
result="$base/pilot-admin/reconciliation-$ts.json"
driver_status=0
timeout 420 docker exec \
  -e PILOT_ADMIN_CREDENTIAL_FILE=/run/pilot-admin/admin.env \
  -e PILOT_ADMIN_BASE_URL=http://127.0.0.1:3100 \
  -e PILOT_RECONCILE_EXPECTED_OWNER_ID="$expected_owner" \
  -e PILOT_RECONCILE_EXPECTED_EPOCH="$expected_epoch" \
  -e PILOT_RECONCILE_EXPECTED_GAP="$expected_gap" \
  -e PILOT_RECONCILE_EXPECTED_DATABASE=zalo \
  -e PILOT_RECONCILE_EVIDENCE_REF="$evidence_ref" \
  -e PILOT_RECONCILE_REQUEST_ID="$request_id" \
  -e PILOT_RECONCILE_NOT_BEFORE="$window_start" \
  -e PILOT_RECONCILE_NOT_AFTER="$window_expiry" \
  -e PILOT_RECONCILE_CONFIRM=ONE_SHOT \
  "$app_name" /nodejs/bin/node /src/ops/local/reconcile-pilot-state.mjs | tee "$result" || driver_status=$?

docker rm -f "$app_name" >/dev/null 2>&1 || true
say "driver_exit=$driver_status result=$result"

# --- no provider activity, no connector, database returned to exited ---------
gateway_after=$(docker logs zalo-shared-pilot-egress-gateway-1 2>&1 | tail -1)
[ "$gateway_after" = "$gateway_last" ] || fail "the gateway log changed during the run" 3
stale=$(docker ps -a --format '{{.Names}}' | grep -E 'connector|bootstrap|pilot-reconcile-app' || true)
[ -z "$stale" ] || fail "a connector or bootstrap container appeared: $stale" 3
say "gateway=unchanged connector=none"

# --- report and gate token ---------------------------------------------------
result_outcome=$(sed -n 's/.*"outcome":"\([^"]*\)".*/\1/p' "$result" | head -1)
result_outcome=${result_outcome:-unknown}
report="$repo/docs/evidence/G5A-RECONCILIATION-EXECUTION-${window_start:0:10}.md"
report_status=0
report_output=$(RECONCILE_WINDOW="$window_start–$window_expiry" node "$repo/ops/local/reconcile-report.mjs" "$result" "$report") || report_status=$?
printf '%s\n' "$report_output"
result_token=$(printf '%s' "$report_output" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
say "report=$report token=${result_token:-none} finished_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
exit "$report_status"
