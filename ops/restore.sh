#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${AGE_IDENTITY_FILE:?Supply offline age identity path}"
: "${RESTORE_QUARANTINE:?Use isolated PG instance with no app or worker; set RESTORE_QUARANTINE=yes}"
[[ "$RESTORE_QUARANTINE" == yes && $# == 2 ]] || { echo 'Usage: restore.sh ARCHIVE.age NEW_DATABASE' >&2; exit 2; }
archive=$1
restore_db=$2
[[ "$restore_db" =~ ^[a-z][a-z0-9_]{0,47}$ ]] || { echo 'Unsafe database name' >&2; exit 2; }
[[ "$restore_db" != postgres && "$restore_db" != template0 && "$restore_db" != template1 ]] || exit 2
# createdb refuses an existing target; no drop or overwrite path exists.
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
sha256sum -c "$archive.sha256"
age -d -i "$AGE_IDENTITY_FILE" "$archive" | tar -x -C "$work" --no-same-owner --no-same-permissions
(cd "$work" && sha256sum -c manifest.sha256)
createdb --template=template0 "$restore_db"
# No app role has explicit CONNECT on this new DB. PUBLIC loses its default grant.
psql -X -v ON_ERROR_STOP=1 -v restore_db="$restore_db" --dbname=postgres <<'SQL'
REVOKE CONNECT ON DATABASE :"restore_db" FROM PUBLIC;
SQL
pg_restore --exit-on-error --single-transaction --no-owner --no-acl --dbname="$restore_db" "$work/database.dump"
PGDATABASE="$restore_db" psql -X -v ON_ERROR_STOP=1 -At -f "$(dirname "$0")/counts.sql" > "$work/restored-counts.tsv"
cmp "$work/counts.tsv" "$work/restored-counts.tsv"
PGDATABASE="$restore_db" psql -X -v ON_ERROR_STOP=1 -At -f "$(dirname "$0")/integrity.sql" > "$work/restored-integrity.tsv"
cmp "$work/integrity.tsv" "$work/restored-integrity.tsv"
# Fail closed: revoke sessions and quarantine all work that might otherwise dispatch.
PGDATABASE="$restore_db" psql -X -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
DELETE FROM sessions;
UPDATE outbox SET status='unknown' WHERE status IN ('pending','processing');
UPDATE messages SET status='unknown' WHERE direction='outbound' AND status IN ('pending','processing');
UPDATE delivery_parts SET status='unknown' WHERE status IN ('pending','processing');
UPDATE provider_state SET status='disconnected',reconciliation_required=true;
UPDATE connector_ownership SET phase='uncertain',owner_id=coalesce(owner_id,gen_random_uuid()),owner_label=coalesce(owner_label,'restored-quarantine'),uncertain_at=now(),fault_code='restore-quarantine';
INSERT INTO audit(action,target_id,metadata) VALUES('system.restore_quarantine',current_database(),'{"dispatchEnabled":false}');
COMMIT;
SQL
echo 'Restored and quarantined. Keep dispatch disabled; verify media hashes, roles and audit before reconnect.'
