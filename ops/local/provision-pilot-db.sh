#!/usr/bin/env bash
# Provision the dedicated G5 pilot PostgreSQL instance.
#
# The host cluster on this machine is shared with unrelated projects and the
# application stack's database is bound to the running G2 app, so the pilot gets
# its own instance instead of a TLS change to either of them. Nothing here
# touches the host cluster, the G2 stack or any network other than the one named
# below.
#
# Creates, under $PILOT_PRIVATE_DIR/pilot-db:
#   * a private CA and a server certificate for the internal host name,
#   * a pg_hba.conf that admits only hostssl from the pilot subnet,
#   * an initdb-time script that creates the least-privilege runtime role,
#   * owner and runtime passwords, 0400, never printed.
#
# Creates in Docker:
#   * an internal=true network (no NAT, no default route, no external resolver),
#   * the PostgreSQL container with no published port and a health check.
#
# Idempotent: existing PKI, secrets, network and container are reused and
# re-checked. Migrations are applied separately. Prints no secret material.
set -euo pipefail

base=${PILOT_PRIVATE_DIR:-"$HOME/pilot-private/zalo-shared"}/pilot-db
network=${PILOT_DB_NETWORK:-zalo-shared-pilot-db}
subnet=${PILOT_DB_SUBNET:-172.16.30.0/24}
gateway=${PILOT_DB_GATEWAY:-172.16.30.1}
container=${PILOT_DB_CONTAINER:-pilot-postgres}
volume=${PILOT_DB_VOLUME:-pilot-postgres-data}
owner_user=${PILOT_DB_OWNER:-zs_owner}
app_role=${PILOT_DB_APP_ROLE:-zs_app}
database=${PILOT_DB_NAME:-zalo}
host=${PILOT_DB_HOST:-pilot-db}
image=${PILOT_DB_IMAGE:-postgres:17-bookworm@sha256:858bb5e98eed02eb8cafbcdc007f9a65d1b613972028944a8ec2133ccaf80d27}

say() { printf 'pilot-db: %s\n' "$*"; }
fail() { printf 'pilot-db: FAIL %s\n' "$*" >&2; exit 1; }

for cmd in docker openssl sudo; do
  command -v "$cmd" >/dev/null || fail "$cmd is required"
done
[[ $app_role =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || fail "invalid runtime role name"
[[ $subnet =~ ^[0-9.]+/[0-9]+$ ]] || fail "invalid subnet"
[[ $gateway =~ ^[0-9.]+$ ]] || fail "invalid gateway"

umask 077
install -d -m 0700 "$base" "$base/pki" "$base/tls" "$base/hba" "$base/init" "$base/secrets"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# ------------------------------------------------------------------ PKI
ca_key=$base/pki/ca.key
ca_crt=$base/pki/ca.crt
srv_key=$base/tls/server.key
srv_crt=$base/tls/server.crt

if [ ! -f "$ca_key" ] || [ ! -f "$ca_crt" ]; then
  openssl ecparam -name prime256v1 -genkey -noout -out "$tmp/ca.key"
  openssl req -x509 -new -key "$tmp/ca.key" -sha256 -days 3650 \
    -subj "/CN=Zalo Shared pilot database CA" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -out "$tmp/ca.crt"
  sudo install -m 0400 -o root -g root "$tmp/ca.key" "$ca_key"
  sudo install -m 0644 -o root -g root "$tmp/ca.crt" "$ca_crt"
  say "generated the pilot database CA"
else
  say "reusing the pilot database CA"
fi

if [ ! -f "$srv_key" ] || [ ! -f "$srv_crt" ]; then
  openssl ecparam -name prime256v1 -genkey -noout -out "$tmp/server.key"
  openssl req -new -key "$tmp/server.key" -subj "/CN=$host" -out "$tmp/server.csr"
  cat >"$tmp/ext.cnf" <<EOF
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:$host,DNS:localhost,IP:127.0.0.1
EOF
  sudo openssl x509 -req -in "$tmp/server.csr" -CA "$ca_crt" -CAkey "$ca_key" \
    -CAcreateserial -days 730 -sha256 -extfile "$tmp/ext.cnf" -out "$tmp/server.crt"
  sudo install -m 0600 -o 999 -g 999 "$tmp/server.key" "$srv_key"
  sudo install -m 0644 -o 999 -g 999 "$tmp/server.crt" "$srv_crt"
  say "issued a server certificate for $host"
else
  say "reusing the server certificate"
fi

# The TLS key must stay readable only by the database UID; PostgreSQL refuses
# broader modes at startup, which is a useful independent check.
key_mode=$(sudo stat -c '%a %u:%g' "$srv_key")
[ "$key_mode" = "600 999:999" ] || fail "server key permissions are $key_mode, expected 600 999:999"
sudo test -r "$ca_crt" || fail "CA certificate is unreadable"

# -------------------------------------------------------------- secrets
gen_secret() { openssl rand -base64 48 | tr '+/' '-_' | tr -d '=\n' | cut -c1-48; }
write_secret() {
  local path=$1 owner=$2 mode=$3
  if [ ! -s "$path" ]; then
    local value
    value=$(gen_secret)
    printf '%s\n' "$value" | sudo tee "$path" >/dev/null
  fi
  sudo chown "$owner" "$path"
  sudo chmod "$mode" "$path"
}
owner_pw=$base/secrets/owner.pw
app_pw=$base/secrets/app.pw
# The entrypoint reads the owner password as root before dropping privileges.
write_secret "$owner_pw" root:root 0400
# The initdb-time script runs as the postgres user, so the runtime password is
# readable by that group and by nothing else.
write_secret "$app_pw" root:999 0440
if sudo grep -Eqv '^[A-Za-z0-9_-]{40,64}$' "$app_pw"; then
  fail "runtime password has characters that cannot be embedded safely"
fi
say "owner and runtime secrets present (0400, not printed)"

# --------------------------------------------------------------- config
hba=$base/hba/pg_hba.conf
sudo tee "$hba" >/dev/null <<EOF
# Generated by ops/local/provision-pilot-db.sh.
# The Unix socket exists only inside this container's namespace and admits its
# entrypoint and health check; every TCP connection must use TLS, and plaintext
# is rejected by the explicit hostnossl rule.
local     all  all                   trust
hostssl   all  all  $subnet          scram-sha-256
hostnossl all  all  all              reject
EOF
sudo chmod 0644 "$hba"

init=$base/init/10-runtime-role.sh
sudo tee "$init" >/dev/null <<'EOF'
#!/usr/bin/env bash
# Runs once at initdb time. Reads the password from a mounted file so it never
# appears in the environment or in process arguments.
set -euo pipefail
: "${APP_DATABASE_PASSWORD_FILE:?}" "${APP_DATABASE_ROLE:?}"
password=$(cat "$APP_DATABASE_PASSWORD_FILE")
[[ $password =~ ^[A-Za-z0-9_-]{40,64}$ ]] || { echo "invalid runtime password" >&2; exit 1; }
psql -X -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE ${APP_DATABASE_ROLE} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
SQL
EOF
sudo chmod 0755 "$init"
say "wrote the TLS-only pg_hba.conf and the runtime-role init script"

# -------------------------------------------------------------- network
if ! docker network inspect "$network" >/dev/null 2>&1; then
  docker network create --driver bridge --internal \
    --subnet "$subnet" --gateway "$gateway" "$network" >/dev/null
  say "created internal network $network ($subnet)"
else
  say "reusing network $network"
fi
[ "$(docker network inspect "$network" --format '{{.Internal}}')" = "true" ] ||
  fail "$network is not internal=true"
[ "$(docker network inspect "$network" --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}')" = "$subnet" ] ||
  fail "$network does not use the expected subnet"

# ------------------------------------------------------------ container
if docker container inspect "$container" >/dev/null 2>&1; then
  say "reusing container $container ($(docker inspect -f '{{.State.Status}}' "$container"))"
else
  docker run -d --name "$container" --hostname "$host" \
    --network "$network" --network-alias "$host" \
    --restart unless-stopped \
    --health-cmd "pg_isready -U $owner_user -d $database" \
    --health-interval 5s --health-timeout 3s --health-retries 20 \
    -e POSTGRES_DB="$database" -e POSTGRES_USER="$owner_user" \
    -e POSTGRES_PASSWORD_FILE=/run/secrets/owner.pw \
    -e APP_DATABASE_ROLE="$app_role" \
    -e APP_DATABASE_PASSWORD_FILE=/run/secrets/app.pw \
    -v "$volume:/var/lib/postgresql/data" \
    -v "$ca_crt:/var/lib/postgresql/tls/ca.crt:ro" \
    -v "$srv_crt:/var/lib/postgresql/tls/server.crt:ro" \
    -v "$srv_key:/var/lib/postgresql/tls/server.key:ro" \
    -v "$hba:/etc/postgresql/pilot/pg_hba.conf:ro" \
    -v "$init:/docker-entrypoint-initdb.d/10-runtime-role.sh:ro" \
    -v "$owner_pw:/run/secrets/owner.pw:ro" \
    -v "$app_pw:/run/secrets/app.pw:ro" \
    "$image" postgres \
    -c ssl=on \
    -c ssl_cert_file=/var/lib/postgresql/tls/server.crt \
    -c ssl_key_file=/var/lib/postgresql/tls/server.key \
    -c ssl_ca_file=/var/lib/postgresql/tls/ca.crt \
    -c ssl_min_protocol_version=TLSv1.2 \
    -c hba_file=/etc/postgresql/pilot/pg_hba.conf \
    -c listen_addresses='*' \
    -c password_encryption=scram-sha-256 >/dev/null
  say "started $container from $image"
fi

[ "$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' "$container")" = "$network" ] ||
  fail "$container is not attached only to $network"
[ -z "$(docker port "$container")" ] || fail "$container publishes a port"

for _ in $(seq 1 60); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$container")" = "healthy" ] && break
  sleep 1
done
[ "$(docker inspect -f '{{.State.Health.Status}}' "$container")" = "healthy" ] ||
  fail "$container did not become healthy"

# A reused container must still serve the audited certificates, even if Docker
# reports a translated bind source. Compare content and the running settings.
for pair in "$ca_crt:/var/lib/postgresql/tls/ca.crt" "$srv_crt:/var/lib/postgresql/tls/server.crt"; do
  host_file=${pair%%:*}
  container_file=${pair#*:}
  [ "$(sha256sum "$host_file" | cut -d' ' -f1)" = \
    "$(docker exec "$container" sha256sum "$container_file" | cut -d' ' -f1)" ] ||
    fail "$container does not serve the audited $container_file"
done
tls_settings=$(docker exec "$container" bash -lc \
  "PGPASSWORD=\$(cat /run/secrets/owner.pw) psql 'host=$host dbname=$database user=$owner_user sslmode=verify-full sslrootcert=/var/lib/postgresql/tls/ca.crt' -X -tAc \"SHOW ssl_cert_file; SHOW ssl_ca_file;\"" | tr '\n' '|')
[ "$tls_settings" = "/var/lib/postgresql/tls/server.crt|/var/lib/postgresql/tls/ca.crt|" ] ||
  fail "running TLS settings are $tls_settings"

# Read the owner password inside the container so it never appears in argv or
# on the host, and connect over the TLS path this instance is provisioned for.
role_present=$(docker exec "$container" bash -lc \
  "PGPASSWORD=\$(cat /run/secrets/owner.pw) psql 'host=$host dbname=$database user=$owner_user sslmode=verify-full sslrootcert=/var/lib/postgresql/tls/ca.crt' -X -tAc \"SELECT 1 FROM pg_roles WHERE rolname='$app_role'\"")
[ "$role_present" = "1" ] ||
  fail "runtime role $app_role is missing; the data volume may predate the init script"

say "ready: $host:$database on $network (internal), TLS only, runtime role $app_role present"
say "next: apply migrations and run ops/local/verify-pilot-db-tls.sh"
