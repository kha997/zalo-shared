#!/usr/bin/env bash
# Verify the runtime database role is least-privileged against the live stack.
# Secrets are read from the container environment; none are printed.
set -euo pipefail
container=${PG_CONTAINER:-zalo-shared-g2-postgres-1}
db=${PGDATABASE_NAME:-zalo}
docker exec -i "$container" bash -s "$db" <<'CONTAINER'
set -euo pipefail
db=$1
export PGPASSWORD=$APP_DATABASE_PASSWORD
psql -X -v ON_ERROR_STOP=1 -U zs_app -d "$db" <<'SQL'
DO $$
BEGIN
  IF (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'runtime role is superuser';
  END IF;
  IF (SELECT rolcreatedb FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'runtime role can create databases';
  END IF;
  BEGIN UPDATE audit SET action = action; RAISE EXCEPTION 'runtime updated audit';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'audit UPDATE denied'; END;
  BEGIN DELETE FROM audit; RAISE EXCEPTION 'runtime deleted audit';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'audit DELETE denied'; END;
  BEGIN TRUNCATE audit; RAISE EXCEPTION 'runtime truncated audit';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'audit TRUNCATE denied'; END;
  IF (SELECT count(*) FROM users) < 1 THEN RAISE EXCEPTION 'runtime cannot read users'; END IF;
END $$;
SELECT current_user AS runtime_role, count(*) AS users FROM users GROUP BY current_user;
SQL
CONTAINER
