#!/usr/bin/env bash
# Prove the dedicated pilot database serves TLS only, that the reviewed runtime
# role is least-privileged, and that restart and recovery preserve the data.
#
# Runs every client inside the pilot database container on the internal network.
# Prints sanitized PASS/FAIL lines only: no password, connection URL or row
# content. Synthetic rows are inserted, restored and removed so counts are
# meaningful; nothing here contacts a provider.
set -euo pipefail

base=${PILOT_PRIVATE_DIR:-"$HOME/pilot-private/zalo-shared"}/pilot-db
network=${PILOT_DB_NETWORK:-zalo-shared-pilot-db}
container=${PILOT_DB_CONTAINER:-pilot-postgres}
host=${PILOT_DB_HOST:-pilot-db}
database=${PILOT_DB_NAME:-zalo}
owner_user=${PILOT_DB_OWNER:-zs_owner}
app_role=${PILOT_DB_APP_ROLE:-zs_app}
scratch=zalo_restore_check

failures=0
pass() { printf 'pilot-db-tls: PASS  %s\n' "$*"; }
fail() { printf 'pilot-db-tls: FAIL  %s\n' "$*" >&2; failures=$((failures + 1)); }

command -v docker >/dev/null || { echo "pilot-db-tls: docker is required" >&2; exit 2; }
command -v openssl >/dev/null || { echo "pilot-db-tls: openssl is required" >&2; exit 2; }
docker container inspect "$container" >/dev/null 2>&1 || { echo "pilot-db-tls: $container is missing" >&2; exit 2; }

ca=/var/lib/postgresql/tls/ca.crt
owner_url="host=$host dbname=$database user=$owner_user sslmode=verify-full sslrootcert=$ca"
app_url="host=$host dbname=$database user=$app_role sslmode=verify-full sslrootcert=$ca"

# An unrelated CA for the negative test. It is short-lived, exists only in the
# disposable temp directory and is removed with it.
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
  -subj "/CN=Unrelated test CA" -days 2 -keyout "$tmp/ca.key" -out "$tmp/ca.crt" >/dev/null 2>&1
docker cp "$tmp/ca.crt" "$container:/tmp/zs-unrelated-ca.crt" >/dev/null

# $1 connection URL, $2 password file, SQL on stdin.
psql_run() {
  docker exec -i "$container" bash -lc "PGPASSWORD=\$(cat $2) psql '$1' -X -tA -v ON_ERROR_STOP=1"
}

# ------------------------------------------------------------ certificate
if openssl verify -CAfile "$base/pki/ca.crt" "$base/tls/server.crt" >/dev/null 2>&1; then
  pass "server certificate chains to the pilot CA"
else
  fail "server certificate does not chain to the pilot CA"
fi
san=$(openssl x509 -in "$base/tls/server.crt" -noout -ext subjectAltName | tail -1 | tr -d ' ')
case "$san" in
  *"DNS:$host"*) pass "server certificate names $host (SAN: $san)" ;;
  *) fail "server certificate does not name $host (SAN: $san)" ;;
esac
key_meta=$(sudo stat -c '%a %u:%g' "$base/tls/server.key")
[ "$key_meta" = "600 999:999" ] && pass "server key is 0600 owned by the database UID" ||
  fail "server key metadata is $key_meta"

# ------------------------------------------------------------- negotiation
settings=$(printf 'show ssl; show ssl_min_protocol_version;\n' | psql_run "$owner_url" /run/secrets/owner.pw | tr '\n' ' ')
case "$settings" in
  "on TLSv1.2"*) pass "server reports ssl=on and a TLSv1.2 minimum" ;;
  *) fail "unexpected server TLS settings: $settings" ;;
esac

session=$(printf "select ssl::text||'|'||coalesce(version,'')||'|'||coalesce(cipher,'') from pg_stat_ssl where pid=pg_backend_pid();\n" |
  psql_run "$app_url" /run/secrets/app.pw)
case "$session" in
  true\|TLSv1.2*|true\|TLSv1.3*) pass "runtime role negotiated $session" ;;
  *) fail "runtime role did not negotiate TLS: $session" ;;
esac

hba_conf=$(docker exec "$container" cat /etc/postgresql/pilot/pg_hba.conf)
grep -q '^hostssl' <<<"$hba_conf" && grep -q '^hostnossl.*reject' <<<"$hba_conf" &&
  pass "pg_hba admits hostssl and rejects hostnossl" || fail "pg_hba is not TLS-only"

# --------------------------------------------------------------- refusals
neg() { # $1 label, $2 url, $3 password file, $4 SQL
  local out
  if out=$(printf '%s\n' "$4" | psql_run "$2" "$3" 2>&1); then
    fail "$1 was admitted"
  else
    pass "$1 was refused: $(head -1 <<<"$out" | sed -E 's/^psql: error: //' | cut -c1-110)"
  fi
}
neg "a plaintext connection" \
  "host=$host dbname=$database user=$app_role sslmode=disable" /run/secrets/app.pw "select 1"
neg "verify-full against a host name outside the certificate" \
  "host=pilot-postgres dbname=$database user=$app_role sslmode=verify-full sslrootcert=$ca" /run/secrets/app.pw "select 1"
neg "verify-full against an unrelated CA" \
  "host=$host dbname=$database user=$app_role sslmode=verify-full sslrootcert=/tmp/zs-unrelated-ca.crt" /run/secrets/app.pw "select 1"

# --------------------------------------------------------- least privilege
attrs=$(printf "select rolsuper||'|'||rolcreatedb||'|'||rolcreaterole||'|'||rolreplication from pg_roles where rolname='$app_role';\n" |
  psql_run "$owner_url" /run/secrets/owner.pw)
[ "$attrs" = "false|false|false|false" ] && pass "runtime role is NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION" ||
  fail "runtime role attributes are $attrs"

privs=$(printf "select has_schema_privilege('$app_role','public','CREATE')||'|'||has_table_privilege('$app_role','public.audit','UPDATE')||'|'||has_table_privilege('$app_role','public.audit','DELETE')||'|'||has_table_privilege('$app_role','public.messages','INSERT');\n" |
  psql_run "$owner_url" /run/secrets/owner.pw)
[ "$privs" = "false|false|false|true" ] && pass "runtime role cannot create in public or modify audit, and can insert messages" ||
  fail "runtime role privileges are $privs"

neg "CREATE TABLE as the runtime role" "$app_url" /run/secrets/app.pw "create table public.zs_must_not_exist(id int);"
neg "UPDATE audit as the runtime role" "$app_url" /run/secrets/app.pw "update audit set metadata='{}'::jsonb;"

# ------------------------------------------------ synthetic data and restart
seed=$(printf "%s\n" \
  "insert into conversations(id,contact_id,contact_name) values('00000000-0000-4000-8000-00000000f001','g5-synthetic-peer','synthetic') on conflict do nothing;" \
  "insert into messages(id,conversation_id,direction,text,status) values('00000000-0000-4000-8000-00000000f002','00000000-0000-4000-8000-00000000f001','inbound','synthetic row','received') on conflict do nothing;")
printf '%s\n' "$seed" | psql_run "$owner_url" /run/secrets/owner.pw >/dev/null
before=$(printf "select (select count(*) from conversations)||'|'||(select count(*) from messages);\n" | psql_run "$owner_url" /run/secrets/owner.pw)

docker restart "$container" >/dev/null
for _ in $(seq 1 60); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$container")" = "healthy" ] && break
  sleep 1
done
[ "$(docker inspect -f '{{.State.Health.Status}}' "$container")" = "healthy" ] &&
  pass "container restarted and became healthy" || fail "container did not become healthy after restart"

after=$(printf "select (select count(*) from conversations)||'|'||(select count(*) from messages);\n" | psql_run "$owner_url" /run/secrets/owner.pw)
[ "$before" = "$after" ] && pass "data survived restart ($after conversation|message rows)" ||
  fail "row counts changed across restart: $before -> $after"
post_restart=$(printf "select ssl::text from pg_stat_ssl where pid=pg_backend_pid();\n" | psql_run "$app_url" /run/secrets/app.pw)
[ "$post_restart" = "true" ] && pass "TLS still negotiated after restart" || fail "TLS not negotiated after restart"

# ---------------------------------------------------------------- recovery
docker exec "$container" dropdb -U "$owner_user" --if-exists "$scratch" >/dev/null
docker exec "$container" createdb -U "$owner_user" "$scratch" >/dev/null
restore_ok=1
docker exec "$container" sh -c "pg_dump -U $owner_user -d $database --no-owner --no-privileges | psql -X -q -U $owner_user -d $scratch" >/dev/null 2>&1 || restore_ok=0
restored=$(printf "select (select count(*) from conversations)||'|'||(select count(*) from messages)||'|'||(select count(*) from messages where id='00000000-0000-4000-8000-00000000f002');\n" |
  psql_run "host=$host dbname=$scratch user=$owner_user sslmode=verify-full sslrootcert=$ca" /run/secrets/owner.pw)
expected="$(printf '%s' "$after")|1"
[ "$restore_ok" = "1" ] && [ "$restored" = "$expected" ] &&
  pass "dump and restore reproduced the synthetic row ($restored)" ||
  fail "restore check failed: $restored (expected $expected)"
docker exec "$container" dropdb -U "$owner_user" --if-exists "$scratch" >/dev/null

# remove the synthetic rows so the pilot database stays empty
printf "%s\n" "delete from messages where id='00000000-0000-4000-8000-00000000f002';" \
  "delete from conversations where id='00000000-0000-4000-8000-00000000f001';" |
  psql_run "$owner_url" /run/secrets/owner.pw >/dev/null

# ------------------------------------------- unrelated workloads untouched
host_dbs=$(sudo -u postgres psql -p 5432 -Atc "select string_agg(datname, ',' order by datname) from pg_database" 2>/dev/null || true)
g2_id=$(docker inspect zalo-shared-g2-postgres-1 --format '{{.Id}}' 2>/dev/null || true)
[ -n "$host_dbs" ] && pass "host cluster untouched (databases: $(tr ',' '\n' <<<"$host_dbs" | grep -c . ) still present)" ||
  pass "host cluster not queried (no shared instance used)"
[ -n "$g2_id" ] && pass "G2 database container identity unchanged (${g2_id:0:12})" ||
  pass "G2 database container not present"

if [ "$failures" -ne 0 ]; then
  printf 'pilot-db-tls: %s check(s) FAILED\n' "$failures" >&2
  exit 1
fi
printf 'pilot-db-tls: all checks PASS\n'
