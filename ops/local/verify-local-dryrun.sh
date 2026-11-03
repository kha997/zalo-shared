#!/usr/bin/env bash
# D4: end-to-end dry run against the deployed topology with synthetic inputs.
#
# Exercises, in order: image identity, database TLS through the connector's own
# gate, connector ownership admission on a disposable database clone, the
# deployed network boundary, the enrollment grant scope, the synthetic QR view,
# the encrypted session store, a real compose dry-run, container shutdown and
# the absence of residual containers or external traffic.
#
# No SDK login, no real QR, no provider hostname, no write to the live pilot
# ownership state. The clone database is dropped on exit.
set -euo pipefail
cd "$(dirname "$0")/../.."
repo=$(pwd)

image=${PILOT_CONNECTOR_IMAGE:-zalo-shared-connector:g5-local}
base=${PILOT_PRIVATE_DIR:-"$HOME/pilot-private/zalo-shared"}
db_base=$base/pilot-db
network=${PILOT_DB_NETWORK:-zalo-shared-pilot-db}
gateway=${PILOT_GATEWAY_CONTAINER:-zalo-shared-pilot-egress-gateway-1}
compose_priv=$base/topology/pilot-compose.yml
interp=$base/topology/pilot-interpolation.env
fixtures=$base/g5-enroll/fixtures
clone=zalo_ownership_check
holder=g5-owner-hold-$$
shutdown=g5-shutdown-$$
tmp=$(mktemp -d)

owner_sql() {
  docker exec -i pilot-postgres bash -lc "PGPASSWORD=\$(cat /run/secrets/owner.pw) psql 'host=pilot-db dbname=zalo user=zs_owner sslmode=verify-full sslrootcert=/var/lib/postgresql/tls/ca.crt' -X -tA -v ON_ERROR_STOP=1"
}
cleanup() {
  docker rm -f "$holder" >/dev/null 2>&1 || true
  docker rm -f "$shutdown" >/dev/null 2>&1 || true
  printf 'DROP DATABASE IF EXISTS %s WITH (FORCE);\n' "$clone" | owner_sql >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT

say() { printf 'pilot-dryrun: %s\n' "$*"; }
fail() { printf 'pilot-dryrun: FAIL %s\n' "$*" >&2; exit 1; }

for cmd in docker python3; do
  command -v "$cmd" >/dev/null || fail "$cmd is required"
done
docker image inspect "$image" >/dev/null 2>&1 || fail "$image not found"
docker container inspect pilot-postgres >/dev/null 2>&1 || fail "pilot-postgres is missing"
[ "$(docker inspect -f '{{.State.Health.Status}}' "$gateway")" = "healthy" ] || fail "the gateway is not healthy"
[ -f "$compose_priv" ] && [ -f "$interp" ] || fail "run deploy-pilot-topology.sh first"
[ -f "$fixtures/enroll.synthetic.json" ] || fail "run make-enroll-fixtures.mjs first"

before_gateway_lines=$(docker logs "$gateway" 2>&1 | wc -l)

# ------------------------------------------------------- 1. build identity
docker run --rm --network none --entrypoint /nodejs/bin/node "$image" \
  -e 'process.stdout.write(require("fs").readFileSync("/app/build-identity.json","utf8"))' \
  >"$tmp/identity.json"
python3 - "$tmp/identity.json" "$repo/connector/package-lock.json" "$base/g5-enroll/manifest.enroll.template.json" <<'PY'
import hashlib, json, sys
identity = json.load(open(sys.argv[1], encoding="utf-8"))
lock_bytes = open(sys.argv[2], "rb").read()
lock = json.loads(lock_bytes)
template = json.load(open(sys.argv[3], encoding="utf-8"))
build = {key: identity.get(key) for key in ("sourceCommit", "lockSha256", "sdkIntegrity")}
assert len(identity["sourceCommit"]) == 40, "source commit"
assert identity["lockSha256"] == hashlib.sha256(lock_bytes).hexdigest(), "lock hash"
assert identity["sdkIntegrity"] == lock["packages"]["node_modules/zca-js"]["integrity"], "sdk"
assert template["build"] == build, "template build block"
print(f"pilot-dryrun: PASS  image identity {identity['sourceCommit'][:12]} matches the lock and template")
PY

# ------------------------------------------------ 2. database TLS path
say "checking the connector database gate on the deployed database"
bash ops/local/verify-connector-db-path.sh >"$tmp/db.log"
grep -q 'all checks PASS' "$tmp/db.log" || fail "the database path checks failed"
grep '^connector-db: ' "$tmp/db.log"

# ------------------------------------- 3. ownership admission on a clone
say "claiming connector ownership on a disposable clone of $clone"
printf 'DROP DATABASE IF EXISTS %s WITH (FORCE);\nCREATE DATABASE %s TEMPLATE zalo;\n' "$clone" "$clone" | owner_sql >/dev/null ||
  fail "could not create the ownership clone"

umask 077
app_pw=$(sudo cat "$db_base/secrets/app.pw")
[[ $app_pw =~ ^[A-Za-z0-9_-]{40,64}$ ]] || fail "runtime password is not URL-safe"
printf 'DATABASE_URL=postgresql://zs_app:%s@pilot-db:5432/%s?sslmode=verify-full\nNODE_EXTRA_CA_CERTS=/run/pilot/db-ca.crt\n' \
  "$app_pw" "$clone" >"$tmp/ownership.env"
chmod 0600 "$tmp/ownership.env"
unset app_pw

docker run -d --name "$holder" --network "$network" --user 65532:65532 \
  -v "$db_base/pki/ca.crt:/run/pilot/db-ca.crt:ro" \
  -v "$repo/ops/local/harness:/harness:ro" \
  --env-file "$tmp/ownership.env" -e MODE=hold -e HOLD_MS=4000 \
  --entrypoint /nodejs/bin/node "$image" /harness/ownership.mjs >/dev/null

for _ in $(seq 1 100); do
  docker logs "$holder" 2>&1 | grep -q '"active":true' && break
  sleep 0.1
done
docker logs "$holder" >"$tmp/holder.log" 2>&1
grep -q '"acquired":true' "$tmp/holder.log" || { cat "$tmp/holder.log" >&2; fail "ownership was not acquired"; }
grep -q '"admitted":true' "$tmp/holder.log" || fail "the ownership handle was not admitted"
grep -q '"active":true' "$tmp/holder.log" || fail "the ownership handle did not activate"

status=0
docker run --rm --network "$network" --user 65532:65532 \
  -v "$db_base/pki/ca.crt:/run/pilot/db-ca.crt:ro" \
  -v "$repo/ops/local/harness:/harness:ro" \
  --env-file "$tmp/ownership.env" -e MODE=once \
  --entrypoint /nodejs/bin/node "$image" /harness/ownership.mjs >"$tmp/second.log" 2>&1 || status=$?
[ "$status" -eq 3 ] || { cat "$tmp/second.log" >&2; fail "a second owner was not refused (status $status)"; }
grep -q '"acquired":false' "$tmp/second.log" || fail "the second owner was admitted"
say "PASS  a second connector owner is refused while the first is active"

docker wait "$holder" >/dev/null
docker logs "$holder" >"$tmp/holder.log" 2>&1
grep -q '"closed":true' "$tmp/holder.log" || { cat "$tmp/holder.log" >&2; fail "the owner did not close"; }
grep -q '"phase":"uncertain"' "$tmp/holder.log" || fail "shutdown did not quarantine ownership"
grep -q '"reconciliation_required":true' "$tmp/holder.log" || fail "shutdown did not require reconciliation"
docker rm "$holder" >/dev/null
say "PASS  ownership activates and shutdown quarantines it on the clone"

real_state=$(printf "SELECT o.phase || '|' || p.reconciliation_required FROM connector_ownership o JOIN provider_state p USING (account_id);\n" | owner_sql)
[ "$real_state" = "idle|false" ] || fail "the live pilot ownership state changed: $real_state"
say "PASS  the live pilot ownership state is untouched (idle, no reconciliation)"

# ------------------------------------------------ 4. deployed network
say "re-running the deployed network assertions"
bash ops/local/verify-deployed-pilot.sh >"$tmp/network.log"
grep -q 'all 48 deployed-network assertions PASS' "$tmp/network.log" || { tail -20 "$tmp/network.log" >&2; fail "the deployed network assertions failed"; }
say "PASS  $(grep 'all 48' "$tmp/network.log")"

# --------------------------------------------- 5. enrollment grant scope
say "re-running the enrollment readiness assertions"
bash ops/local/verify-enrollment-readiness.sh >"$tmp/enroll.log"
grep -q 'all enrollment-readiness assertions PASS' "$tmp/enroll.log" || { tail -20 "$tmp/enroll.log" >&2; fail "the enrollment readiness assertions failed"; }
say "PASS  $(grep 'all enrollment-readiness' "$tmp/enroll.log")"

# ------------------------------------------------ 6. encrypted session store
say "writing and reading a synthetic encrypted session record"
docker run --rm --network none --read-only --tmpfs /tmp:rw,nosuid,size=8m \
  --user 65532:65532 --cap-drop ALL --security-opt no-new-privileges:true \
  --entrypoint /nodejs/bin/node -v "$repo/ops/local/harness:/harness:ro" \
  -e FIXTURE_ROOT=/tmp/sessionfixture \
  "$image" /harness/session-fixture.mjs >"$tmp/session.json" 2>"$tmp/session.err" ||
  { cat "$tmp/session.err" >&2; fail "the session fixture failed"; }
python3 - "$tmp/session.json" <<'PY'
import json, sys
r = json.load(open(sys.argv[1], encoding="utf-8"))
assert r["roundTrip"] is True, "round trip"
assert r["file"]["mode"] == "600" and r["file"]["uid"] == 65532 and r["file"]["isFile"], r["file"]
assert r["entries"] == ["session.enc"], r["entries"]
assert r["wrongKeyRefused"] is True, "wrong key"
assert r["wrongKeyIdRefused"] is True, "wrong key id"
assert r["truncatedRefused"] is True, "truncated ciphertext"
assert r["quarantined"] is True and r["readAfterQuarantineRefused"] is True, "quarantine"
assert r["cleaned"] is True, "cleanup"
print("pilot-dryrun: PASS  session store round-trips, refuses wrong key/key-id/truncation and quarantines")
PY

# ------------------------------------------------ 7. compose dry-run
say "running the deployed compose dry-run"
out=$(docker compose --env-file "$interp" -f "$compose_priv" run --rm --no-TTY pilot-connector 2>&1) ||
  { printf '%s\n' "$out" >&2; fail "the compose dry-run failed"; }
grep -q '"command":"dry-run"' <<<"$out" || { printf '%s\n' "$out" >&2; fail "the dry-run did not report its command"; }
grep -q '"gate":"admitted"' <<<"$out" || { printf '%s\n' "$out" >&2; fail "the dry-run was not admitted"; }
say "PASS  the deployed compose dry-run is admitted"

# ------------------------------------------------ 8. shutdown and residue
docker run -d --name "$shutdown" --network "$network" --user 65532:65532 \
  --read-only --tmpfs /tmp:rw,nosuid,size=8m --cap-drop ALL \
  --security-opt no-new-privileges:true --entrypoint /nodejs/bin/node \
  "$image" -e 'setInterval(()=>{},1000)' >/dev/null
sleep 1
docker stop -t 5 "$shutdown" >/dev/null
state=$(docker inspect -f '{{.State.Status}}' "$shutdown")
code=$(docker inspect -f '{{.State.ExitCode}}' "$shutdown")
[ "$state" = "exited" ] || fail "the synthetic connector process did not stop: $state"
case "$code" in 0|137|143) : ;; *) fail "unexpected stop exit code $code" ;; esac
docker rm "$shutdown" >/dev/null
say "PASS  the synthetic connector process stops on SIGTERM (exit $code)"

residual=$(docker ps -a --format '{{.Names}}' | grep -E '^(g5-|zalo-shared-pilot-pilot-connector)' || true)
[ -z "$residual" ] || fail "residual connector containers: $residual"
[ -z "$(docker ps --filter "name=$holder" -q)" ] || fail "the ownership holder is still running"
say "PASS  no residual connector container remains"

# ------------------------------------------------- 9. external traffic
after_gateway_lines=$(docker logs "$gateway" 2>&1 | wc -l)
docker logs "$gateway" >"$tmp/gateway.log" 2>&1
python3 - "$tmp/gateway.log" "$before_gateway_lines" "$after_gateway_lines" <<'PY'
import json, sys
path, before, after = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
lines = open(path, encoding="utf-8").read().splitlines()[before:after]
events = [json.loads(line) for line in lines if line.strip().startswith("{")]
allows = [e for e in events if e.get("event") == "sni_allow"]
assert not allows, json.dumps(allows)
print(f"pilot-dryrun: PASS  the gateway admitted no tunnel during the dry run ({len(events)} audit events)")
PY

say "all D4 deployed dry-run assertions PASS"
