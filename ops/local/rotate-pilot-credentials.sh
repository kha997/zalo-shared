#!/usr/bin/env bash
# Rotate the two credentials exposed through the 2026-11-09 backup set:
# the private-pilot runtime database password (`zs_app`) and `METRICS_TOKEN`.
#
# `preflight` reads only. `execute` performs the coordinated rotation:
#   generate -> ALTER ROLE -> prove the new password works and the old one fails
#   -> atomically replace app.pw / metrics.token / app.env / connector env
#   -> recreate the application through the reviewed deploy script
#   -> verify health, metrics auth, TLS and the fenced control state.
# Any failure after the ALTER ROLE restores the previous password and rendering.
# It never prints a secret, never touches the owner role, the TLS material, the
# session key, the audit history or the connector ownership rows, and never
# contacts the provider.
set -euo pipefail
umask 077

repo=$(cd "$(dirname "$0")/../.." && pwd)
base=${PILOT_PRIVATE_DIR:-"$HOME/pilot-private/zalo-shared"}
db_base=$base/pilot-db
app_base=$base/pilot-app
state=$base/pilot-admin
pw_file=$db_base/secrets/app.pw
token_file=$app_base/metrics.token
app_env=$app_base/app.env
connector_env=$db_base/secrets/pilot-connector.env
marker=$state/rotation-20261110.done
lock_file=$state/rotation.lock
work=$state/rotation-20261110.private
name=${PILOT_APP_CONTAINER:-zalo-shared-pilot-app-1}
pg=${PILOT_DB_CONTAINER:-pilot-postgres}
network_db=${PILOT_DB_NETWORK:-zalo-shared-pilot-db}
owner_role=${PILOT_DB_OWNER_ROLE:-zs_owner}
app_role=${PILOT_DB_APP_ROLE:-zs_app}
database=${PILOT_DB_NAME:-zalo}
db_host=${PILOT_DB_HOST:-pilot-db}
mode=${1:-preflight}

say() { printf 'rotate-pilot: %s\n' "$*"; }
fail() { printf 'rotate-pilot: FAIL %s\n' "$*" >&2; exit 1; }
dbq() { docker exec "$pg" psql -U "$owner_role" -d "$database" -At -v ON_ERROR_STOP=1 -c "$1"; }

[ "$mode" = preflight ] || [ "$mode" = execute ] || fail "mode must be preflight or execute"
[ "$(id -u)" != 0 ] || fail "run as the dedicated pilot user, not root"
[ -d "$state" ] || fail "the private admin directory is missing"

exec 9>"$lock_file"
flock -n 9 || fail "another rotation run holds the single-flight lock"

# --- preflight ---------------------------------------------------------------
say "mode=$mode utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) head=$(git -C "$repo" rev-parse --short HEAD)"

[ "$(docker inspect -f '{{.State.Health.Status}}' "$pg")" = healthy ] || fail "$pg is not healthy"
[ "$(docker network inspect "$network_db" --format '{{.Internal}}')" = true ] || fail "$network_db is not internal"
[ "$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$name")" = unless-stopped ] ||
  fail "$name restart policy is not unless-stopped"
[ "$(docker inspect -f '{{.State.Health.Status}}' "$name")" = healthy ] || fail "$name is not healthy"

digest=$(docker inspect -f '{{.Image}}' "$name")
[ "$digest" = "${PILOT_APP_DIGEST:-sha256:989c61541cc95931bef1bd223934032f6d42b5937ff78de62b5e451dc0fbe824}" ] ||
  fail "$name runs $digest, not the reviewed digest"

[ -r "$connector_env" ] || fail "the connector env file is missing"
grep -q 'sslmode=verify-full' "$connector_env" || fail "the connector DSN is not verify-full"
grep -q 'sslmode=verify-full' "$app_env" || fail "the application DSN is not verify-full"

sudo -n test -r "$pw_file" || fail "the runtime password file is unreadable"
cur_pw=$(sudo -n cat "$pw_file")
[[ $cur_pw =~ ^[A-Za-z0-9_-]{40,64}$ ]] || fail "the runtime password file is malformed"

# every active consumer must currently share that one password
sudo -n python3 - "$pw_file" "$app_env" "$connector_env" <<'PY' || fail "the active consumers disagree with app.pw"
import sys, urllib.parse
pw = open(sys.argv[1]).read().strip()
def dsn(path):
    for line in open(path):
        if line.startswith('DATABASE_URL='):
            return urllib.parse.urlsplit(line.split('=', 1)[1].strip())
    return None
for path in sys.argv[2:]:
    u = dsn(path)
    if u is None or u.password != pw:
        sys.exit(1)
PY

[ "$(dbq 'SHOW log_statement')" = none ] || fail "log_statement is not none; the ALTER would be logged"
[ "$(dbq 'SELECT rolsuper FROM pg_roles WHERE rolname=current_user')" = t ] || fail "$owner_role is not a superuser session"
[ "$(dbq "SELECT count(*) FROM pg_locks WHERE locktype='advisory'")" = 0 ] || fail "an advisory lock is held"

fence=$(dbq "SELECT phase || '|' || epoch || '|' || coalesce(owner_id::text,'') || '|' || (SELECT gap_version || '|' || reconciliation_required FROM provider_state) FROM connector_ownership")
[ "$fence" = "uncertain|7|af5048a8-41c7-46b3-920c-310855d6c911|7|true" ] || fail "the fenced incident moved: $fence"

audit_rows=$(dbq 'SELECT count(*) FROM audit')
[ "$audit_rows" = 28 ] || fail "the audit row count changed: $audit_rows"

stale=$(docker ps -a --format '{{.Names}}' | grep -E 'connector|bootstrap' || true)
[ -z "$stale" ] || fail "a connector or bootstrap container exists: $stale"

gateway_last_before=$(docker logs zalo-shared-pilot-egress-gateway-1 2>&1 | tail -1)

say "preflight=pass fence=$fence audit=$audit_rows image=$digest"
say "consumers=app.env,connector.env,app.pw token-file=metrics.token"

if [ "$mode" = preflight ]; then
  say "preflight-only: no secret generated, no role altered, no container replaced"
  exit 0
fi

# --- execute ----------------------------------------------------------------
[ ! -e "$marker" ] || fail "a completed rotation is already recorded; this run is a no-op"
[ ! -e "$work" ] || fail "the private rotation directory already exists: $work"
install -d -m 0700 "$work"

old_token=$(cat "$token_file")
printf '%s\n' "$cur_pw" >"$work/old.pw"
printf '%s\n' "$old_token" >"$work/old.token"
cp -p "$connector_env" "$work/old.connector"
cp -p "$app_env" "$work/old.app.env"
chmod 0600 "$work/old.pw" "$work/old.token" "$work/old.connector" "$work/old.app.env"

new_pw=$(openssl rand -hex 24)
new_token=$(head -c 32 /dev/urandom | base64 | tr -d '+/=' | cut -c1-43)
[[ $new_pw =~ ^[A-Za-z0-9_-]{40,64}$ ]] || fail "generated password is malformed"
[[ $new_token =~ ^[A-Za-z0-9_-]{32,64}$ ]] || fail "generated token is malformed"
[ "$new_pw" != "$cur_pw" ] || fail "generated password equals the current one"
[ "$new_token" != "$old_token" ] || fail "generated token equals the current one"
printf '%s\n' "$new_pw" >"$work/new.pw"
printf '%s\n' "$new_token" >"$work/new.token"
chmod 0600 "$work/new.pw" "$work/new.token"
say "generated: password 48 chars, token 43 chars (values withheld)"

rotated=0
rollback() {
  local code=$?
  trap - EXIT
  if [ "$rotated" = 1 ]; then
    printf 'rotate-pilot: ROLLBACK restoring the previous password and rendering\n' >&2
    docker exec -i "$pg" psql -U "$owner_role" -d "$database" -q -v ON_ERROR_STOP=1 \
      <<<"ALTER ROLE $app_role PASSWORD '$(cat "$work/old.pw")';" >/dev/null 2>&1 || true
    sudo -n install -m 0440 -o root -g systemd-journal "$work/old.pw" "$pw_file.rollback" 2>/dev/null || true
    sudo -n mv -f "$pw_file.rollback" "$pw_file" 2>/dev/null || true
    printf '%s\n' "$old_token" >"$token_file.rollback" && mv -f "$token_file.rollback" "$token_file"
    cp -p "$work/old.connector" "$connector_env.rollback" && mv -f "$connector_env.rollback" "$connector_env"
    cp -p "$work/old.app.env" "$app_env.rollback" && mv -f "$app_env.rollback" "$app_env"
    bash "$repo/ops/local/deploy-pilot-app.sh" >/dev/null 2>&1 || true
  fi
  rm -rf "$work"
  exit "$code"
}
trap rollback EXIT

docker exec -i "$pg" psql -U "$owner_role" -d "$database" -q -v ON_ERROR_STOP=1 \
  <<<"ALTER ROLE $app_role PASSWORD '$new_pw';" >/dev/null
rotated=1
say "database role password replaced"

# prove the new password works and the old one no longer does, over TLS
printf 'PGPASSWORD=%s\n' "$new_pw" >"$work/new.pgenv"
printf 'PGPASSWORD=%s\n' "$cur_pw" >"$work/old.pgenv"
probe() {
  docker run --rm --network "$network_db" --env-file "$1" \
    -v "$db_base/pki/ca.crt:/ca.crt:ro" --read-only --cap-drop=ALL \
    --security-opt no-new-privileges:true postgres:17-bookworm \
    psql "host=$db_host port=5432 dbname=$database user=$app_role sslmode=verify-full sslrootcert=/ca.crt" \
    -At -c 'select 1' >/dev/null 2>&1
}
probe "$work/new.pgenv" || fail "the new password does not authenticate"
say "new-credential-auth=accepted"
if probe "$work/old.pgenv"; then fail "the previous password still authenticates"; fi
say "old-credential-auth=rejected"

# atomically replace every private consumer
sudo -n install -m 0440 -o root -g systemd-journal "$work/new.pw" "$pw_file.new" ||
  fail "the runtime password file could not be staged"
sudo -n mv -f "$pw_file.new" "$pw_file"

printf '%s\n' "$new_token" >"$token_file.new" && chmod 0600 "$token_file.new" && mv -f "$token_file.new" "$token_file"

python3 - "$connector_env" "$new_pw" "$work/connector.new" <<'PY'
import sys, urllib.parse
path, pw, out = sys.argv[1:4]
lines = []
for line in open(path):
    if line.startswith('DATABASE_URL='):
        u = urllib.parse.urlsplit(line.split('=', 1)[1].strip())
        netloc = f"{u.username}:{pw}@{u.hostname}" + (f":{u.port}" if u.port else "")
        line = f"DATABASE_URL={urllib.parse.urlunsplit((u.scheme, netloc, u.path, u.query, ''))}\n"
    lines.append(line)
open(out, 'w').write(''.join(lines))
PY
chmod 0600 "$work/connector.new"
install -m 0600 "$work/connector.new" "$connector_env.new" && mv -f "$connector_env.new" "$connector_env"
say "files replaced: app.pw, metrics.token, connector env (atomic)"

sudo -n python3 - "$pw_file" "$connector_env" <<'PY' || fail "the replaced files are not consistent"
import sys, urllib.parse
pw = open(sys.argv[1]).read().strip()
u = None
for line in open(sys.argv[2]):
    if line.startswith('DATABASE_URL='):
        u = urllib.parse.urlsplit(line.split('=', 1)[1].strip())
if u is None or u.password != pw or 'sslmode=verify-full' not in open(sys.argv[2]).read():
    sys.exit(1)
PY

before_start=$(docker inspect -f '{{.State.StartedAt}}' "$name")
PILOT_APP_DIGEST="$digest" bash "$repo/ops/local/deploy-pilot-app.sh" >/dev/null
after_start=$(docker inspect -f '{{.State.StartedAt}}' "$name")
if [ "$before_start" = "$after_start" ]; then
  say "compose did not recreate the container; forcing the reviewed service update"
  docker compose --env-file "$app_base/topology/pilot-app-interpolation.env" \
    -f "$app_base/topology/pilot-app-compose.yml" up -d --force-recreate app >/dev/null
  for _ in $(seq 1 60); do
    [ "$(docker inspect -f '{{.State.Health.Status}}' "$name")" = healthy ] && break
    sleep 1
  done
fi
[ "$(docker inspect -f '{{.State.Health.Status}}' "$name")" = healthy ] || fail "$name did not become healthy"
say "app=healthy recreated=$( [ "$before_start" = "$(docker inspect -f '{{.State.StartedAt}}' "$name")" ] && echo no || echo yes )"

# application uses the new password: only new credentials are accepted now
ready=$(docker exec "$name" /nodejs/bin/node -e 'fetch("http://127.0.0.1:3100/health/ready").then(async r=>{process.stdout.write(String(r.status));process.exit(0)}).catch(()=>process.exit(1))')
[ "$ready" = 200 ] || fail "the application readiness probe returned $ready"

metrics_code() {
  local file=$1
  printf 'Authorization: Bearer %s\n' "$(cat "$file")" >"$work/hdr"
  curl -s -o /dev/null -w '%{http_code}' -H @"$work/hdr" "http://127.0.0.1:3100/metrics"
}
printf '%s\n' "$new_token" >"$work/new.token"
printf '%s\n' "$old_token" >"$work/old.token.check"
new_code=$(metrics_code "$work/new.token")
old_code=$(metrics_code "$work/old.token.check")
[ "$new_code" = 200 ] || fail "the new token is not accepted by /metrics ($new_code)"
[ "$old_code" = 401 ] || fail "the previous token is still accepted by /metrics ($old_code)"
say "metrics new-token=200 old-token=401"

tls=$(dbq "SELECT s.version || '/' || s.cipher || '/' || a.usename FROM pg_stat_ssl s JOIN pg_stat_activity a USING (pid) WHERE a.datname=current_database() AND a.usename='$app_role' AND s.ssl LIMIT 1")
[[ $tls == TLSv1.3/*"$app_role" ]] || fail "no TLS session for $app_role: $tls"
say "app-session-tls=$tls"

gateway_state=$(docker inspect -f '{{.State.Status}}/{{.State.Health.Status}}' zalo-shared-pilot-egress-gateway-1)
[ "$gateway_state" = running/healthy ] || fail "the egress gateway is $gateway_state"
gateway_last_after=$(docker logs zalo-shared-pilot-egress-gateway-1 2>&1 | tail -1)
[ "$gateway_last_after" = "$gateway_last_before" ] || fail "the gateway log changed during rotation"
stale=$(docker ps -a --format '{{.Names}}' | grep -E 'connector|bootstrap' || true)
[ -z "$stale" ] || fail "a connector appeared during rotation: $stale"

after_fence=$(dbq "SELECT phase || '|' || epoch || '|' || coalesce(owner_id::text,'') || '|' || (SELECT gap_version || '|' || reconciliation_required FROM provider_state) FROM connector_ownership")
[ "$after_fence" = "$fence" ] || fail "the control state changed: $after_fence"
unresolved=$(dbq "SELECT (SELECT count(*) FROM provider_events WHERE account_id=(SELECT account_id FROM connector_ownership) AND (state='held' OR variant_overflow OR variant_evidence_missing OR (conflict AND resolved_at IS NULL)))
 + (SELECT count(*) FROM provider_media_jobs WHERE account_id=(SELECT account_id FROM connector_ownership) AND status IN ('held','pending','processing'))
 + (SELECT count(*) FROM outbox b JOIN messages m ON m.id=b.message_id JOIN conversations c ON c.id=m.conversation_id WHERE c.account_id=(SELECT account_id FROM connector_ownership) AND (b.status IN ('pending','processing','unknown') OR m.status IN ('pending','processing','unknown')))
 + (SELECT count(*) FROM delivery_parts dp JOIN messages m ON m.id=dp.message_id JOIN conversations c ON c.id=m.conversation_id WHERE c.account_id=(SELECT account_id FROM connector_ownership) AND dp.status IN ('pending','processing','unknown'))")
[ "$unresolved" = 0 ] || fail "unresolved work appeared: $unresolved"
after_audit=$(dbq 'SELECT count(*) FROM audit')
[ "$after_audit" = "$audit_rows" ] || fail "the audit row count changed: $after_audit"

# sanitized record: actions and booleans only, never a value or a verifier
cat >"$state/rotation-20261110.json" <<JSON
{
  "completedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "head": "$(git -C "$repo" rev-parse HEAD)",
  "rotated": ["zs_app database password", "METRICS_TOKEN"],
  "notRotated": ["zs_owner password", "pilot admin password", "TLS material", "session key"],
  "appliedTo": ["pilot-db/secrets/app.pw", "pilot-app/metrics.token", "pilot-app/app.env", "pilot-db/secrets/pilot-connector.env"],
  "appContainerRecreated": $( [ "$before_start" = "$(docker inspect -f '{{.State.StartedAt}}' "$name")" ] && echo false || echo true ),
  "appHealth": "healthy",
  "readinessStatus": $ready,
  "metrics": { "newToken": $new_code, "previousToken": $old_code },
  "appSessionTls": "$tls",
  "oldCredentialRejected": true,
  "gateway": "$gateway_state",
  "connectorRunning": false,
  "fence": "$after_fence",
  "auditRows": $after_audit,
  "unresolvedWork": $unresolved
}
JSON
chmod 0600 "$state/rotation-20261110.json"
printf '%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$marker"
chmod 0600 "$marker"

rotated=0
rm -rf "$work"
trap - EXIT
say "rotation=complete record=$state/rotation-20261110.json"
exit 0
