# G5-A database TLS verification

**Gate:** `D1_DATABASE_TLS_VERIFIED`
**Date:** 2026-11-03 (UTC)
**Scope:** dedicated pilot PostgreSQL on the Owner workstation; live local evidence, not CI
**Branch:** `feat/shared-inbox`; reviewed source commit `2dff06e063b87d6abf5e25e4a1ca9c369ba7236e`; connector image `zalo-shared-connector:g5-local` (`sha256:9bced3eb…27998`); verifier and migration scripts as committed in `9d94a26`

## Decision: dedicated database, not shared

The pre-existing PostgreSQL cluster is shared with unrelated workloads (the G2 application database and other projects). The investigation therefore took D1's preferred option: a **dedicated pilot PostgreSQL container**, leaving the shared cluster and every other project untouched.

- Container `pilot-postgres` (pinned `postgres:17-bookworm`, digest `sha256:839fbb5a…857a5`), volume `pilot-postgres-data`, network `zalo-shared-pilot-db` (`internal=true`, `172.16.30.0/24`).
- The verification reads the shared host cluster's start time only, and compares it with the pilot container's creation time; it does not write to the cluster. The G2 database container's creation time is compared the same way. Both predate the pilot container (`pilot-db-tls: PASS shared host cluster started before the pilot container`, `PASS G2 database container predates the pilot container`).
- Provisioning is idempotent: [ops/local/provision-pilot-db.sh](../../ops/local/provision-pilot-db.sh). On reuse it compares the SHA-256 of the mounted CA and server certificate with the audited files and checks the running `ssl_cert_file`/`ssl_ca_file`, so a drifted container does not pass silently.

## TLS configuration

- Private ECDSA P-256 CA and server certificate; SAN `DNS:pilot-db,DNS:localhost,IPAddress:127.0.0.1`; server key `0600`, owned by the database UID (999).
- PostgreSQL started with `ssl=on`, `ssl_min_protocol_version=TLSv1.2`, `password_encryption=scram-sha-256`, and an explicit `hba_file`.
- `pg_hba.conf`: `local all all trust` (container-private Unix socket only), `hostssl all all 172.16.30.0/24 scram-sha-256`, `hostnossl all all … reject`.
- The connector reaches the database with `postgresql://…@pilot-db:5432/zalo?sslmode=verify-full`. The reviewed gate admits `require`, `verify-ca` and `verify-full` for a non-loopback host; `verify-full` is the deployment choice because it also authenticates the host name. `requireTlsDatabaseUrl` refuses `sslrootcert` as a query parameter, so the CA is supplied through `NODE_EXTRA_CA_CERTS` and a read-only bind mount of the CA into the connector. `NODE_EXTRA_CA_CERTS` adds a trust anchor; it cannot disable verification. This is reflected in the reviewed compose file and the rendered deployed configuration.

## Verification matrix (live)

All rows are from [ops/local/verify-pilot-db-tls.sh](../../ops/local/verify-pilot-db-tls.sh) unless noted.

| Check | Result |
| --- | --- |
| Server certificate chains to the pilot CA | PASS |
| Certificate names `pilot-db` (SAN includes DNS and loopback IP) | PASS |
| Server key is `0600`, database UID | PASS |
| `ssl=on`, TLS 1.2 minimum | PASS |
| Runtime role negotiated TLSv1.3 / `TLS_AES_256_GCM_SHA384` | PASS |
| `pg_hba` admits `hostssl`, rejects `hostnossl` | PASS |
| Plaintext connection refused (`pg_hba.conf rejects connection`) | PASS |
| `verify-full` against a non-matching hostname refused | PASS (`server certificate for "pilot-db" …`) |
| `verify-full` against an unrelated CA refused | PASS (`certificate verify failed`) |
| `zs_app` is `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION` | PASS |
| `zs_app` cannot `CREATE TABLE` in `public` | PASS (`permission denied for schema public`) |
| `zs_app` cannot `UPDATE audit` but can insert messages | PASS |
| `zs_app` cannot `DELETE` ownership, provider state, budget or ledger rows | PASS (`permission denied for table …`) |
| `zs_app` cannot `UPDATE` the ledger or `TRUNCATE` control tables | PASS (`permission denied for table …`) |
| `zs_app` can reserve one budget part | PASS (`UPDATE 1`) |
| `zs_app` cannot roll the budget back, change its day or raise its cap | PASS (`pilot_send_budget row cannot be rolled back`) |
| Restart keeps the container healthy, data survives, TLS renegotiates | PASS (synthetic conversation/message rows) |
| `pg_dump`/restore into `zalo_restore_check` reproduces the row | PASS |
| Shared host postmaster and G2 container predate the pilot container | PASS |

Connector gate path, run in the reviewed image on the internal database network ([ops/local/verify-connector-db-path.sh](../../ops/local/verify-connector-db-path.sh)):

```text
connector-db: gate admitted the verify-full URL; role=zs_app version=TLSv1.3 cipher=TLS_AES_256_GCM_SHA384
connector-db: gate refused a non-loopback URL without sslmode (previous blocker reproduced)
connector-db: all checks PASS
```

The second line is the exact blocker that stopped the earlier live attempt: a non-loopback URL without `sslmode`. The gate refuses it before opening a socket.

The runtime-role hardening is applied by [ops/local/migrate-pilot-db.sh](../../ops/local/migrate-pilot-db.sh) **after** migrations, because the application migration grants broad DML on every table. It revokes `DELETE`/`TRUNCATE` on the four control tables, revokes `UPDATE` on the ledger, and installs a `BEFORE UPDATE` trigger that refuses a budget rollback, a day change or a cap increase. The connector's legitimate path (reserve one part, heartbeat and phase transitions) remains permitted and is exercised in the matrix above.

## Restore and recovery

The encrypted-session restore drill remains the separate offline/`tests/transport/pilot-recovery.test.ts` evidence. For the database itself, the live drill above proves dump and restore of the schema and data on the dedicated instance. It is a same-instance restore into `zalo_restore_check`, not an off-host backup or a point-in-time recovery proof. A database backup without the session key is still not a session-recovery proof; the pilot backup requirement is unchanged (encrypted session file, separate key, database state, manifest/grant).

## Residual risks

- The CA private key and server key live on the same private host, `0600`/`0400`; a host-root compromise defeats them. This is a private single-host pilot, not a hardened CA.
- `local` socket trust is scoped to the container's private Unix socket; no host socket is published and no TCP plaintext path exists.
- The database is dedicated but the host is shared; Docker daemon access remains an administrative trust boundary.
- The runtime role can still `UPDATE` the ownership phase/heartbeat and `last_reserved_at`, because those writes are required by the connector. A process that already holds the runtime credential can therefore interfere with liveness, though it can no longer delete the row, erase the budget or roll the counters back.
- TLS proves transport encryption and server identity, not that a compromised container cannot read data it is authorized to read.
- The database container uses the upstream entrypoint (root to drop privileges) and does not drop capabilities or set `no-new-privileges`; it is internal-only with no published port. This is a defense-in-depth gap, not a path from the connector network.
- This evidence is local and live; it is not a production capacity, availability or compliance proof.

## Status

`D1_DATABASE_TLS_VERIFIED` — PASS on the actual host. No live Zalo action was involved or implied.
