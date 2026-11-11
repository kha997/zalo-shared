#!/usr/bin/env bash
# One-shot executor for the reconciliation of the 2026-11-09 fenced incident
# (epoch 7). Preparation only until an Owner UTC window exists.
#
# The window is NOT hardcoded. It is read from the Owner-supplied private file
#   $PILOT_PRIVATE_DIR/pilot-admin/reconcile-window-20261110.json
# which must contain {"notBefore","notAfter","authorizationRef"} (optionally
# "head" to pin the reviewed commit). Without that file nothing is stopped,
# started or sent.
#
# preflight: read-only. Verifies identity, the fenced incident, the absence of a
#            connector/session, the gateway and the control row. It does not stop
#            the application, so it reports app_quiesce_required=1.
# execute:   re-runs every check inside the window, quiesces the deployed
#            application, proves zero other database sessions, runs the reviewed
#            read-only preflight, starts one loopback-only application container
#            from the reviewed image, invokes the reviewed admin route exactly
#            once, removes that container, restarts the deployed application in
#            place, and verifies the resulting state on a separate read-only
#            connection. No retry, no replay, no window extension.
set -euo pipefail
umask 077

repo=$(cd "$(dirname "$0")/../.." && pwd)
base=${PILOT_PRIVATE_DIR:-"$HOME/pilot-private/zalo-shared"}
state=$base/pilot-admin
window_file=${PILOT_RECONCILE_WINDOW_FILE:-$state/reconcile-window-20261110.json}
request_file=$state/reconcile-request-2026-11-10.json
credential_file=$state/admin.env
network=${PILOT_DB_NETWORK:-zalo-shared-pilot-db}
pg=${PILOT_DB_CONTAINER:-pilot-postgres}
app=${PILOT_APP_CONTAINER:-zalo-shared-pilot-app-1}
one_shot=${PILOT_RECONCILE_APP_NAME:-pilot-reconcile-app}
image=${PILOT_APP_IMAGE:-zalo-shared:g5-patched-af2be54}
digest=${PILOT_APP_DIGEST:-sha256:989c61541cc95931bef1bd223934032f6d42b5937ff78de62b5e451dc0fbe824}
mode=${1:-preflight}

# The fenced incident this wrapper is bound to.
owner=af5048a8-41c7-46b3-920c-310855d6c911
epoch=7
gap=7
fault=shutdown
uncertain_prefix=2026-11-09T13:25:18
last_fenced_owner=7cc878cf-cdb1-4b4a-9905-2d107aa21482
last_fenced_epoch=5
prior_reconciliations=3

# Blobs reviewed for this wrapper (ops/local/reconcile-pilot-state.mjs and
# ops/local/preflight-pilot-reconciliation.mjs at the reviewed commit).
driver_blob=bb7a18cc7baf9307845d378f50bc8a7b6ac79400
preflight_blob=b3f342748c64b4d9feaf6a41fcb8f3d9b020f218

attempt_file=$state/reconcile-attempt-20261110.json
lock_file=$state/reconcile-20261110.lock
app_stopped=0
envfile=
appenv=
preflight_json=
attempt_written=0
run_started=
request_id=
window_start=
window_expiry=

say() { printf 'reconcile-20261110: %s\n' "$*"; }
fail() { printf 'reconcile-20261110: FAIL %s\n' "$*" >&2; exit "${2:-1}"; }
refuse() { printf '{"ok":false,"outcome":"%s","message":"%s"}\n' "$1" "$2"; exit "$3"; }
dbq() { docker exec "$pg" psql -U zs_owner -d zalo -At -v ON_ERROR_STOP=1 -c "$1"; }

[ "$mode" = preflight ] || [ "$mode" = execute ] || fail "mode must be preflight or execute" 3
[ "$(id -u)" != 0 ] || fail "run as the dedicated non-root pilot user, not root" 3
[ -d "$state" ] || fail "the private state directory is missing" 3

exec 9>"$lock_file"
chmod 0600 "$lock_file"
flock -n 9 || refuse concurrent-invocation "another run holds the host lock; nothing was stopped or sent" 3

app_restart_failed=0
restart_app() {
  [ "$app_stopped" = 1 ] || return 0
  docker start "$app" >/dev/null 2>&1 || true
  for _ in $(seq 1 60); do
    [ "$(docker inspect -f '{{.State.Health.Status}}' "$app" 2>/dev/null)" = healthy ] && return 0
    sleep 1
  done
  printf 'reconcile-20261110: FAIL the deployed application did not return healthy\n' >&2
  app_restart_failed=1
}
cleanup() {
  local code=$?
  trap - EXIT
  docker rm -f "$one_shot" >/dev/null 2>&1 || true
  [ -z "$envfile" ] || rm -f "$envfile"
  [ -z "$appenv" ] || rm -f "$appenv"
  [ -z "$preflight_json" ] || rm -f "$preflight_json"
  restart_app
  [ "$app_restart_failed" = 1 ] && [ "$code" = 0 ] && code=1
  if [ "$attempt_written" = 1 ]; then
    local tmp="$state/.attempt-$$"
    printf '{"startedAt":"%s","finishedAt":"%s","requestId":"%s","outcome":"%s","exitCode":%s}\n' \
      "$run_started" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$request_id" "${outcome:-interrupted}" "$code" >"$tmp" &&
      chmod 0600 "$tmp" && mv -f "$tmp" "$attempt_file" || true
  fi
  exit "$code"
}
trap cleanup EXIT

# --- reviewed identity -------------------------------------------------------
head=$(git -C "$repo" rev-parse HEAD)
[ -z "$(git -C "$repo" status --porcelain -- server connector ops/local dist)" ] ||
  fail "the reviewed source tree has uncommitted changes" 3
[ "$(git -C "$repo" hash-object ops/local/reconcile-pilot-state.mjs)" = "$driver_blob" ] ||
  fail "the reconciliation driver does not match the reviewed blob" 3
[ "$(git -C "$repo" hash-object ops/local/preflight-pilot-reconciliation.mjs)" = "$preflight_blob" ] ||
  fail "the reconciliation preflight does not match the reviewed blob" 3
[ "$(docker image inspect "$image" --format '{{.Id}}' 2>/dev/null)" = "$digest" ] ||
  fail "the reviewed application image is not present" 3
[ "$(docker image inspect "$image" --format '{{.Config.User}}')" = "65532:65532" ] ||
  fail "the reviewed image does not run as uid 65532" 3
say "head=$head image=$image $digest"

# --- prepared request, not yet used -----------------------------------------
[ -f "$request_file" ] || fail "the prepared request file is missing" 3
read -r prepared_request_id prepared_owner prepared_epoch prepared_gap prepared_ref prepared_not_sent < <(
  python3 - "$request_file" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
b = d.get('body') or {}
print(b.get('requestId'), b.get('expectedOwnerId'), b.get('expectedOwnerEpoch'),
      b.get('expectedGapVersion'), b.get('evidenceRef'), 'true' if d.get('notSent') else 'false')
PY
)
[ "$prepared_not_sent" = true ] || fail "the prepared request is marked as already sent" 3
[ "$prepared_owner" = "$owner" ] || fail "the prepared request is bound to a different owner" 3
[ "$prepared_epoch" = "$epoch" ] || fail "the prepared request is bound to a different epoch" 3
[ "$prepared_gap" = "$gap" ] || fail "the prepared request is bound to a different gap" 3
case "$prepared_request_id" in
  *[!0-9a-f-]*|'') fail "the prepared request id is malformed" 3 ;;
esac
[ "${#prepared_request_id}" = 36 ] || fail "the prepared request id is malformed" 3
say "request_id=$prepared_request_id evidence_ref=$prepared_ref"

# --- no connector, bootstrap or one-shot worker ------------------------------
stale=$(docker ps -a --format '{{.Names}}' | grep -E 'connector|bootstrap|'"$one_shot" || true)
[ -z "$stale" ] || fail "a connector or worker container exists: $stale" 3
hostproc=$(pgrep -af 'zalo-shared/(dist|connector)|pilot-bootstrap' || true)
[ -z "$hostproc" ] || fail "a connector process is running: $hostproc" 3

gateway_last=$(docker logs zalo-shared-pilot-egress-gateway-1 2>&1 | tail -1)
[ "$(docker inspect zalo-shared-pilot-egress-gateway-1 --format '{{.State.Status}} {{.State.Health.Status}}')" = "running healthy" ] ||
  fail "the egress gateway is not running healthy" 3
case "$gateway_last" in
  *'"event":"startup"'*) ;;
  *) fail "the gateway log carries traffic; expected no provider contact" 3 ;;
esac
say "gateway=running healthy last_event=startup tunnels=none"

# --- private filesystem ------------------------------------------------------
sudo -n test ! -e "$base/pilot/session.enc" || fail "a session file exists" 3
sudo -n test ! -e "$base/pilot/qr.png" || fail "a QR file exists" 3
sudo -n test ! -e "$base/pilot/quarantine" || fail "a quarantine artefact exists" 3
sudo -n test -f "$base/pilot/session.key" || fail "the expected session key is missing" 3
say "private_state=session-key-only session.enc=absent qr=absent quarantine=absent"

# --- fenced control state (read-only) ---------------------------------------
fence=$(dbq "SELECT phase || '|' || epoch || '|' || coalesce(owner_id::text,'') || '|' || fault_code || '|' || to_char(uncertain_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS') || '|' || coalesce(last_fenced_owner_id::text,'') || '|' || coalesce(last_fenced_epoch::text,'') FROM connector_ownership")
[ "$fence" = "uncertain|$epoch|$owner|$fault|$uncertain_prefix|$last_fenced_owner|$last_fenced_epoch" ] ||
  fail "the fenced incident moved: $fence" 3
provider=$(dbq "SELECT status || '|' || gap_version || '|' || reconciliation_required || '|' || fault_code FROM provider_state")
[ "$provider" = "disconnected|$gap|true|$fault" ] || fail "the provider state moved: $provider" 3
prior_audit=$(dbq "SELECT count(*) || '|' || coalesce(max(id),0) || '|' || (SELECT count(*) FROM audit WHERE action='connector.reconciled') FROM audit")
IFS='|' read -r audit_rows audit_max audit_reconciled <<<"$prior_audit"
[ "$audit_reconciled" = "$prior_reconciliations" ] || fail "prior reconciliation count is $audit_reconciled, expected $prior_reconciliations" 3
say "fence=$fence provider=$provider audit_rows=$audit_rows audit_max=$audit_max"

locks=$(dbq "SELECT count(*) FROM pg_locks WHERE locktype='advisory'")
[ "$locks" = 0 ] || fail "an advisory lock is held" 3
sessions=$(dbq "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()")
say "advisory_locks=0 db_sessions=$sessions"

if [ "$mode" = preflight ]; then
[ "$sessions" -gt 0 ] && say "app_quiesce_required=1 db_sessions=$sessions"
[ -f "$credential_file" ] || fail "the pilot admin credential file is missing" 3
say "preflight=pass preflight-only: nothing stopped, nothing sent"
  exit 0
fi

# --- window (Owner-supplied, never hardcoded) --------------------------------
[ "${PILOT_RECONCILE_CONFIRM:-}" = ONE_SHOT ] || fail "PILOT_RECONCILE_CONFIRM=ONE_SHOT is required" 3
[ -f "$window_file" ] ||
  refuse window-missing "no Owner window file at $window_file; nothing was stopped or sent" 3
read -r window_start window_expiry authorization_ref pinned_head < <(
  python3 - "$window_file" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
print(d.get('notBefore', ''), d.get('notAfter', ''), d.get('authorizationRef', ''), d.get('head', ''))
PY
)
case "$window_start$window_expiry" in
  *[!0-9TZ:.-]*) fail "the window timestamps are malformed" 3 ;;
esac
[ -n "$window_start" ] && [ -n "$window_expiry" ] && [ -n "$authorization_ref" ] ||
  fail "the window file must carry notBefore, notAfter and authorizationRef" 3
now=$(date -u +%s)
start=$(date -u -d "$window_start" +%s)
end=$(date -u -d "$window_expiry" +%s)
[ "$end" -gt "$start" ] || fail "the window is empty" 3
if [ "$now" -lt "$start" ]; then
  refuse outside-window "the authorized window has not opened; nothing was stopped or sent" 2
fi
if [ "$now" -ge "$end" ]; then
  printf '{"ok":false,"outcome":"expired","token":"G5A_RECONCILIATION_AUTHORIZATION_EXPIRED","notAfter":"%s","message":"the window expired; nothing was sent late"}\n' "$window_expiry"
  exit 2
fi
if [ -n "$pinned_head" ]; then
  case "$head" in
    "$pinned_head"*) ;;
    *) fail "HEAD $head does not match the pinned commit $pinned_head" 3 ;;
  esac
fi
[ ! -e "$attempt_file" ] ||
  refuse already-attempted "a previous attempt was recorded; nothing was stopped or sent and no retry is permitted" 3
request_id=$prepared_request_id
run_started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
( set -o noclobber; printf '{"startedAt":"%s","requestId":"%s","outcome":"started"}\n' "$run_started" "$request_id" >"$attempt_file" ) ||
  fail "the single-attempt marker could not be recorded" 3
chmod 0600 "$attempt_file"
attempt_written=1
say "window=$window_start..$window_expiry authorization=$authorization_ref"
say "started_utc=$run_started request_id=$request_id"

# --- quiesce the deployed application ---------------------------------------
docker stop "$app" >/dev/null
app_stopped=1
for _ in $(seq 1 30); do
  [ "$(dbq "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND usename='zs_app' AND pid<>pg_backend_pid()")" = 0 ] && break
  sleep 1
done
[ "$(dbq "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()")" = 0 ] ||
  fail "database sessions survived quiescence" 3
say "quiescence=zero-other-sessions app=stopped"

# --- reviewed read-only preflight (zero sessions) ---------------------------
app_url=$(grep -m1 '^DATABASE_URL=' "$base/pilot-db/secrets/pilot-connector.env" | cut -d= -f2-)
case "$app_url" in
  postgresql://*'sslmode=verify-full'*) ;;
  *) fail "the runtime database URL is not verify-full" 3 ;;
esac
envfile=$(mktemp /tmp/pilot-reconcile-preflight-XXXXXX.env)
{
  printf 'DATABASE_URL=%s\n' "$app_url"
  printf 'NODE_EXTRA_CA_CERTS=/run/pilot/db-ca.crt\n'
  printf 'EXPECTED_OWNER_ID=%s\n' "$owner"
  printf 'EXPECTED_OWNER_EPOCH=%s\n' "$epoch"
  printf 'EXPECTED_GAP_VERSION=%s\n' "$gap"
  printf 'EXPECTED_FAULT=%s\n' "$fault"
  printf 'EXPECTED_UNCERTAIN_AT=%s\n' "$uncertain_prefix"
  printf 'EXPECTED_LAST_FENCED_OWNER_ID=%s\n' "$last_fenced_owner"
  printf 'EXPECTED_LAST_FENCED_EPOCH=%s\n' "$last_fenced_epoch"
  printf 'EXPECTED_PRIOR_RECONCILIATIONS=%s\n' "$prior_reconciliations"
  printf 'EXPECTED_DATABASE=zalo\n'
} >"$envfile"
chmod 0600 "$envfile"
preflight_json=$(mktemp /tmp/pilot-reconcile-preflight-XXXXXX.json)
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
  "$image" /src/ops/local/preflight-pilot-reconciliation.mjs | tee "$preflight_json" || pre_status=$?
[ "$pre_status" = 0 ] || fail "the read-only preflight container failed" 3
grep -q '"ok":true' "$preflight_json" || fail "the read-only preflight did not pass" 3
rm -f "$preflight_json"
preflight_json=
say "preflight=pass"

# --- one loopback-only application container --------------------------------
appenv=$(mktemp /tmp/pilot-reconcile-app-XXXXXX.env)
{
  printf 'DATABASE_URL=%s\n' "$app_url"
  printf 'NODE_EXTRA_CA_CERTS=/run/pilot/db-ca.crt\n'
  printf 'HOST=127.0.0.1\nPORT=3100\nPUBLIC_ORIGIN=http://127.0.0.1:3100\n'
  printf 'PROVIDER_MODE=disabled\nNODE_ENV=production\nLOGIN_RATE_LIMIT=10\n'
} >"$appenv"
chmod 0600 "$appenv"
unset app_url
docker run -d --name "$one_shot" \
  --network "$network" \
  --user "$(id -u):$(id -g)" \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --cap-drop=ALL \
  --security-opt no-new-privileges:true \
  --entrypoint /nodejs/bin/node \
  -v "$repo:/src:ro" \
  -v "$state:/run/pilot-admin:ro" \
  -v "$base/pilot-db/pki/ca.crt:/run/pilot/db-ca.crt:ro" \
  --env-file "$appenv" \
  "$image" /src/dist/server/main.js >/dev/null
ready=
for _ in $(seq 1 80); do
  if docker exec "$one_shot" /nodejs/bin/node -e "fetch('http://127.0.0.1:3100/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    ready=1; break
  fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$one_shot" 2>/dev/null)" != true ]; then
    docker logs "$one_shot" 2>&1 | tail -20
    fail "the application container exited during startup" 3
  fi
  sleep 0.25
done
[ -n "$ready" ] || fail "the application did not become ready" 3
[ -z "$(docker port "$one_shot" 2>/dev/null)" ] || fail "the application container published a port" 3
say "app=ready published_ports=none"

# --- the single request ------------------------------------------------------
ts=$(date -u +%Y%m%dT%H%M%SZ)
result=$state/reconciliation-$ts.json
driver_status=0
timeout 420 docker exec \
  -e PILOT_ADMIN_CREDENTIAL_FILE=/run/pilot-admin/admin.env \
  -e PILOT_ADMIN_BASE_URL=http://127.0.0.1:3100 \
  -e PILOT_RECONCILE_EXPECTED_OWNER_ID="$owner" \
  -e PILOT_RECONCILE_EXPECTED_EPOCH="$epoch" \
  -e PILOT_RECONCILE_EXPECTED_GAP="$gap" \
  -e PILOT_RECONCILE_EXPECTED_DATABASE=zalo \
  -e PILOT_RECONCILE_EVIDENCE_REF="$prepared_ref" \
  -e PILOT_RECONCILE_REQUEST_ID="$request_id" \
  -e PILOT_RECONCILE_NOT_BEFORE="$window_start" \
  -e PILOT_RECONCILE_NOT_AFTER="$window_expiry" \
  -e PILOT_RECONCILE_CONFIRM=ONE_SHOT \
  "$one_shot" /nodejs/bin/node /src/ops/local/reconcile-pilot-state.mjs | tee "$result" || driver_status=$?
docker rm -f "$one_shot" >/dev/null 2>&1 || true
say "driver_exit=$driver_status result=$result"

# --- gateway unchanged, no connector ---------------------------------------
[ "$(docker logs zalo-shared-pilot-egress-gateway-1 2>&1 | tail -1)" = "$gateway_last" ] ||
  fail "the gateway log changed during the run" 3
stale=$(docker ps -a --format '{{.Names}}' | grep -E 'connector|bootstrap|'"$one_shot" || true)
[ -z "$stale" ] || fail "a connector or worker container appeared: $stale" 3
say "gateway=unchanged connector=none"

# --- independent post-verification (separate read-only connection) ----------
after=$(dbq "SELECT phase || '|' || epoch || '|' || coalesce(owner_id::text,'') || '|' || coalesce(last_fenced_owner_id::text,'') || '|' || coalesce(last_fenced_epoch::text,'') || '|' || (SELECT status || '|' || gap_version || '|' || reconciliation_required FROM provider_state) FROM connector_ownership")
after_audit=$(dbq "SELECT count(*) || '|' || coalesce(max(id),0) || '|' || (SELECT count(*) FROM audit WHERE action='connector.reconciled') FROM audit")
read -r after_rows after_max after_reconciled <<<"${after_audit//|/ }"
outcome=verification-failed
[ "$driver_status" = 0 ] ||
  printf 'reconcile-20261110: driver_exit=%s\n' "$driver_status" >&2
[ "$after" = "idle|8||$owner|$epoch|disconnected|8|false" ] || {
  printf 'reconcile-20261110: FAIL unexpected post-state %s\n' "$after" >&2
  exit 1
}
[ "$after_reconciled" = "$((prior_reconciled + 1))" ] || {
  printf 'reconcile-20261110: FAIL reconciliation audit count %s\n' "$after_reconciled" >&2
  exit 1
}
[ "$after_rows" = "$((audit_rows + 1))" ] || {
  printf 'reconcile-20261110: FAIL audit rows %s, expected %s\n' "$after_rows" "$((audit_rows + 1))" >&2
  exit 1
}
[ "$(dbq "SELECT count(*) FROM pg_locks WHERE locktype='advisory'")" = 0 ] ||
  fail "an advisory lock survived the run" 3
residual=$(dbq "SELECT (SELECT count(*) FROM provider_events WHERE account_id=(SELECT account_id FROM connector_ownership) AND (state='held' OR variant_overflow OR variant_evidence_missing OR (conflict AND resolved_at IS NULL)))
 + (SELECT count(*) FROM provider_media_jobs WHERE account_id=(SELECT account_id FROM connector_ownership) AND status IN ('held','pending','processing'))
 + (SELECT count(*) FROM outbox b JOIN messages m ON m.id=b.message_id JOIN conversations c ON c.id=m.conversation_id WHERE c.account_id=(SELECT account_id FROM connector_ownership) AND (b.status IN ('pending','processing','unknown') OR m.status IN ('pending','processing','unknown')))
 + (SELECT count(*) FROM delivery_parts dp JOIN messages m ON m.id=dp.message_id JOIN conversations c ON c.id=m.conversation_id WHERE c.account_id=(SELECT account_id FROM connector_ownership) AND dp.status IN ('pending','processing','unknown'))")
[ "$residual" = 0 ] || fail "unresolved work remains: $residual" 3
outcome=reconciled
printf '{"ok":true,"outcome":"reconciled","epoch":"8","gapVersion":"8","auditRows":%s,"auditMaxId":%s,"reconciledRows":%s,"unresolvedWork":0,"window":"%s..%s"}\n' \
  "$after_rows" "$after_max" "$after_reconciled" "$window_start" "$window_expiry"
say "post_state=$after unresolved=0"
exit 0
