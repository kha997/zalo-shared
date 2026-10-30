#!/usr/bin/env bash
set -euo pipefail
umask 077
export PGUSER=ci PGDATABASE=zalo_test PGHOST=/var/run/postgresql
psql -X -v ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE zs_ci_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
GRANT USAGE ON SCHEMA public TO zs_ci_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO zs_ci_runtime;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO zs_ci_runtime;
REVOKE UPDATE,DELETE,TRUNCATE ON audit FROM zs_ci_runtime;
SQL
psql -X -v ON_ERROR_STOP=1 --username=zs_ci_runtime <<'SQL'
DO $$ BEGIN
 BEGIN DELETE FROM audit; RAISE EXCEPTION 'runtime deleted audit'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN TRUNCATE audit; RAISE EXCEPTION 'runtime truncated audit'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN ALTER TABLE audit DISABLE TRIGGER audit_immutable; RAISE EXCEPTION 'runtime disabled trigger'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SQL
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
age-keygen -o "$work/identity" 2>/dev/null
export AGE_RECIPIENT="$(age-keygen -y "$work/identity")" QUIESCED=yes
psql -X -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM provider_events WHERE state='linked') OR NOT EXISTS(SELECT 1 FROM provider_events WHERE state='held') OR NOT EXISTS(SELECT 1 FROM provider_events WHERE state='conflict') THEN RAISE EXCEPTION 'nonempty representative journal fixture required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM provider_events e JOIN messages m ON m.id=e.message_id WHERE e.direction='outbound' AND m.actor_id IS NOT NULL) THEN RAISE EXCEPTION 'staff echo fixture missing'; END IF;
 IF (SELECT count(*) FROM provider_event_variants)<2 THEN RAISE EXCEPTION 'retained conflict variants missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM provider_state WHERE gap_version>0) THEN RAISE EXCEPTION 'versioned gap fixture missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM connector_ownership WHERE phase='uncertain' AND epoch=17 AND owner_label='ci-synthetic-owner' AND owner_id IS NOT NULL) THEN RAISE EXCEPTION 'uncertain ownership fixture missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM connector_ownership WHERE account_id='00000000-0000-4000-8000-000000000002' AND phase='idle' AND owner_id IS NULL) THEN RAISE EXCEPTION 'idle ownership fixture missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM delivery_parts p JOIN attachments a ON a.id=p.attachment_id AND a.message_id=p.message_id WHERE p.part=1 AND p.provider_id='ci-bound-media' AND a.data=convert_to('synthetic bound media recovery fixture','UTF8')) THEN RAISE EXCEPTION 'bound media recovery fixture missing'; END IF;
END $$;
SQL
provider_digest_sql="SELECT encode(sha256(convert_to(string_agg(row_to_json(e)::text,E'\n' ORDER BY id),'UTF8')),'hex') FROM provider_events e"
provider_digest_before=$(psql -X -v ON_ERROR_STOP=1 -At -c "$provider_digest_sql")
[[ -n "$provider_digest_before" ]] || { echo 'Empty journal digest' >&2; exit 1; }
provider_events_before=$(psql -X -v ON_ERROR_STOP=1 -At -c 'SELECT count(*) FROM provider_events')
variant_digest_sql="SELECT encode(sha256(convert_to(string_agg(row_to_json(v)::text,E'\n' ORDER BY event_id,semantic_hash),'UTF8')),'hex') FROM provider_event_variants v"
variant_digest_before=$(psql -X -v ON_ERROR_STOP=1 -At -c "$variant_digest_sql")
[[ -n "$variant_digest_before" ]] || { echo 'Empty conflict variant digest' >&2; exit 1; }
gap_before=$(psql -X -v ON_ERROR_STOP=1 -At -c "SELECT gap_version FROM provider_state WHERE account_id='00000000-0000-4000-8000-000000000001'")
[[ "$gap_before" =~ ^[0-9]{1,19}$ ]] || { echo 'Invalid gap version' >&2; exit 1; }
bash /tmp/zalo-ops/backup.sh "$work/backup.age"
export AGE_IDENTITY_FILE="$work/identity" RESTORE_QUARANTINE=yes
restore_started=$(date +%s)
bash /tmp/zalo-ops/restore.sh "$work/backup.age" zs_restore_ci
restore_finished=$(date +%s)
printf 'Restore elapsed seconds: %s\n' "$((restore_finished-restore_started))"
psql -X -v ON_ERROR_STOP=1 --dbname=zs_restore_ci -At <<'SQL'
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM sessions) THEN RAISE EXCEPTION 'restored sessions remain'; END IF;
 IF EXISTS(SELECT 1 FROM outbox WHERE status IN ('pending','processing')) THEN RAISE EXCEPTION 'restored jobs can dispatch'; END IF;
 IF EXISTS(SELECT 1 FROM provider_state WHERE status<>'disconnected') THEN RAISE EXCEPTION 'provider not quarantined'; END IF;
 IF EXISTS(SELECT 1 FROM provider_state WHERE NOT reconciliation_required) THEN RAISE EXCEPTION 'provider gap not quarantined'; END IF;
 IF EXISTS(SELECT 1 FROM connector_ownership WHERE phase<>'uncertain' OR owner_id IS NULL OR fault_code<>'restore-quarantine') THEN RAISE EXCEPTION 'connector owner not quarantined'; END IF;
 IF NOT EXISTS(SELECT 1 FROM connector_ownership WHERE epoch=17 AND owner_label='ci-synthetic-owner') THEN RAISE EXCEPTION 'owner epoch fixture lost'; END IF;
 IF NOT EXISTS(SELECT 1 FROM connector_ownership WHERE account_id='00000000-0000-4000-8000-000000000002' AND phase='uncertain' AND owner_id IS NOT NULL AND epoch=0 AND owner_label='restored-quarantine') THEN RAISE EXCEPTION 'idle owner restoration admitted a connector'; END IF;
 IF has_database_privilege('zs_ci_runtime',current_database(),'CONNECT') THEN RAISE EXCEPTION 'runtime can connect to restore'; END IF;
 IF NOT EXISTS(SELECT 1 FROM delivery_parts p JOIN attachments a ON a.id=p.attachment_id AND a.message_id=p.message_id WHERE p.part=1 AND p.provider_id='ci-bound-media' AND a.data=convert_to('synthetic bound media recovery fixture','UTF8')) THEN RAISE EXCEPTION 'bound media recovery fixture lost'; END IF;
END $$;
SELECT 'sessions',count(*) FROM sessions;
SELECT 'dispatchable',count(*) FROM outbox WHERE status IN ('pending','processing');
SELECT 'public_connect',coalesce(bool_or(acl.privilege_type='CONNECT' AND acl.grantee=0),false) FROM pg_database d CROSS JOIN LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) acl WHERE d.datname=current_database();
SQL
if psql -X --username=zs_ci_runtime --dbname=zs_restore_ci -c 'SELECT 1' > "$work/denied.log" 2>&1; then
 echo 'Runtime unexpectedly connected to restore' >&2
 exit 1
fi
provider_events_after=$(psql -X -v ON_ERROR_STOP=1 --dbname=zs_restore_ci -At -c 'SELECT count(*) FROM provider_events')
provider_digest_after=$(psql -X -v ON_ERROR_STOP=1 --dbname=zs_restore_ci -At -c "$provider_digest_sql")
[[ "$provider_digest_before" == "$provider_digest_after" ]] || { echo 'Provider journal content changed during restore' >&2; exit 1; }
[[ "$provider_events_before" == "$provider_events_after" ]] || { echo 'Provider event journal lost during restore' >&2; exit 1; }
variant_digest_after=$(psql -X -v ON_ERROR_STOP=1 --dbname=zs_restore_ci -At -c "$variant_digest_sql")
[[ "$variant_digest_before" == "$variant_digest_after" ]] || { echo 'Conflict variant evidence changed during restore' >&2; exit 1; }
gap_preserved=$(psql -X -v ON_ERROR_STOP=1 --dbname=zs_restore_ci -At -c "SELECT gap_version=CASE WHEN $gap_before::bigint<9223372036854775807 THEN $gap_before::bigint+1 ELSE $gap_before::bigint END FROM provider_state WHERE account_id='00000000-0000-4000-8000-000000000001'")
[[ "$gap_preserved" == t ]] || { echo 'Restore did not invalidate prior gap version' >&2; exit 1; }
grep -q 'permission denied for database'  "$work/denied.log"
echo 'Restore quarantine and runtime audit privilege assertions PASS'
