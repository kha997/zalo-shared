#!/usr/bin/env bash
set -euo pipefail
umask 077
export PGUSER=ci PGDATABASE=zalo_test PGHOST=/var/run/postgresql
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
age-keygen -o "$work/identity" 2>/dev/null
export AGE_RECIPIENT="$(age-keygen -y "$work/identity")" QUIESCED=yes
bash /tmp/zalo-ops/backup.sh "$work/backup.age"
export AGE_IDENTITY_FILE="$work/identity" RESTORE_QUARANTINE=yes
restore_started=$(date +%s)
bash /tmp/zalo-ops/restore.sh "$work/backup.age" zs_restore_ci
restore_finished=$(date +%s)
printf 'Restore elapsed seconds: %s\n' "$((restore_finished-restore_started))"
psql -X -v ON_ERROR_STOP=1 --dbname=zs_restore_ci -At <<'SQL'
SELECT 'sessions',count(*) FROM sessions;
SELECT 'dispatchable',count(*) FROM outbox WHERE status IN ('pending','processing');
SELECT 'public_connect',coalesce(bool_or(acl.privilege_type='CONNECT' AND acl.grantee=0),false) FROM pg_database d CROSS JOIN LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) acl WHERE d.datname=current_database();
SQL
