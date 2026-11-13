# WSL2 host and Docker pilot recovery — 2026-11-09/10

**Verdict:** `WSL_DOCKER_RECOVERY_BLOCKED`
**Gate:** `G5A_RECONCILIATION_BLOCKED` (unchanged; nothing in this attempt touched the fence)
**Authorization:** Owner "CONTROLLED DOCKER RECOVERY" for `pilot-postgres`,
`zalo-shared-pilot-app-1` and `zalo-shared-pilot-egress-gateway-1`. Infrastructure recovery only —
not a live-operation authorization; unrelated project containers were inspected read-only.

## 1. Summary

The host-level cause of the 2026-11-09 outage (C: full) is resolved: the distro boots, the
repository is clean at `a112327`, and ~854 GB is free inside the filesystem. The pilot stack could
**not** be restored, because Docker Desktop's WSL integration for `Ubuntu-24.04` is no longer
provisioned after the crash: no distro-side helper is launched, and **every** bind mount taken from
the distro resolves to an empty directory inside containers — including a file created seconds
before the test. `pilot-postgres` was recreated with the reviewed configuration (its data volume
untouched) and fails at TLS load because its certificate bind is empty. Repairing the integration
requires restarting Docker Desktop, which §8 of the authorization forbids me to do. That decision
belongs to the Owner.

## 2. Pre-recovery checks (§4)

| Check | Result |
| --- | --- |
| Ubuntu filesystem accessible, capacity | PASS — distro running, systemd `running`, 102 GB used / 854 GB free |
| Docker engine status | PASS — engine up, `deer-flow-*` containers still running |
| Exact reviewed configuration | PASS — `pilot-compose.yml` `3aaaabee…5d74a345b` (identical to `ops/pilot-compose.example.yml`); app compose `4f639451…`; interpolation files `51eea9ea…` and `3a637416…`; live `pilot-postgres` config matched `ops/local/provision-pilot-db.sh` field for field (image digest, hostname, env, command, health check, restart policy, all seven mounts) |
| Named volume intact | PASS — `pilot-postgres-data` present (created 2026-11-03T15:11:30Z), 63 MB, `PG_VERSION` 17, four WAL segments, data directory last written 2026-11-09T14:59Z, not empty |
| Private credentials and TLS intact | PASS — all seven files present with pre-incident timestamps (2026-11-03T22:10–22:11Z, `pilot-connector.env` 2026-11-09T15:03Z) and expected modes (`owner.pw` 0400 root, `server.key` 0600 999:999, `app.pw` 0440 root:999). Digests recorded outside the repository — see §9 |
| No connector or enrollment grant | PASS — no `pilot-connector` container; no `session.enc` anywhere under the pilot tree |
| Recreation cannot alter volumes | PASS — volume identity checked before and after container removal |
| Logs and evidence preserved | PASS — `D:\WSL-Backups\recovery-2026-11-09\logs\` (`pilot-postgres.log` 650 lines, `zalo-shared-pilot-app-1.log` 952 lines, `zalo-shared-pilot-egress-gateway-1.log` 9 lines, `inspect-before.json` 40,931 bytes) |

## 3. What was done

1. **`pilot-postgres` recreated** (not redeployed): the container was removed and recreated from
   the reviewed provisioning recipe with identical arguments — same pinned image digest
   `postgres:17-bookworm@sha256:858bb5e9…`, same hostname, environment, command, health check,
   restart policy and the same seven mount declarations, on the same `zalo-shared-pilot-db`
   network with alias `pilot-db`, no published port. The named volume was never removed,
   re-initialised or written to by this step. New container ID `4c192e05cd40`. The replaced
   container had exited 127 and could not start: its bind sources had been rewritten by Docker
   Desktop to hashed paths under `/run/desktop/mnt/host/wsl/docker-desktop-bind-mounts/…` that no
   longer resolve.
2. **`Ubuntu-24.04` restarted once** (`wsl --terminate` + start). This is a single-distro action,
   not `wsl --shutdown`; the Docker engine and unrelated containers were not stopped. The distro
   cold-booted at 2026-11-09T21:03:27Z and came back healthy; the GitHub Actions runner service is
   active again.
3. **Diagnostic probes, all reverted**: throwaway `--rm` containers binding one existing pilot file
   and one newly created probe file (`/home/zen/zz-bind-probe.txt`, deleted afterwards). Docker
   Desktop's own helper binary (`docker-desktop-user-distro proxy`) was started twice manually to
   test whether the missing agent could be restored; it mounted the expected sources but the
   mounts never reached the engine's view, and the process is not running now.

## 4. The blocking defect

Docker Desktop has not re-provisioned WSL integration for these distros since the crash, so no
bind mount from the distro can resolve.

- `%APPDATA%\Docker\settings-store.json` (last written 2026-11-09T15:32Z, the minute the crash was
  reported) contains `"IntegratedWslDistros": null` and
  `"EnableIntegrationWithDefaultWslDistro": false`.
- Backend log at 2026-11-09T15:24:12Z: the per-distro agent
  (`wsl.exe -d ubuntu-24.04 -u root -e …/docker-desktop-user-distro proxy …`) exited with status 1.
  At 15:31:58Z Docker Desktop cleaned the agent up, re-synced and re-added it ("adding a wsl agent
  for new distro Ubuntu-24.04"), then failed writing the distro's Docker CLI config with
  "Catastrophic failure". That is the disk-full period.
- The backend that has been running since 2026-11-09T18:25:25Z contains **zero** `wslintegration`
  records and only two WSL-related lines in total (a usage counter and one `volumesharer`
  `noopApprover` that approved the pilot mounts with an empty host, i.e. translated nothing).
  It never re-added an agent, not even across the 21:03:27Z distro cold boot.
- Inside the distro: no `docker-desktop-user-distro` process; `/mnt/wsl/docker-desktop/cli-tools`
  is empty, so `/usr/bin/docker` (a symlink into it) is dangling and the `docker` CLI does not run
  inside WSL at all.
- Consequence, measured: a container binding an existing pilot certificate sees a **40-byte
  directory**; a container binding a file created seconds earlier sees a **40-byte directory**.
  PostgreSQL correspondingly fails with
  `FATAL: could not load server certificate file "/var/lib/postgresql/tls/server.crt": no start line`.

This is therefore not a stale-reference problem in the pilot containers: file sharing for this
distro is down for every container, which also blocks the application and the egress gateway
(both mount manifests, keys and state from the same filesystem).

Repair options, both excluded by §8 ("no `wsl --shutdown`, no host-wide Docker reset"):
restart Docker Desktop, or toggle WSL integration for `Ubuntu-24.04` in
**Settings → Resources → WSL integration** and apply (that also restarts the engine). Everything
short of a Docker-Desktop-level restart was attempted and did not restore the integration agent.

## 5. Verification (§6) — not reached

| Item | Status |
| --- | --- |
| PostgreSQL healthy | **FAIL** — starts, then aborts on the empty TLS certificate bind; left stopped |
| TLS `verify-full` | NOT RUN — depends on a healthy server |
| Application healthy | NOT RUN — not started (would fail on the same file sharing) |
| Egress gateway healthy | NOT RUN — not started (same dependency) |
| Allowlist, egress, connector, sessions, delivery work | UNCHANGED / none active; not re-verified, since nothing from the pilot ran |
| Authoritative database state (`uncertain` / epoch 7 / gap 7 / `reconciliation_required=true` / audit 28) | **NOT READ** — the database is not running, so the expected state is neither confirmed nor contradicted |

No reconciliation request, no QR, no provider contact, no observe/send-test, no database reset, no
volume deletion, no certificate or credential regeneration, no image rebuild or substitution, no
network change, no VHDX move, no PR activity, no restart or modification of unrelated containers.

## 6. State left behind

- `pilot-postgres` — recreated from the reviewed recipe, currently **stopped** (deliberately not
  left crash-looping). Its configuration is identical to the pre-incident container; only the
  container identity changed. `docker start pilot-postgres` is all that is needed once file sharing
  works.
- `zalo-shared-pilot-app-1` — untouched, `Exited (127)`; `zalo-shared-pilot-egress-gateway-1` —
  untouched, `Exited (255)`.
- `pilot-postgres-data`, the seven private files, the compose files and the pinned images —
  unchanged.
- `deer-flow-gateway/frontend/nginx` — still running, never touched.
- Windows C: **5.56 GB free** of 465 GB. D: **256.06 GB free**.
- Backup `D:\WSL-Backups\ubuntu-24.04-ext4.2026-11-09\ext4.vhdx` (147,385,745,408 B) preserved,
  `D:` SHA-256 `a15c32e9…d69ef3`. The source digest recorded earlier (`c64bb6a…`) was taken while
  the distro was already running, so `match=False` there reflects a moving source, not corruption;
  the copy is a valid pre-start snapshot and remains **UNVERIFIED against a quiesced source**.

## 7. Unrelated workloads (§7, read-only)

| Container | Status | Dependencies | Recovery need |
| --- | --- | --- | --- |
| `zena-material-commerce-db-1` | `Exited (255)` | named volume `zena-material-commerce_db_data` only | `docker start` should suffice — no bind mounts involved |
| `zena-material-commerce-app-1` | `Exited (255)` | bind `/home/zen/actions-runner-zmc/_work/…/application` → `/var/www/html` | blocked by the same file-sharing defect |
| `zena-lib3-local` | `Exited (255)` | anonymous named volume only | `docker start` should suffice |
| `zs-pg-test` | `Exited (255)` | anonymous named volume only | `docker start` should suffice |
| GitHub Actions runner (`actions.runner.kha997-zena-material-commerce.zmc-linux-wsl`) | active after the distro restart | needs the `docker` CLI inside WSL, which is currently broken with `cli-tools` empty | jobs that use Docker will fail until integration is restored |

Recommendation for these: a **separate** authorization. The three volume-only containers carry no
bind-mount risk and can be started immediately; the zena application and any Docker-using CI job
must wait for the integration fix. None of them was started, stopped or modified here.

## 8. Minimal unblocking action (Owner decision)

1. Restart Docker Desktop (`docker desktop restart`, or quit and reopen it), or toggle
   `Ubuntu-24.04` in **Settings → Resources → WSL integration** and apply. Expect: the engine and
   all running containers restart — `deer-flow-*` will bounce; named volumes and the Ubuntu
   filesystem are unaffected; the distro itself is not shut down.
2. Then the restore is mechanical and can be completed in one pass: `docker start pilot-postgres`,
   verify healthy + `verify-full` + volume contents; `docker compose up -d` for the gateway and the
   application from the reviewed compose files; re-run §6 including the authoritative database
   state, and stop on any mismatch.

If the Owner prefers not to touch Docker Desktop, the alternative is `wsl --shutdown` followed by
reopening Docker Desktop — same blast radius plus stopping the Ubuntu session, so it is not
recommended.

## 9. VHDX relocation to D: (report only, not performed)

- Current: `C:\Users\Admin\AppData\Local\wsl\{1a4ec4c9-…}\ext4.vhdx`, 147,385,745,408 B (137.26 GB).
- Prerequisite: a **quiesced** copy — Ubuntu stopped, Docker Desktop still up — with **both**
  SHA-256 digests equal. The present backup satisfies neither (source was live).
- Capacity: D: has 256.06 GB free; the copy needs ~147 GB plus headroom for the move itself. The
  copy is on the same physical NVMe as C:, so it is logical protection only, not media redundancy.
- Procedure: stop only `Ubuntu-24.04`; copy to `D:\WSL\Ubuntu-24.04` with robocopy `/J /COPY:DAT`;
  compare SHA-256 of both files; `wsl --manage Ubuntu-24.04 --move D:\WSL\Ubuntu-24.04`; start and
  re-verify. Rollback: keep the original VHDX file untouched until the moved distro verifies, then
  the old path can be removed — or the move reversed with the same command.
- Impact: the distro is offline for the duration (tens of minutes for 137 GB). Docker containers
  keep running; nothing else on D: is affected. Never use E: (USB, "Full Repair Needed").

## 10. Private evidence

`D:\WSL-Backups\recovery-2026-11-09\private-digests.txt` holds SHA-256 digests of the secret,
TLS and configuration files (kept outside the repository on purpose);
`…\logs\restore-postgres.log` holds the recreation transcript; `…\logs\inspect-before.json` the
pre-change container inspection. The VHDX backup and its `copy.log`/`sha256.log` remain in
`D:\WSL-Backups\ubuntu-24.04-ext4.2026-11-09\`.
