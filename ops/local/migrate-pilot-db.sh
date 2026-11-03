#!/usr/bin/env bash
# Apply the reviewed schema to the dedicated pilot database over TLS.
#
# Runs the application image on the internal pilot database network, with the
# pilot CA as the only extra trust anchor. The owner URL is passed through a
# private env file so no password appears in argv or in the host environment.
set -euo pipefail

base=${PILOT_PRIVATE_DIR:-"$HOME/pilot-private/zalo-shared"}/pilot-db
network=${PILOT_DB_NETWORK:-zalo-shared-pilot-db}
container=${PILOT_DB_CONTAINER:-pilot-postgres}
host=${PILOT_DB_HOST:-pilot-db}
database=${PILOT_DB_NAME:-zalo}
owner_user=${PILOT_DB_OWNER:-zs_owner}
app_role=${PILOT_DB_APP_ROLE:-zs_app}
image=${PILOT_APP_IMAGE:-zalo-shared:g2-adf8ceca9bd6}

say() { printf 'pilot-db-migrate: %s\n' "$*"; }
fail() { printf 'pilot-db-migrate: FAIL %s\n' "$*" >&2; exit 1; }

docker container inspect "$container" >/dev/null 2>&1 || fail "$container does not exist"
docker image inspect "$image" >/dev/null 2>&1 || fail "$image not found"

owner_pw=$(sudo cat "$base/secrets/owner.pw")
[[ $owner_pw =~ ^[A-Za-z0-9_-]{40,64}$ ]] || fail "owner password is not URL-safe"

umask 077
envfile=$base/secrets/migrate.env
printf 'MIGRATION_DATABASE_URL=postgresql://%s:%s@%s:5432/%s?sslmode=verify-full\n' \
  "$owner_user" "$owner_pw" "$host" "$database" >"$envfile"
printf 'APP_DATABASE_ROLE=%s\n' "$app_role" >>"$envfile"
printf 'NODE_EXTRA_CA_CERTS=/run/pilot/db-ca.crt\n' >>"$envfile"
chmod 0600 "$envfile"
unset owner_pw

docker run --rm --network "$network" \
  -v "$base/pki/ca.crt:/run/pilot/db-ca.crt:ro" \
  --env-file "$envfile" \
  "$image" dist/server/migrate.js
say "applied migrations to $database over verify-full"

tables=$(docker exec "$container" bash -lc \
  "PGPASSWORD=\$(cat /run/secrets/owner.pw) psql 'host=$host dbname=$database user=$owner_user sslmode=verify-full sslrootcert=/var/lib/postgresql/tls/ca.crt' -X -tAc \"SELECT count(*) FROM information_schema.tables WHERE table_schema='public'\"")
[ "$tables" -ge 10 ] || fail "only $tables tables present after migration"
say "public schema has $tables tables"

grants=$(docker exec "$container" bash -lc \
  "PGPASSWORD=\$(cat /run/secrets/owner.pw) psql 'host=$host dbname=$database user=$owner_user sslmode=verify-full sslrootcert=/var/lib/postgresql/tls/ca.crt' -X -tAc \"SELECT has_table_privilege('$app_role','public.messages','SELECT') AND NOT has_table_privilege('$app_role','public.audit','UPDATE') AND NOT has_schema_privilege('$app_role','public','CREATE')\"")
[ "$grants" = "t" ] || fail "runtime role grants are not the reviewed set"
say "runtime role $app_role: can read messages, cannot update audit, cannot create in public"
