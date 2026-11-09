#!/usr/bin/env bash
# Deploy the patched application onto the dedicated pilot database.
#
# Copies the reviewed example compose file to a private path, renders it with a
# private interpolation and env file, and starts the app service. PostgreSQL
# stays internal and unpublished; the only published surface is the reviewed
# 127.0.0.1:3100 origin. The provider stays disabled and no connector, grant or
# provider contact is involved.
#
# Prints no secret. Idempotent.
set -euo pipefail

repo=$(cd "$(dirname "$0")/../.." && pwd)
base=${PILOT_PRIVATE_DIR:-"$HOME/pilot-private/zalo-shared"}
db_base=$base/pilot-db
app_base=$base/pilot-app
network_db=${PILOT_DB_NETWORK:-zalo-shared-pilot-db}
image=${PILOT_APP_IMAGE:-zalo-shared:g5-patched-af2be54}
# The reviewed artifact, not whichever image the tag happens to point at now.
digest=${PILOT_APP_DIGEST:-sha256:989c61541cc95931bef1bd223934032f6d42b5937ff78de62b5e451dc0fbe824}
name=${PILOT_APP_CONTAINER:-zalo-shared-pilot-app-1}
host=${PILOT_DB_HOST:-pilot-db}
database=${PILOT_DB_NAME:-zalo}
app_role=${PILOT_DB_APP_ROLE:-zs_app}
port=${PILOT_APP_PORT:-3100}

say() { printf 'pilot-app: %s\n' "$*"; }
fail() { printf 'pilot-app: FAIL %s\n' "$*" >&2; exit 1; }

docker image inspect "$image" >/dev/null 2>&1 || fail "$image not found"
resolved=$(docker image inspect "$image" --format '{{.Id}}')
[ "$resolved" = "$digest" ] || fail "$image resolves to $resolved, not the reviewed $digest"
say "image $image $resolved"
docker container inspect pilot-postgres >/dev/null 2>&1 || fail "run provision-pilot-db.sh first"
[ "$(docker inspect -f '{{.State.Health.Status}}' pilot-postgres)" = "healthy" ] ||
  fail "pilot-postgres is not healthy"
[ "$(docker network inspect "$network_db" --format '{{.Internal}}')" = "true" ] ||
  fail "$network_db is not internal"
[ -f "$db_base/pki/ca.crt" ] || fail "pilot database CA is missing"
[ "$(docker image inspect "$image" --format '{{.Config.User}}')" = "65532:65532" ] ||
  fail "$image does not run as uid 65532"

# The reviewed local origin is a single loopback port. Refuse to bind it when
# another container already answers there; isolate the previous stack first.
if docker container inspect "$name" >/dev/null 2>&1; then
  [ "$(docker inspect -f '{{.Image}}' "$name")" = "$digest" ] ||
    fail "existing $name runs $(docker inspect -f '{{.Image}}' "$name"), not $digest"
elif ss -Hltn "sport = :$port" | grep -q .; then
  fail "127.0.0.1:$port is already in use; isolate the previous stack first"
fi

umask 077
install -d -m 0700 "$app_base"
app_pw=$(sudo cat "$db_base/secrets/app.pw")
[[ $app_pw =~ ^[A-Za-z0-9_-]{40,64}$ ]] || fail "runtime password is not URL-safe"

token_file=$app_base/metrics.token
if [ -s "$token_file" ]; then
  metrics=$(cat "$token_file")
else
  metrics=$(head -c 32 /dev/urandom | base64 | tr -d '+/=' | cut -c1-43)
  printf '%s\n' "$metrics" >"$token_file"
  chmod 0600 "$token_file"
fi
[[ $metrics =~ ^[A-Za-z0-9_-]{32,64}$ ]] || fail "metrics token is malformed"

env_file=$app_base/app.env
{
  printf 'NODE_ENV=production\n'
  printf 'HOST=0.0.0.0\n'
  printf 'PORT=3100\n'
  printf 'PUBLIC_ORIGIN=http://127.0.0.1:%s\n' "$port"
  printf 'DATABASE_URL=postgresql://%s:%s@%s:5432/%s?sslmode=verify-full\n' \
    "$app_role" "$app_pw" "$host" "$database"
  printf 'APP_DATABASE_ROLE=%s\n' "$app_role"
  printf 'METRICS_TOKEN=%s\n' "$metrics"
  printf 'PROVIDER_MODE=disabled\n'
  printf 'MOCK_ENABLED=false\n'
} >"$env_file.new"
chmod 0600 "$env_file.new"
mv -f "$env_file.new" "$env_file"
unset app_pw metrics

priv=$app_base/topology
install -d -m 0700 "$priv"
install -m 0600 "$repo/ops/pilot-app-compose.example.yml" "$priv/pilot-app-compose.yml"

interp=$priv/pilot-app-interpolation.env
{
  printf 'PILOT_APP_IMAGE=%s\n' "$image"
  printf 'PILOT_APP_CONTAINER=%s\n' "$name"
  printf 'PILOT_APP_ENV_FILE=%s\n' "$env_file"
  printf 'PILOT_DB_CA_FILE=%s\n' "$db_base/pki/ca.crt"
  printf 'PILOT_DB_NETWORK=%s\n' "$network_db"
} >"$interp"
chmod 0600 "$interp"

docker compose --env-file "$interp" -f "$priv/pilot-app-compose.yml" up -d app >/dev/null

for _ in $(seq 1 60); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$name" 2>/dev/null)" = "healthy" ] && break
  sleep 1
done
[ "$(docker inspect -f '{{.State.Health.Status}}' "$name")" = "healthy" ] || {
  docker logs "$name" >&2 || true
  fail "$name did not become healthy"
}

say "healthy: $name"
say "image $image $(docker image inspect "$image" --format '{{.Id}}')"
say "networks $(docker inspect -f '{{range $k, $_ := .NetworkSettings.Networks}}{{$k}} {{end}}' "$name" | xargs)"
say "published $(docker port "$name" | xargs)"
