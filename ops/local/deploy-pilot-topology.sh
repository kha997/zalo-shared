#!/usr/bin/env bash
# Deploy the reviewed pilot topology on this host.
#
# Copies the reviewed compose file to a private path, renders it with a private
# interpolation file and starts the egress gateway. The connector is not started:
# it is created on demand with `docker compose run`, which is how every stage is
# executed. Requires the dedicated pilot database from provision-pilot-db.sh and
# the synthetic stage manifests from make-g5-synthetic-manifests.sh.
#
# Prints no secret. Idempotent.
set -euo pipefail

repo=$(cd "$(dirname "$0")/../.." && pwd)
base=${PILOT_PRIVATE_DIR:-"$HOME/pilot-private/zalo-shared"}
db_base=$base/pilot-db
network_db=${PILOT_DB_NETWORK:-zalo-shared-pilot-db}
connector_image=${PILOT_CONNECTOR_IMAGE:-zalo-shared-connector:g5-local}
gateway_image=${PILOT_EGRESS_GATEWAY_IMAGE:-zalo-shared-egress-gateway:g5-local}
host=${PILOT_DB_HOST:-pilot-db}
database=${PILOT_DB_NAME:-zalo}
app_role=${PILOT_DB_APP_ROLE:-zs_app}

say() { printf 'pilot-topology: %s\n' "$*"; }
fail() { printf 'pilot-topology: FAIL %s\n' "$*" >&2; exit 1; }

docker image inspect "$connector_image" >/dev/null 2>&1 || fail "$connector_image not found"
docker image inspect "$gateway_image" >/dev/null 2>&1 || fail "$gateway_image not found"
docker container inspect pilot-postgres >/dev/null 2>&1 || fail "run provision-pilot-db.sh first"
[ -f "$db_base/pki/ca.crt" ] || fail "pilot database CA is missing"
sudo test -f "$base/g5-synthetic/manifest.bootstrap.json" || fail "run make-g5-synthetic-manifests.sh first"
sudo test -f "$base/pilot/session.key" || fail "the private session key is missing"
sudo test -d "$base/pilot/state" || fail "the private state directory is missing"
[ "$(docker network inspect "$network_db" --format '{{.Internal}}')" = "true" ] || fail "$network_db is not internal"

umask 077
# The connector env file carries the TLS URL and nothing else. The allowlist and
# the CA path are repeated in the reviewed compose file so they are visible in
# configuration review.
app_pw=$(sudo cat "$db_base/secrets/app.pw")
[[ $app_pw =~ ^[A-Za-z0-9_-]{40,64}$ ]] || fail "runtime password is not URL-safe"
connector_env=$db_base/secrets/pilot-connector.env
printf 'DATABASE_URL=postgresql://%s:%s@%s:5432/%s?sslmode=verify-full\n' \
  "$app_role" "$app_pw" "$host" "$database" >"$connector_env"
chmod 0600 "$connector_env"
unset app_pw

priv=$base/topology
install -d -m 0700 "$priv"
install -m 0600 "$repo/ops/pilot-compose.example.yml" "$priv/pilot-compose.yml"

interp=$priv/pilot-interpolation.env
{
  printf 'PILOT_CONNECTOR_IMAGE=%s\n' "$connector_image"
  printf 'PILOT_EGRESS_GATEWAY_IMAGE=%s\n' "$gateway_image"
  printf 'PILOT_ENV_FILE=%s\n' "$connector_env"
  printf 'PILOT_MANIFEST_FILE=%s\n' "$base/g5-synthetic/manifest.bootstrap.json"
  printf 'PILOT_KEY_FILE=%s\n' "$base/pilot/session.key"
  printf 'PILOT_STATE_DIR=%s\n' "$base/pilot/state"
  printf 'PILOT_DB_NETWORK=%s\n' "$network_db"
  printf 'PILOT_DB_CA_FILE=%s\n' "$db_base/pki/ca.crt"
} >"$interp"
chmod 0600 "$interp"
say "wrote the private compose copy and interpolation file"

docker compose --env-file "$interp" -f "$priv/pilot-compose.yml" up -d egress-gateway >/dev/null
gateway=zalo-shared-pilot-egress-gateway-1
for _ in $(seq 1 60); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$gateway" 2>/dev/null)" = "healthy" ] && break
  sleep 1
done
[ "$(docker inspect -f '{{.State.Health.Status}}' "$gateway")" = "healthy" ] || {
  docker logs "$gateway" >&2 || true
  fail "$gateway did not become healthy"
}

egress=zalo-shared-pilot_pilot-egress
uplink=zalo-shared-pilot_pilot-uplink
[ "$(docker network inspect "$egress" --format '{{.Internal}}')" = "true" ] || fail "$egress is not internal"
[ "$(docker network inspect "$uplink" --format '{{.Internal}}')" = "false" ] || fail "$uplink is internal"
members=$(docker network inspect "$uplink" --format '{{range .Containers}}{{.Name}} {{end}}' | xargs)
[ "$members" = "$gateway" ] || fail "uplink members are '$members', expected only $gateway"
[ -z "$(docker port "$gateway")" ] || fail "$gateway publishes a port"
[ "$(docker exec "$gateway" /nodejs/bin/node -e 'process.stdout.write(require("node:fs").readFileSync("/proc/sys/net/ipv4/ip_forward","utf8").trim())')" = "0" ] ||
  fail "$gateway forwards packets"

say "gateway healthy on $egress ($(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' "$gateway" | xargs))"
say "uplink $uplink has exactly one member: $members"
say "next: run ops/local/verify-pilot-network.sh and ops/local/verify-deployed-pilot.sh"
