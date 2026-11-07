# G1 — Environment reconnaissance

Date: 2026-11-02
Role: Autonomous Engineering Lead (Qoder)
Repository: https://github.com/kha997/zalo-shared
Working branch: `feat/shared-inbox`
Handoff baseline: `adf8cec` (verified)
PR #3: OPEN, Draft, MERGEABLE (not merged, not deployed)

Status: **G1_ENVIRONMENT_ACCEPTED** (conditions recorded in §7)

This record contains no credentials, QR content, session material, real Zalo
identifiers or production data. All checks are read-only except the isolated
toolchain and clone provisioning described in §5.

## 1. Host and WSL inventory

| Item | Observed value |
| --- | --- |
| Windows edition | Microsoft Windows 11 Pro, 10.0.26100 (build 26100) |
| Logical CPUs (Windows) | 56 (Intel Xeon E5-2680 v4 @ 2.40 GHz) |
| Physical memory (Windows) | 34,277,847,040 bytes (~31.9 GiB) |
| WSL distribution | `Ubuntu-24.04` (default), WSL version 2, state Running |
| Ubuntu release | 24.04.4 LTS (Noble Numbat) |
| Kernel | 6.6.87.2-microsoft-standard-WSL2 |
| init / systemd | `systemd` (PID 1), `systemctl is-system-running` = `running` |
| Linux user | `zen`, UID 1000, GID 1000, home `/home/zen` |
| WSL memory | 23 GiB total, ~12 GiB available, 8 GiB swap |
| WSL disk | `/dev/sdd` 1007 GiB, 85 GiB used (9%), 872 GiB available |
| Passwordless sudo | available (not used for project provisioning) |

Docker Desktop is running and its Linux engine is shared by the Windows shell
and the Ubuntu distribution (same containers visible from both). Engine
`29.6.2`, cgroup v2, Docker root `/var/lib/docker`, Compose `v5.3.1`.

## 2. Toolchain

| Tool | Observed | Assessment |
| --- | --- | --- |
| System Node (WSL) | v22.22.2 | **Insufficient**: `package.json` requires Node >= 24 and `test:sdk` uses `node --permission` |
| Provisioned Node | v24.19.0 at `~/.local/node24` | Matches CI (`24.19.0`) and the Docker builder image; used for all project commands |
| npm | 11.17.0 (with provisioned Node) | `npm ci --ignore-scripts` completed, 178 packages |
| git | 2.43.0 (WSL), 2.50.0.windows.1 (Windows) | fine |
| gh | 2.92.0, authenticated as `kha997`, scopes include `repo` | fine |
| Docker | 29.6.2 / Compose v5.3.1 | fine |
| Python | 3.12.3 | required by the image-scan summaries |
| curl / jq / openssl / xz | present | fine |
| Trivy | not installed | scan scripts download pinned `v0.76.1` with a SHA-256 check on demand |
| Playwright browsers | cached (`chromium-1234`, `chromium_headless_shell-1234`, `webkit-2336`, ffmpeg) | no browser download needed; system libs to be verified in G3 |

## 3. Repository identity

| Item | Observed |
| --- | --- |
| Windows checkout | `C:\Users\Admin\Projects\zalo-shared` (Qoder workspace) |
| WSL execution checkout | `/home/zen/Projects/zalo-shared` (created in this gate) |
| HEAD (both) | `adf8ceca9bd615004486b14ebc07da8475b71a3a` |
| Branch | `feat/shared-inbox`, tracking `origin/feat/shared-inbox` |
| Worktree | clean on the Windows checkout before cloning; WSL clone clean at HEAD |
| Remote | `https://github.com/kha997/zalo-shared.git` |
| PR #3 | `#3`, state OPEN, `isDraft: true`, `mergeable: MERGEABLE`, base `main`, head SHA `adf8ceca9bd...` |

Documents read for this gate: `docs/QODER-HANDOFF.md`,
`docs/operations/PRIVATE-PILOT.md`, the open-gate and capacity sections of
`docs/READINESS.md`, both Dockerfiles, both Compose files, `ops/env.example`,
and `.github/workflows/ci.yml`.

Hosted evidence referenced by those documents (CI 41386800622 on `a810087`,
273/273 units, 9+1 browser cases, pilot dry-run/scan) is treated as historical
context only. No item is marked PASS for G3 on the strength of a remote run.

## 4. Existing services, ports and Docker state (before changes)

systemd services running include `postgresql@16-main`, `mysql`, `redis-server`,
`php8.2-fpm`, `cron`, `rsyslog`, `unattended-upgrades`, the GitHub Actions
runner `actions.runner.kha997-zena-material-commerce.zmc-linux-wsl`, plus
systemd user managers for UIDs 1000/1002/1003.

Listening ports include `0.0.0.0:5432` (system PostgreSQL 16), `0.0.0.0:3306`
and `127.0.0.1:33060` (MySQL), `127.0.0.1:6379` (Redis), `127.0.0.1:5455` (a
local PostgreSQL), `*:2026` (deer-flow nginx), and numerous `127.0.0.1:5xxxx`
development listeners owned by other projects.

Docker inventory: 27 images (~19.2 GB), 31 containers (18 running), 333 local
volumes (~15.4 GB), 509 build-cache entries (~22.2 GB). These belong to
unrelated projects and were **not** modified.

Zalo-specific artifacts from an earlier session were found:

| Artifact | State | Decision |
| --- | --- | --- |
| `zs-pg-test` (`postgres:17-bookworm`, `127.0.0.1:46075->5432`) | running, 5 h | leave untouched; not reused |
| `zalo-shared-connector:local`, `:local-check` | images, 230 MB each | leave untouched; not trusted as current |
| `postgres:17-bookworm` | present (digest pinned in `ops/compose.yaml`) | reusable base image |

Port `3100` (application) and `54317`/`54329` are free. The application
Compose stack publishes only `127.0.0.1:3100`; its PostgreSQL is attached to an
`internal: true` network and publishes no host port, so the occupied host
`5432`/`3306`/`6379` listeners are not disturbed.

## 5. Local adaptations made

1. **Dedicated WSL checkout.** No zalo-shared clone existed on the WSL
   filesystem. A fresh clone was created at `~/Projects/zalo-shared`
   (`feat/shared-inbox`, commit `adf8cec`). The Windows checkout remains the
   Qoder workspace and is kept as a read-only mirror; it will be fast-forwarded
   after each push rather than edited independently.
2. **Node 24 provisioning.** The official `node-v24.19.0-linux-x64` tarball was
   unpacked under `~/.local/node24` and linked into `~/.local/bin`. No system
   package, alternative or global npm prefix was modified.
3. **Dedicated project namespace.** G2 will create only names it owns:
   Compose project `zalo-shared`, network(s) prefixed by that project, a named
   data volume, images tagged `zalo-shared:g2-<sha>` and
   `zalo-shared-connector:g2-<sha>`, and a private directory under the
   project owner's home. No `docker system prune`, volume deletion, network
   removal or restart of unrelated services is permitted.
4. **No public exposure.** Application listener remains loopback-only
   (`127.0.0.1:3100`). The connector publishes no ports. Windows reaches the
   app through Docker Desktop's loopback publishing (verified in G3).

## 6. Constraints and risks carried forward

- The Docker engine is shared with ~18 running unrelated containers. Short
  synthetic load results may vary with host contention; they are not
  provider-capacity claims.
- Node must be selected explicitly (`PATH="$HOME/.local/bin:$PATH"`) because the
  distro default is v22.
- Playwright Chromium is cached but host libraries are unverified; if the
  browser cannot start, `npx playwright install-deps chromium` would modify
  system packages and requires explicit justification during G3.
- The stale `zs-pg-test`/connector images are not evidence and must not be
  confused with this gate's builds; G2/G3 use commit-scoped tags and fresh
  volumes.
- Real Zalo behavior, QR enrollment, provider delivery, phone coexistence and
  ban risk remain UNPROVEN. No live action is authorized in G1–G4.

## 7. Gate decision

**G1_ENVIRONMENT_ACCEPTED — PASS with conditions.**

The host, WSL distribution, toolchain and repository identity are understood
and verified. An isolated execution plan is supported: dedicated WSL clone,
locally provisioned Node 24.19.0, dedicated Compose namespace, loopback-only
application exposure, no published connector ports, and no mutation of
existing services or Docker resources.

Conditions carried into G2:

1. Only project-owned Docker resources may be created or removed.
2. Builds must record `git rev-parse HEAD` and be tagged with that commit.
3. No network call to Zalo, QR generation for a real account, or SDK login.
4. Evidence must distinguish local execution from historical hosted results.
