# G5-A post-recovery stabilization — 2026-11-10

**Authorization:** Owner directive *POST-RECOVERY STABILIZATION & G5-A RECONCILIATION
READINESS* — "post-recovery security and preparation only". **Result:
`G5A_POST_RECOVERY_SECURED_RECONCILIATION_READY`.** No reconciliation, QR, provider
contact, observe/send, destructive storage repair, production deploy or PR merge occurred.

Scope of this record: the host baseline after the 2026-11-10 reboot, the ACL restriction of
the private Windows backup set, the Git integration of the local evidence, the re-verified
pilot fence, the prepared (unsent) reconciliation request, a read-only storage inventory and
the exact restore actions for the unrelated workloads. Written at `2026-11-10T14:32Z`.

## 1. Host baseline

| Item | Observed |
| --- | --- |
| Host | `DESKTOP-U0Q31VK`, WORKGROUP, owner account `DESKTOP-U0Q31VK\Admin` |
| Reboot | Windows event 1074, `Other (Unplanned)`, `2026-11-10T06:28:58+07:00`; boot 6005/6006 consistent |
| Pilot database | `pilot-postgres`, up 8 h, healthy |
| Pilot application | `zalo-shared-pilot-app-1`, container `a6d4bd35…`, started `2026-11-10T06:31:03Z` by `restart: unless-stopped`, healthy, image `sha256:989c6154…` |
| Egress gateway | `zalo-shared-pilot-egress-gateway-1`, container `ae0ddff1…`, created `2026-11-09T14:55:13Z`, restarted **in place** at `2026-11-10T14:24:50Z`, healthy in 6 s |

The gateway has `restart: no`, so the reboot left it stopped while the application and
database came back. It was started with the same container ID and image
(`sha256:f75c2e8a…`), so the reviewed allowlist, mounts and network attachment are the
deployed ones — nothing was recreated. Its log after the restart contains only the process
startup line, no admitted tunnel and no denial. The earlier `init.log` growth was size-based
rotation (1 MiB), not repeated VM restarts; the reboot is the single cause.

## 2. Workstream A — private evidence protection

`D:\WSL-Backups` inherited `NT AUTHORITY\Authenticated Users:(M,AD)` and
`BUILTIN\Users:(RX)`. Two enabled local accounts, `CodexSandboxOffline` and
`CodexSandboxOnline`, are members of `BUILTIN\Users`, so any of them could read or modify the
backup set. `recovery-2026-11-09\logs\inspect-before.json` contains the container's `env`
including `DATABASE_URL` with the embedded `zs_app` password and `METRICS_TOKEN`; a scan of
all 22 items found no other credential-bearing file (the application log matches are the
libpq method names `authenticationCleartextPassword` / `authenticationMD5Password`, not
values).

A reviewed ACL procedure was applied:

| Phase | ACEs on `D:\WSL-Backups` |
| --- | --- |
| Before (`14:23:32Z`) | `Administrators` F, `SYSTEM` F, **`Authenticated Users` Modify**, **`Users` ReadAndExecute** — all inherited |
| After (`14:23:32Z`) | inheritance removed; `SYSTEM` F, `Administrators` F, `DESKTOP-U0Q31VK\Admin` F — explicit only |

The before/after capture is retained as `acl-before.txt` / `acl-after.txt` in the same
directory. Recursive verification of all 22 items after the change found **zero** ACEs for
`Users`, `Everyone`, `Authenticated Users` or any `Codex*` principal. No file was moved,
deleted or rewritten: the 147,385,745,408-byte VHDX and every log keep their size, and WSL
access through the DrvFs mount still works.

**Exposure verdict:** the credential-bearing file *was* readable by unintended principals
between the 2026-11-09 backup and this change. **Rotation is warranted** for the `zs_app`
password and `METRICS_TOKEN`. It was **not** rotated: that changes deployed configuration and
needs its own authorization, and rotation during a pending reconciliation window would
invalidate the verified deployed state.

## 3. Workstream B — Git evidence

| Item | Value |
| --- | --- |
| Branch | `feat/shared-inbox` |
| Local HEAD | `cfddd1c` — *Record the controlled Docker recovery and the read-only pilot verification* |
| Remote HEAD before push | `f459d8f` |
| Divergence | 0 behind, 1 ahead — a clean fast-forward, no merge commit needed |
| Working tree | clean |
| PR #3 | OPEN / DRAFT, "Secure multi-staff shared inbox with guarded pilot connector" |

The local commit only adds sanitized evidence (`docs/evidence/G5A-DOCKER-RECOVERY-2026-11-10.md`
and `PILOT-GATE-STATUS.md`) and no credential, QR, session, UID or private path. It was pushed
as a fast-forward; no force, reset, rebase or history rewrite was used and no unrelated remote
change existed to overwrite.

## 4. Workstream C — pilot state and the prepared request

Re-read in one `READ ONLY` transaction at `2026-11-10T14:32Z`; every predicate matches the
fenced incident.

| Item | Observed |
| --- | --- |
| Ownership | `uncertain`, owner `af5048a8-41c7-46b3-920c-310855d6c911`, label `pilot-enrollment`, epoch **7**, fault `shutdown`, `uncertain_at 2026-11-09T13:25:18.446420Z` |
| Preserved fence | `7cc878cf-cdb1-4b4a-9905-2d107aa21482` / epoch `5` / `2026-11-07T00:54:51.642226Z` |
| Provider | `disconnected`, `reconciliation_required=true`, gap **7**, fault `shutdown`, `last_event_at` null |
| Identities | 1 user, 1 admin, 0 sessions |
| Audit | 28 rows, 3 `connector.reconciled`, max id 28, prefix `connector.reserved`,`connector.uncertain`, tail `auth.login,auth.logout,connector.reserved,connector.uncertain` |
| Unresolved work | provider events, media jobs, outbox/messages, delivery parts = 0/0/0/0 |
| Content tables | messages, outbox, delivery parts, events, variants, media jobs, ledger, budgets, part ledger, attachments, conversations = 0 |
| Concurrency | advisory locks 0; one **idle** `zs_app` session from `172.16.30.3` (the deployed application's pool) |
| Private state | `session.enc` absent, `qr.png` absent, `quarantine` absent, `session.key` present, `pilot/state/view` empty |
| Workers | no connector or bootstrap container; pilot DB network holds only `zalo-shared-pilot-app-1` and `pilot-postgres` |

The single idle application session is the known intermittent condition: the reconciliation
driver requires `other_active_sessions = 0`, so the reviewed procedure quiesces the
application first (stop `zalo-shared-pilot-app-1` through the private compose, re-run the
read-only preflight, require `other_sessions=0` and `advisory_locks=0` immediately before the
request, then start it again). That procedure is unchanged and is enforced by
`ops/local/reconcile-pilot-state.mjs`.

**Prepared request — not sent.** Written to
`/home/zen/pilot-private/zalo-shared/pilot-admin/reconcile-request-2026-11-10.json`
(mode `0600`, owner `zen`):

| Field | Value |
| --- | --- |
| `requestId` | `521bbecd-f666-4f0d-8e6c-efe73ebcc3ef` (uuid v4, unused) |
| `expectedOwnerId` | `af5048a8-41c7-46b3-920c-310855d6c911` |
| `expectedOwnerEpoch` / `expectedGapVersion` | `7` / `7` |
| `evidenceRef` | `G5A-OWNER-AUTH-2026-11-10-RECONCILIATION` (placeholder for the Owner's window reference) |
| `confirmOwnerApproved` | `true` |
| `localState` | `sessionFile: absent`, `quarantine: absent` |
| Body SHA-256 | `709270a0339500ba774422fed5a3e5587df20a3442ddd91dae2d8aa9cc7a3202` |
| Endpoint | `POST /api/provider/operations/reconcile` on `http://127.0.0.1:3100` with `zs_session` cookie and `x-csrf-token` |
| Expected response | `{"ok":true,"epoch":"8","gapVersion":"8","alreadyApplied":false}` |
| Status | `notSent: true` — no login, no request, no mutation |

**One blocking detail for the execution step.** `ops/local/reconcile-pilot.sh` is bound to the
2026-11-07 incident: it hardcodes the `00:54–01:14Z` window, owner `7cc878cf…`, epoch 5, gap 5
and app image `zalo-shared:g2-adf8ceca9bd6`, and it verifies specific reviewed blobs. It has
expired and **must not** be reused. The parameterized driver
`ops/local/reconcile-pilot-state.mjs` is the correct executor (env-bound window, advisory
single-flight lock `73003/1`, pre/post verification, no retry); it needs a wrapper carrying
the Owner's window, the epoch-7 values and the deployed `zalo-shared:g5-patched-af2be54`
image. That wrapper encodes a window, so it is deliberately not prepared under this
authorization.

## 5. Workstream D — storage

| Volume | Size | Free |
| --- | --- | --- |
| `C:` | 464.5 GB | **8.41 GB** (99 % used) |
| `D:` New Volume | 465.4 GB | 264.69 GB |
| `E:` Seagate | 931.5 GB | 355.27 GB |

`C:` consumers, measured read-only:

| Path | Size | Note |
| --- | --- | --- |
| `C:\Users\Admin\AppData\Local\wsl\{1a4ec4c9-…}\ext4.vhdx` | 137.29 GB | guest holds 102 GB of data → ~35 GB is allocated-but-unused |
| `C:\Users\Admin\AppData\Local\Docker\wsl\disk\docker_data.vhdx` | 64.73 GB | `docker system df`: images 23.45 (10.92 reclaimable), volumes 17.56 (10.35 unused), build cache 27.51 (10.60 reclaimable), stopped containers 1.70 |
| `C:\Windows\Installer` | 3.42 GB | do not touch |
| `C:\Users\Admin\Downloads` | 3.61 GB | user data |
| `C:\Users\Admin\AppData\Local\Packages` | 1.78 GB | user data |
| `C:\Users\Admin\AppData\Local\Temp` | 1.10 GB | 1,814 items |
| `C:\Windows\SoftwareDistribution\Download` | 0.39 GB | 67 files |
| `C:\$Recycle.Bin`, `C:\Windows.old` | 0 / absent | — |

Restore points and shadow storage could not be enumerated without elevation
(`vssadmin` refused); the inventory of that space is **UNPROVEN**.

Safe, non-destructive candidates — **none executed**, each needs its own approval:

1. **Compact the WSL VHDX** (`~35 GB`). Requires `wsl --shutdown` (all distros, including
   `docker-desktop`), then `wsl --manage Ubuntu-24.04 --set-sparse true` or an
   `Optimize-VHD`/`diskpart compact vdisk` pass. Non-destructive to data; interrupts the
   pilot stack for the duration.
2. **`docker builder prune`** (`10.6 GB`). Deletes build cache only; the next build is slower.
3. **Prune superseded `zalo-shared` images** (`≤10.9 GB` of the 10.92 reclaimable). Must be
   by explicit tag — the running images (`zalo-shared:g5-patched-af2be54`,
   `zalo-shared-egress-gateway:g5-patched-af2be54`, `zalo-shared-connector:g5-ci-8d9e39d`,
   `zalo-shared-connector:ci`) are in use and must be excluded.
4. **Clear the user `Temp` directory** (`~1.1 GB`). Only stale scratch files; the scripts from
   this session live there.
5. `C:\Windows\SoftwareDistribution\Download` (`0.39 GB`) — Windows Update cache, safe but
   low value.

Out of bounds under this directive and in general: the VHDX files, named volumes, restore
points, `Windows.old`, unknown application data.

**Export and relocation plan for `D:` (prepared, not executed).** The existing
`D:\WSL-Backups\ubuntu-24.04-ext4.2026-11-09\ext4.vhdx` is **not** a trusted source: it was
copied with `robocopy /J` from the live VHDX (137.263 GB in 5 m 17 s) and the recorded
comparison is `SHA256 MATCH: False` (`a15c32e9…` vs the source hash `c64bb6a6…`), which is
expected for an online copy and makes it a recovery artifact only, never the authority.

1. Quiesce: `wsl --shutdown`, confirm no `vmmem`/`wslrelay` process and no Docker container
   running.
2. Export: `wsl --export Ubuntu-24.04 D:\WSL-Archive\ubuntu-24.04-20261110.tar` (≈90–110 GB
   estimated from the 102 GB of guest data; `D:` has 264.69 GB free). Record SHA-256.
3. Import: `wsl --import Ubuntu-24.04 D:\WSL\Ubuntu-24.04 <tar> --version 2`, then
   `wsl --set-default Ubuntu-24.04` and restore the default user.
4. Verify before retiring anything: boot, `/home/zen/Projects/zalo-shared` at HEAD `cfddd1c`,
   Docker Desktop WSL integration repopulated, pilot containers healthy, database fence
   re-read read-only.
5. Only then `wsl --unregister` the `C:` distro — destructive and separately approved.
6. Keep the exported tar until the `D:` distro has served a full reconciliation window.

## 6. Workstream E — unrelated workloads (inspected only)

No container was started, recreated or removed. All four groups stopped without a restart
policy to bring them back (`restart: no`), so a reboot leaves them down. No compose file for
any of them exists under `/home/zen`, `/opt` or `C:\Users\Admin\Projects`, and the containers
carry no compose labels — so `docker compose up` would risk *recreating* them. The
non-destructive action is always `docker start` in dependency order.

| Workload | State | Exact restore action |
| --- | --- | --- |
| `zena-material-commerce-db-1` (mariadb:11.4) | exited 255 at `06:30:56Z` (reboot), volume `zena-material-commerce_db_data` | `docker start zena-material-commerce-db-1`; wait for `mariadb-admin ping` to answer; no port published |
| `zena-material-commerce-app-1` | exited 255 at `06:30:56Z`, publishes `0.0.0.0:8080->80` | start **after** the database, `docker start zena-material-commerce-app-1`; verify `HTTP 200` on `http://127.0.0.1:8080/wp/wp-admin/`; it was serving normally until the reboot (last request `06:29:09Z`, 200) |
| `zena-lib3-local` (postgres:16.15-alpine) | exited 255 at `2026-11-09T16:35:00Z`, volume `4a8971e7…`, `127.0.0.1:55450->5432` | `docker start zena-lib3-local`; verify `pg_isready -h 127.0.0.1 -p 55450` |
| `zs-pg-test` (postgres:17-bookworm) | exited 255 at `2026-11-09T16:35:00Z`, volume `181ab4e0…`, `127.0.0.1:5432` with an ephemeral host port | `docker start zs-pg-test`; then `docker port zs-pg-test` to learn the new host port before connecting |
| `deer-flow-gateway` | exited 0 at `05:52:51Z` (engine shutdown), `unless-stopped` | `docker start deer-flow-gateway` |
| `deer-flow-nginx` | exited 0 at `05:52:50Z`, publishes `2026/tcp` | `docker start deer-flow-nginx` |
| `deer-flow-frontend` | exited 137 at `05:52:51Z` | `docker start deer-flow-frontend` after the gateway |
| `deer-flow-provisioner` | exited 3 on `2026-09-02`, one-shot job | **do not start**; it is a completed provisioning step, not a service |

Ordering rules: MariaDB before its application; `deer-flow` gateway before frontend; the
`postgres` test fixtures are independent. Each start is reversible with `docker stop`.

## 7. Invariants honored

No reconciliation POST, no login, no QR, no provider contact, no observe/send/media, no
control-state mutation, no direct SQL repair, no state reset, no retry or replay, no security
bypass, no container or volume deletion, no WSL export or relocation, no container started for
the unrelated projects, no production deploy, PR #3 still DRAFT and unmerged, no credential
printed, committed or uploaded.

## 8. Verification status

| Claim | Status | Basis |
| --- | --- | --- |
| Private backup ACLs restricted to owner + system principals | PASS | captured before/after, recursive 22-item scan, zero `Users`/`Everyone`/`Codex` ACEs |
| Credential exposure window existed | PASS (identified) | `inspect-before.json` holds the DSN password and `METRICS_TOKEN`; two `Users`-group accounts were enabled |
| Credential rotation completed | **UNPROVEN / not done** | requires Owner authorization |
| Local evidence integrated without rewrite | PASS | 0 behind / 1 ahead, fast-forward push, clean tree |
| Pilot fence unchanged | PASS | read-only transaction, all values above |
| Reconciliation request prepared and unsent | PASS | private file, mode 0600, `notSent: true`, body hash recorded |
| Quiesce procedure valid for the next attempt | PASS (documented) | matches `reconcile-pilot-state.mjs` predicates and the deployment record §12 |
| Execution wrapper for epoch 7 | **NOT PREPARED** | `reconcile-pilot.sh` is incident-bound to 2026-11-07; a new wrapper encodes the Owner's window |
| Storage inventory | PASS | read-only scans |
| Storage reclamation | **UNPROVEN / not executed** | no deletion or compaction |
| Restore-point / shadow-storage inventory | **UNPROVEN** | `vssadmin` needs elevation |
| WSL export + relocation to `D:` | **UNPROVEN / not executed** | plan only; existing `D:` copy fails its checksum |
| Unrelated workloads restored | **UNPROVEN / not started** | actions listed above |

## 9. Remaining Owner decisions

1. **Reconciliation window** — a UTC window and the `evidenceRef` value, plus approval of a
   wrapper for epoch 7 on image `zalo-shared:g5-patched-af2be54`. The transition is
   `uncertain → idle`, epoch `7 → 8`, gap `7 → 8`, `reconciliation_required → false`, audit
   29 `connector.reconciled`.
2. **Credential rotation** — rotate the `zs_app` password and `METRICS_TOKEN` exposed through
   the backup set, with the deployed configuration updated in the same change.
3. **Storage** — approve any of the five reclaim candidates; compaction interrupts the pilot
   stack for a few minutes.
4. **WSL relocation to `D:`** — approve the export/import plan; the current `D:` VHDX copy is
   not a trusted source.
5. **Unrelated workloads** — approve the start-only restore of the eight containers above.
6. **Gateway restart policy** — `restart: no` is why the gateway stays down after a reboot;
   decide whether it should join the application's `unless-stopped` posture.
