#!/usr/bin/env bash
# Provision private, non-repository material for the local offline pilot stack.
# Generates nonproduction secrets on first run; never prints secret values.
# Usage: bash ops/local/provision-private.sh
set -euo pipefail
umask 077

base=${PILOT_PRIVATE_DIR:-"$HOME/pilot-private/zalo-shared"}
mkdir -p "$base/backups" "$base/logs"
chmod 700 "$HOME/pilot-private" "$base" "$base/backups" "$base/logs"

if [ ! -f "$base/app.env" ]; then
  pg=$(openssl rand -hex 24)
  app=$(openssl rand -hex 24)
  metrics=$(openssl rand -hex 32)
  admin=$(openssl rand -hex 18)
  cat >"$base/app.env" <<EOF
POSTGRES_DB=zalo
POSTGRES_USER=zalo_owner
POSTGRES_PASSWORD=$pg
APP_DATABASE_PASSWORD=$app
APP_DATABASE_ROLE=zs_app
MIGRATION_DATABASE_URL=postgresql://zalo_owner:$pg@postgres:5432/zalo
DATABASE_URL=postgresql://zs_app:$app@postgres:5432/zalo
PUBLIC_ORIGIN=http://127.0.0.1:3100
METRICS_TOKEN=$metrics
EOF
  cat >"$base/seed.env" <<EOF
ADMIN_EMAIL=admin@zalo-shared.test
ADMIN_PASSWORD=$admin
EOF
fi
chmod 600 "$base/app.env" "$base/seed.env"

# The connector image runs as UID 65532 and rejects foreign-owned mounts.
# Only this project-owned subtree is delegated to that UID.
sudo install -d -o 65532 -g 65532 -m 0700 \
  "$base/pilot" "$base/pilot/state" "$base/pilot/state/view"
if [ ! -f "$base/pilot/session.key" ]; then
  sudo sh -c 'umask 077; openssl rand 32 > "$1"' _ "$base/pilot/session.key"
fi
sudo chown 65532:65532 "$base/pilot/session.key"
sudo chmod 600 "$base/pilot/session.key"

printf 'provisioned: %s\n' "$base"
stat -c 'mode=%a owner=%U:%G name=%n' "$base" "$base/app.env" "$base/seed.env"
# The connector subtree is intentionally unreadable to the login user.
sudo stat -c 'mode=%a owner=%U:%G name=%n' \
  "$base/pilot" "$base/pilot/state" "$base/pilot/state/view" "$base/pilot/session.key"
