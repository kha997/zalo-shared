#!/usr/bin/env bash
# Prove the reviewed connector image can reach the dedicated pilot database
# through its own requireTlsDatabaseUrl gate, over TLS, while attached only to
# the internal pilot database network. Also reproduce the previous blocker: a
# non-loopback URL without sslmode is refused by the same gate.
set -euo pipefail

repo=$(cd "$(dirname "$0")/../.." && pwd)
base=${PILOT_PRIVATE_DIR:-"$HOME/pilot-private/zalo-shared"}/pilot-db
network=${PILOT_DB_NETWORK:-zalo-shared-pilot-db}
container=${PILOT_DB_CONTAINER:-pilot-postgres}
host=${PILOT_DB_HOST:-pilot-db}
database=${PILOT_DB_NAME:-zalo}
app_role=${PILOT_DB_APP_ROLE:-zs_app}
image=${PILOT_CONNECTOR_IMAGE:-zalo-shared-connector:g5-local}

say() { printf 'connector-db: %s\n' "$*"; }
fail() { printf 'connector-db: FAIL %s\n' "$*" >&2; exit 1; }

docker image inspect "$image" >/dev/null 2>&1 || fail "$image not found"
docker container inspect "$container" >/dev/null 2>&1 || fail "$container is missing"
[ "$(docker network inspect "$network" --format '{{.Internal}}')" = "true" ] || fail "$network is not internal"

app_pw=$(sudo cat "$base/secrets/app.pw")
[[ $app_pw =~ ^[A-Za-z0-9_-]{40,64}$ ]] || fail "runtime password is not URL-safe"

umask 077
envfile=$base/secrets/connector-check.env
plain_env=$base/secrets/connector-check-plain.env
trap 'rm -f "$envfile" "$plain_env"' EXIT
printf 'DATABASE_URL=postgresql://%s:%s@%s:5432/%s?sslmode=verify-full\n' \
  "$app_role" "$app_pw" "$host" "$database" >"$envfile"
printf 'NODE_EXTRA_CA_CERTS=/run/pilot/db-ca.crt\n' >>"$envfile"
chmod 0600 "$envfile"
unset app_pw

run() { # extra env file, expect-denied flag
  docker run --rm --network "$network" \
    -v "$base/pki/ca.crt:/run/pilot/db-ca.crt:ro" \
    -v "$repo/ops/local/harness/db-connect.mjs:/harness/db-connect.mjs:ro" \
    --env-file "$1" -e EXPECT_GATE_DENIED="${2:-0}" \
    --entrypoint /nodejs/bin/node "$image" /harness/db-connect.mjs
}

admitted=$(run "$envfile" 0)
grep -q '"gate":"admitted"' <<<"$admitted" || fail "the gate refused a verify-full URL: $admitted"
grep -q '"ssl":"true"' <<<"$admitted" || fail "the connection did not negotiate TLS: $admitted"
say "gate admitted the verify-full URL; $(sed -E 's/.*"role":"([^"]+)".*"version":"([^"]+)".*"cipher":"([^"]+)".*/role=\1 version=\2 cipher=\3/' <<<"$admitted")"

# Previous blocker: same host, same credential, no sslmode. The gate must refuse
# before any socket is opened.
printf 'DATABASE_URL=postgresql://%s@%s:5432/%s\n' "$app_role" "$host" "$database" >"$plain_env"
printf 'NODE_EXTRA_CA_CERTS=/run/pilot/db-ca.crt\n' >>"$plain_env"
chmod 0600 "$plain_env"
denied=$(run "$plain_env" 1)
grep -q '"gate":"denied"' <<<"$denied" || fail "a URL without sslmode was not refused: $denied"
say "gate refused a non-loopback URL without sslmode (previous blocker reproduced)"

say "all checks PASS"
