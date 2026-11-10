# Controlled Docker recovery after the WSL outage — 2026-11-10

**Verdict:** `WSL_DOCKER_PILOT_RECOVERED_RECONCILIATION_READY`
**Authorization:** Owner directive "ZALO SHARED — OWNER AUTHORIZATION: CONTROLLED DOCKER RECOVERY"
(infrastructure recovery only; §2 scope: `pilot-postgres`, `zalo-shared-pilot-app-1`,
`zalo-shared-pilot-egress-gateway-1`)
**Recovery executed:** 2026-11-10T05:51Z – 06:03Z
**Verification snapshot:** 2026-11-10T06:02:28Z (read-only)
**Branch:** `feat/shared-inbox` (PR #3 open, Draft, not merged)

This report records infrastructure recovery only. No reconciliation request was sent, no
connector was started, no provider was contacted, no QR or observe/send-test was run, no
database row was written, no volume was deleted, no image was rebuilt or substituted, no
certificate, credential or key was regenerated, and the VHDX was not moved.

## 1. Pre-recovery state

| Check (§4) | Finding |
| --- | --- |
| Ubuntu file system | Accessible; `/dev/sdf` 1007G, 102G used, 854G available |
| Docker engine | Docker Desktop 29.6.2 running, but WSL integration lost: `IntegratedWslDistros` was `null`, `EnableIntegrationWithDefaultWslDistro` `false` |
| Pilot containers | `pilot-postgres` gone/restart-looping; `zalo-shared-pilot-app-1` and `zalo-shared-pilot-egress-gateway-1` stopped (exit 255 at 2026-11-09T16:35:00Z) |
| Bind-mount sources | Present on the Ubuntu VHDX, but no translation pipeline existed: containers created via the Windows CLI resolved `/home/zen/...` to empty VM paths |
| PostgreSQL named volume | `pilot-postgres-data` present (created 2026-11-03T15:11:30Z); not recreated or deleted |
| Private credentials | Seven files under `pilot-db/{pki,tls,secrets,hba,init}` intact with original mtimes/modes; `pilot/session.key` intact (32 bytes, `65532:65532`, mtime 2026-11-02) |
| Active connector / grants | No connector container; every enrollment manifest's consent `notAfter` is in the past or a placeholder |
| Log retention | Pre-recovery logs preserved under `D:\WSL-Backups\recovery-2026-11-09\logs\` (`inspect-before.json`, `pilot-postgres.log`, `zalo-shared-pilot-app-1.log`, `zalo-shared-pilot-egress-gateway-1.log`, `restore-postgres.log`) |
| Persistent-data integrity | Verified before any mutation: volume present, TLS/secret files unchanged, control state readable |

## 2. Root cause

The WSL outage left Docker Desktop with an empty WSL-distro integration list. Without a
distro context, Docker Desktop does not provision the per-distro agent or materialise
host binds into the VM, so every pilot bind mount (TLS, `pg_hba.conf`, role init, secrets)
resolved to an empty path. PostgreSQL could therefore not present its certificate, and the
application could not reach a healthy database. The defect was in the integration
configuration, not in the pilot volumes, credentials or database.

## 3. Repair performed (exact)

### 3.1 Restore the WSL integration through Docker Desktop's own settings path

1. Backed up the settings store first:
   `D:\WSL-Backups\recovery-2026-11-09\settings-store.before-20261110T055120Z.json`
   (`IntegratedWslDistros: null`, `EnableIntegrationWithDefaultWslDistro: false`,
   `SettingsVersion: 45`).
2. Sent a single partial update through the Docker Desktop backend API
   (`appmanager`, named pipe `\\.\pipe\dockerBackendApiServer`):
   `POST http://localhost/app/settings` with `{"integratedWslDistros":["Ubuntu-24.04"]}`.
   The service reported "found changes", "restart needed: true", "settings applied".
3. Docker Desktop restarted the engine, then re-provisioned the distro agent, the
   `cli-tools` directory and the real bind materialisation under
   `/run/desktop/mnt/host/wsl/docker-desktop-bind-mounts/Ubuntu-24.04/<sha256>` backed by
   the Ubuntu VHDX. No registry edit, no `wsl --shutdown`, no host-wide Docker reset, no
   VHDX operation.
4. Reverted-readiness: restoring the pre-change JSON through the same API returns the
   previous state; the backup file is retained.

### 3.2 PostgreSQL (first, per §5)

- An earlier restore attempt (preserved log `restore-postgres.log`) recreated the container
  as `4c192e05…`, which restarted with exit 127 because the TLS/secret binds still resolved
  empty. That instance was superseded and is not part of the final state.
- After the integration repair, the reviewed `ops/local/provision-pilot-db.sh` was executed
  unchanged. It recreated **only the container**, mounting the existing named volume and the
  same eight read-only host binds; it did not initialize a database, regenerate TLS or
  change roles.

### 3.3 Application (second)

- The reviewed private compose plus the reviewed interpolation file (byte-identical to the
  repository examples, hashes below) were used to recreate **only the app container** with
  `--no-deps --force-recreate`. The first instance had booted before the database existed and
  stayed unready (503); the recreate is what returned it to healthy.

### 3.4 Egress gateway (third)

- The reviewed private compose started `egress-gateway`. The container itself was **not**
  recreated: its identity is the one deployed on 2026-11-09T14:55:13Z and it was restarted in
  place at 05:59:28Z.

### 3.5 Container identity after recovery

| Container | Container ID | Image | Created (UTC) | Started (UTC) | Health | User | RO rootfs | Ports |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `pilot-postgres` | `afeec62ac108…b570389` | `postgres:17-bookworm@sha256:858bb5e9…d27` | 2026-11-10T05:56:07Z | 2026-11-10T05:56:07Z | healthy | image default | no | none published |
| `zalo-shared-pilot-app-1` | `a6d4bd357157…bb9df2` | `zalo-shared:g5-patched-af2be54` (`sha256:989c6154…fbe824`) | 2026-11-10T05:58:53Z | 2026-11-10T05:58:55Z | healthy | `65532:65532` | yes | `127.0.0.1:3100 -> 3100/tcp` |
| `zalo-shared-pilot-egress-gateway-1` | `ae0ddff1d535…c65436` | `zalo-shared-egress-gateway:g5-patched-af2be54` (`sha256:f75c2e8a…f5d4c9`) | 2026-11-09T14:55:13Z | 2026-11-10T05:59:28Z | healthy | `65532:65532` | yes | none published |

Recreated: **PostgreSQL and the application**. Started in place: **egress gateway**.
Named volumes recreated or deleted: **none**. Images rebuilt or substituted: **none**.

PostgreSQL mounts (all binds `rw=false`, volume `rw=true`):

| Destination | Source |
| --- | --- |
| `/var/lib/postgresql/data` | volume `pilot-postgres-data` |
| `/var/lib/postgresql/tls/ca.crt` | private `pilot-db/pki/ca.crt` |
| `/var/lib/postgresql/tls/server.crt` | private `pilot-db/tls/server.crt` |
| `/var/lib/postgresql/tls/server.key` | private `pilot-db/tls/server.key` |
| `/etc/postgresql/pilot/pg_hba.conf` | private `pilot-db/hba/pg_hba.conf` |
| `/docker-entrypoint-initdb.d/10-runtime-role.sh` | private `pilot-db/init/10-runtime-role.sh` |
| `/run/secrets/owner.pw` | private `pilot-db/secrets/owner.pw` |
| `/run/secrets/app.pw` | private `pilot-db/secrets/app.pw` |

Application mount: private `pilot-db/pki/ca.crt` → `/run/pilot/db-ca.crt` (`rw=false`).
Gateway mounts: none.

### 3.6 Configuration identity

| Artifact | SHA-256 |
| --- | --- |
| Private `topology/pilot-compose.yml` = `ops/pilot-compose.example.yml` | `3aaaabee74eaf3fa7753c79a3b1d78d7c44a435cc7fd66fffac2b2c9d74a345b` |
| Private `pilot-app/topology/pilot-app-compose.yml` = `ops/pilot-app-compose.example.yml` | `4f63945169ca81d643e81e88bb9f343bce9c9736bd0ec123c3e7d83676ac8287` |

Interpolation pins: `PILOT_CONNECTOR_IMAGE=zalo-shared-connector:g5-ci-8d9e39d` (staged,
not run), `PILOT_APP_IMAGE=zalo-shared:g5-patched-af2be54`,
`PILOT_EGRESS_GATEWAY_IMAGE=zalo-shared-egress-gateway:g5-patched-af2be54`.
Rendered application environment keeps `NODE_ENV=production`, `PROVIDER_MODE=disabled`,
`MOCK_ENABLED=false`, `APP_DATABASE_ROLE=zs_app` and exactly one `sslmode=verify-full`.

## 4. §6 verification

| Item | Result at 2026-11-10T06:02:28Z |
| --- | --- |
| PostgreSQL healthy | PASS — healthcheck `pg_isready -U zs_owner -d zalo` accepting connections (five consecutive exit 0) |
| TLS `verify-full` | PASS — application DSN carries `sslmode=verify-full`; the live `zs_app` session is `TLSv1.3` / `TLS_AES_256_GCM_SHA384` / 256 bits from `172.16.30.2` |
| Application healthy | PASS — container health `healthy`; runs `65532:65532`, read-only rootfs |
| Gateway healthy | PASS — container health `healthy`; `65532:65532`, read-only rootfs, no published port |
| Allowlist unchanged | PASS — exactly `id.zalo.me`, `jr.chat.zalo.me`, `jr.zaloapp.com`, `wpa.chat.zalo.me`; `chat.zalo.me` absent |
| No unexpected egress | PASS — gateway is the only member of the non-internal `pilot-uplink`; zero tunnels since the restart; no connector container; gateway logs carry no provider traffic after 2026-11-09T15:02Z |
| No active connector | PASS — no connector container or process; ownership is fenced, not idle |
| No active enrollment grant | PASS — all private manifest `notAfter` values are expired or placeholders |
| No session or `session.enc` | PASS — no `session.enc`, `session.json`, `*.session`, `session.db` or `qr.png` under the private tree; `session.key` unchanged (32 bytes, `65532:65532`) |
| No unresolved delivery work | PASS — provider events 0, media jobs 0, dispatchable 0, delivery parts 0 |

Network isolation (unchanged):

| Network | ID | Internal | Members | Subnet |
| --- | --- | --- | --- | --- |
| `zalo-shared-pilot-db` | `b267f7de…11e1a5e8` | true | app, postgres | 172.16.30.0/24 |
| `zalo-shared-pilot_pilot-egress` | `b0dfc652…e9d99f64b5d` | true | gateway | 172.16.29.0/24 |
| `zalo-shared-pilot_pilot-uplink` | `08ecd9bc…b3b5e4686` | false | gateway only | — |

Application: 172.16.30.2 (db) and 172.25.0.2 (`pilot-edge`); PostgreSQL: 172.16.30.3;
gateway: 172.16.29.10 (egress) and 172.23.0.2 (uplink).

## 5. Authoritative database state (read-only)

Read inside `BEGIN TRANSACTION READ ONLY` followed by `ROLLBACK`; no row was written.

| Field | Expected (§6) | Observed |
| --- | --- | --- |
| Ownership phase | `uncertain` | `uncertain` |
| Ownership epoch | 7 | 7 |
| Ownership fault | — | `shutdown`, `uncertain_at 2026-11-09T13:25:18Z` |
| Provider status | — | `disconnected` |
| Provider gap | 7 | 7 |
| `reconciliation_required` | true | true |
| Audit rows | 28 | 28 |
| `connector.reconciled` rows | — | 3 |
| Max audit id | — | 28 |
| Last audit actions | — | `auth.login`, `auth.logout`, `connector.reserved`, `connector.uncertain` |
| Users / admins / sessions | — | 1 / 1 / 0 |
| Content tables | — | all 0 (`messages`, `outbox`, `delivery_parts`, `provider_events`, `provider_media_jobs`, `provider_ledger`, `pilot_send_budget`, `pilot_part_ledger`, `attachments`, `conversations`) |
| Advisory locks | — | 0 |
| Other DB sessions | — | 1 — the application's own `zs_app` pool connection (idle, TLS, from `172.16.30.2`); no reconciliation driver |

The observed state matches the expected values exactly. No repair, overwrite or
reconciliation was attempted, and no discrepancy existed that would require the
`WSL_DOCKER_RECOVERY_BLOCKED` verdict.

## 6. Unrelated workloads (§7, read-only; not started, recreated or modified)

| Workload | Image | State | Persistent data | Recovery requirement |
| --- | --- | --- | --- | --- |
| `zena-material-commerce-db-1` | `mariadb:11.4` (`sha256:67873d30…`) | Exited 255 at 2026-11-09T16:35:00Z, restart `no` | named volume `zena-material-commerce_db_data` (created 2026-08-08) | Start the container first; never recreate the volume. Healthcheck must pass before the app |
| `zena-material-commerce-app-1` | `zena-material-commerce-app` (`sha256:68b27158…`) | Exited 255 at 2026-11-09T16:35:00Z, restart `no` | bind `actions-runner-zmc/_work/…/application` → `/var/www/html` (193M, present) | Start after the database is healthy; the bind source is the CI workspace and resolves again now that integration is restored. Its last logs show bind-mount I/O errors before the outage |
| `zena-lib3-local` | `postgres:16.15-alpine` | Exited 255 at 2026-11-09T16:35:00Z, restart `no` | anonymous volume `4a8971e7…` (created 2026-11-04) | `docker start` only — recreating the container would orphan the anonymous volume |
| `zs-pg-test` | `postgres:17-bookworm` | Exited 255 at 2026-11-09T16:35:00Z, restart `no` | anonymous volume `181ab4e0…` (created 2026-11-02) | Test database; `docker start` if its data matters, otherwise treat as disposable only with explicit approval |
| Self-hosted Actions runner | host service, not a container | `actions.runner.kha997-zena-material-commerce.zmc-linux-wsl.service` loaded, active (running) | workspace `/home/zen/actions-runner-zmc` intact | None; the runner survived the engine restart |

All five failures share the same exit instant (2026-11-09T16:35:00Z) and restart policy `no`,
so none returns automatically after a daemon or host restart.

**Side effect of the recovery itself:** restarting the Docker engine to apply the settings
change stopped three `deer-flow` containers (`deer-flow-frontend` exit 137,
`deer-flow-gateway` exit 0, `deer-flow-nginx` exit 0). They are outside this authorization
and were left down; a separate Owner-approved start is recommended. Older stopped containers
(`g3-*`, `zbc-*`, `haip-*`, `zena-*`, `zs-pg-test`) were not touched.

## 7. Capacity and VHDX status (§8)

| Volume | Size | Used | Free | Use |
| --- | --- | --- | --- | --- |
| Ubuntu `/dev/sdf` | 1007G | 102G | 854G | 11% |
| Windows `C:` | 465G | 460G | 4.8G | 99% |
| Windows `D:` | 466G | 210G | 256G | 45% |

The Ubuntu distro VHDX lives on `C:` at
`C:\Users\Admin\AppData\Local\wsl\{1a4ec4c9-5668-452c-b58b-82e6436b3cb7}\ext4.vhdx`
(apparent size 138G); Docker Desktop's data VHDX is at
`C:\Users\Admin\AppData\Local\Docker\wsl\main\ext4.vhdx` (104M). **4.8G free on `C:` is the
main remaining capacity risk.**

The VHDX copy on `D:` was preserved and not moved:
`D:\WSL-Backups\ubuntu-24.04-ext4.2026-11-09\ext4.vhdx`
(147,385,745,408 bytes, header `vhdxfile`, copied 2026-11-09T15:56–16:01Z).

**Validation finding:** the copy is **not a verified backup**. Its own manifest records
`SHA256 MATCH: False` — source `c64bb6a67f3d68ba…` at copy time versus destination
`a15c32e900bb0131…`. It was taken with Robocopy while the distro was running, so it is not a
crash-consistent image and must not be used for rollback.

### Recommended relocation plan (report only — not performed)

1. Pick a maintenance window and stop pilot and unrelated workloads in the distro.
2. Re-take a consistent backup: prefer `wsl --export Ubuntu-24.04 D:\WSL-Backups\ubuntu-24.04-<utc>.tar`
   with a verified SHA-256; alternatively `wsl --shutdown`, then an offline VHDX copy with a
   verified checksum. Do not copy a running VHDX again.
3. Confirm free space: D needs the image size plus at least 10% headroom (256G free now).
4. Relocate with `wsl --manage Ubuntu-24.04 --move D:\WSL\Ubuntu-24.04`, or export/import
   under the same distro name, preserving `/etc/wsl.conf` and the default user.
5. Restart Docker Desktop, confirm `IntegratedWslDistros` still contains `Ubuntu-24.04`, and
   confirm binds resolve through `/run/desktop/mnt/host/wsl/docker-desktop-bind-mounts/`.
6. Start the stack in the reviewed order (PostgreSQL → application → gateway) and repeat the
   §6 read-only checks.
7. Rollback: keep the verified export until two healthy restart cycles, then revert the
   registry `BasePath`/import path if needed. Impact: all distro workloads are offline for
   the duration; export/import may compact the VHDX.

## 8. Residual risks and findings

1. **The D: VHDX copy is not checksum-valid and not crash-consistent** (section 7). It is
   preserved but unusable as rollback evidence; re-take it before any relocation.
2. **`C:` has 4.8G free.** Further image pulls or database growth could exhaust it.
3. **The gateway's restart policy is `no`.** `pilot-postgres` and the app are
   `unless-stopped`; after a host reboot the gateway will not return without an explicit
   start. This is the reviewed compose's value and was not changed during recovery.
4. **Preserved evidence contains credentials with broad local ACLs.**
   `D:\WSL-Backups\recovery-2026-11-09\logs\inspect-before.json` contains the application
   DSN (and therefore its database password). `Authenticated Users` hold `Modify` and
   `BUILTIN\Users` hold `Read` on `D:\WSL-Backups`. Recommended follow-up: restrict the tree
   to the Owner account, or rotate `zs_app` and re-render the app environment. Not changed
   here because ACLs and credentials are outside this authorization.
5. **Engine restart side effect:** three `deer-flow` containers are down (section 6).
6. **UNPROVEN:** no live provider contact occurred, so provider reachability remains as
   previously recorded; this recovery does not change the G5-A reconciliation status.

## 9. Recommended next actions (each needs separate authorization)

1. Open the Owner UTC window for the single prepared reconciliation
   (`uncertain → idle`, epoch 7→8, gap 7→8); this report does not advance it.
2. Approve restarts (not recreations) for `zena-material-commerce-db-1` then its app,
   `zena-lib3-local`, and optionally `zs-pg-test`; approve a restart of the three
   `deer-flow` containers.
3. Restrict ACLs on `D:\WSL-Backups` (or rotate `zs_app`) and re-take a verified VHDX export.
4. Decide whether the gateway should be `unless-stopped`; changing it requires a reviewed
   compose change.
5. Reclaim space on `C:` before any further image build or pull.

## 10. Sanitization

No password, private key, session key, `DATABASE_URL`, UID, phone number, QR content or
provider identifier appears in this report. Only digests, container/network IDs, host paths
and non-secret configuration values are recorded.
