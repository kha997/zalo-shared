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
trap 'rm -f "$envfile"' EXIT
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

# The migration grants DML on every table, but the connector never deletes
# ownership, provider state, budget or ledger rows and never updates the ledger.
# Remove those paths so a compromised runtime credential cannot erase its
# ownership row or reset the send budget, and make the budget row append-only.
hardening=$(cat <<SQL
REVOKE DELETE, TRUNCATE ON connector_ownership, provider_state, pilot_send_budget, pilot_part_ledger FROM "$app_role";
REVOKE UPDATE ON pilot_part_ledger FROM "$app_role";
CREATE OR REPLACE FUNCTION pilot_budget_monotonic() RETURNS trigger LANGUAGE plpgsql AS \$\$
BEGIN
  IF NEW.day <> OLD.day OR NEW.reserved_parts < OLD.reserved_parts OR NEW.max_parts > OLD.max_parts THEN
    RAISE EXCEPTION 'pilot_send_budget row cannot be rolled back';
  END IF;
  RETURN NEW;
END \$\$;
DROP TRIGGER IF EXISTS pilot_budget_monotonic ON pilot_send_budget;
CREATE TRIGGER pilot_budget_monotonic BEFORE UPDATE ON pilot_send_budget FOR EACH ROW EXECUTE FUNCTION pilot_budget_monotonic();
SQL
)
printf '%s\n' "$hardening" | docker exec -i "$container" bash -lc \
  "PGPASSWORD=\$(cat /run/secrets/owner.pw) psql 'host=$host dbname=$database user=$owner_user sslmode=verify-full sslrootcert=/var/lib/postgresql/tls/ca.crt' -X -q -v ON_ERROR_STOP=1"

hardened=$(docker exec "$container" bash -lc \
  "PGPASSWORD=\$(cat /run/secrets/owner.pw) psql 'host=$host dbname=$database user=$owner_user sslmode=verify-full sslrootcert=/var/lib/postgresql/tls/ca.crt' -X -tAc \"SELECT NOT has_table_privilege('$app_role','public.connector_ownership','DELETE') AND NOT has_table_privilege('$app_role','public.provider_state','DELETE') AND NOT has_table_privilege('$app_role','public.pilot_send_budget','DELETE') AND NOT has_table_privilege('$app_role','public.pilot_part_ledger','DELETE') AND NOT has_table_privilege('$app_role','public.pilot_part_ledger','UPDATE') AND (SELECT count(*) FROM pg_trigger WHERE tgname='pilot_budget_monotonic')=1\"")
[ "$hardened" = "t" ] || fail "runtime role can still roll back ownership, budget or ledger rows"
say "runtime role $app_role: cannot delete ownership/budget rows or roll back the budget"
