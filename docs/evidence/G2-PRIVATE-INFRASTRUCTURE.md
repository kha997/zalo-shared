# G2 — Private infrastructure provisioning

Date: 2026-11-02
Source commit for both images: `adf8ceca9bd615004486b14ebc07da8475b71a3a`
Execution checkout: `/home/zen/Projects/zalo-shared` (WSL Ubuntu 24.04)
Compose project: `zalo-shared-g2`
Private material root: `/home/zen/pilot-private/zalo-shared` (outside the repository)

Status: **G2_INFRASTRUCTURE_READY**

No real Zalo authentication, QR enrollment, provider network call, production
data or public listener was used. The connector was executed only as a
no-network `dry-run` against a synthetic manifest.

## 1. Architecture

```
Windows loopback 127.0.0.1:3100
        |
        v
  app (UID 65532, read-only root, cap-drop ALL)
   |                 \
   | private network  \ edge network (loopback-published only)
   v                   (no other members)
postgres:17 (5432/tcp, no host port, internal-only network)

connector image (UID 65532, no ports, not started; dry-run with --network none)
private bind tree /home/zen/pilot-private/zalo-shared/pilot (0700, UID 65532)
```

Services:

| Service | Image / identity | Network | Exposure |
| --- | --- | --- | --- |
| `postgres` | `postgres:17-bookworm@sha256:839fbb5a4942a7758dd93e18b42ea5649807491a0545b5eeeb8f0b8bb11857a5` | `zalo-shared-g2_private` (`internal: true`) | `5432/tcp` container-only, no host port |
| `app` | `zalo-shared:g2-adf8ceca9bd6` ID `sha256:9d3454015db1…` (running image) | `private` + `edge` | `127.0.0.1:3100` only |
| `migrate` (one-off) | `zalo-shared-g2-migrate:latest` ID `sha256:aac42a3b2813…` | `private` | none, exits |
| `worker` (optional) | same build as app | `private` | not started in G2 |
| pilot connector | `zalo-shared-connector:g2-adf8ceca9bd6` ID `sha256:fba2882d3330…` | none | no ports; dry-run only |

Persistent state: named volume `zalo-shared-g2_postgres-data` (driver `local`).
`docker compose down` preserves it; `down -v` is prohibited by the runbook.

## 2. Private material and permissions

All paths are outside the repository. No secret value is recorded here.

| Path | Mode | Owner | Purpose |
| --- | --- | --- | --- |
| `~/pilot-private/zalo-shared` | 0700 | `zen` | private root |
| `…/app.env` | 0600 | `zen` | Compose interpolation and runtime DB URL |
| `…/seed.env` | 0600 | `zen` | one-off seed admin credentials |
| `…/backups/` | 0700 | `zen` | future encrypted backup destination |
| `…/logs/` | 0700 | `zen` | local build/operation logs |
| `…/pilot/` | 0700 | UID 65532 | connector bind root |
| `…/pilot/state/` | 0700 | UID 65532 | encrypted session state |
| `…/pilot/state/view/` | 0700 | UID 65532 | local-only QR view directory |
| `…/pilot/session.key` | 0600 | UID 65532 | 32-byte nonproduction AES key |
| `…/pilot/manifest.synthetic.json` | 0600 | UID 65532 | synthetic dry-run manifest (1,357 bytes) |

Generation: `ops/local/provision-private.sh` creates the tree, generates random
owner/runtime database passwords, the metrics token and the seed admin password
with `openssl rand`, and writes the files without printing values. The connector
subtree is delegated to UID 65532 because the image rejects foreign-owned
mounts; the login user cannot read it. The synthetic manifest is produced by
`ops/local/make-synthetic-manifest.sh` from `ops/ci-pilot-manifest.ts` with the
real `SOURCE_COMMIT`, then installed 0600/65532.

## 3. Build identities

Application image (SDK-free):

```bash
docker build -f ops/Dockerfile -t zalo-shared:g2-<sha> .
# running Compose build: zalo-shared-g2-app:latest
```

Connector image (intentionally SDK-bearing):

```bash
docker build --build-arg SOURCE_COMMIT="$(git rev-parse HEAD)" \
  -f ops/Dockerfile.connector -t zalo-shared-connector:g2-<sha> .
```

Observed:

| Image | Image ID | Result |
| --- | --- | --- |
| `zalo-shared:g2-adf8ceca9bd6` (running) | `sha256:9d3454015db1…` | UID 65532, no `zca-js`, no `dist/connector` |
| `zalo-shared:g2-adf8ceca9bd6-rebuild` (independent build) | `sha256:aac7f4dc68ed…` | UID 65532, no `zca-js`, no `dist/connector` |
| `zalo-shared-connector:g2-adf8ceca9bd6` | `sha256:fba2882d3330…` | UID 65532, `zca-js` 2.2.0, embedded identity matches HEAD |

Connector embedded identity verified by `ops/local/check-connector-identity.sh`:

```json
{"version":1,
 "sourceCommit":"adf8ceca9bd615004486b14ebc07da8475b71a3a",
 "lockSha256":"17dcd25426639f7112b80764bc8aa27f9be2af3acf0aaf0f2cd490c434030c9b",
 "sdkIntegrity":"sha512-pBU0T0/uadH3Neq7yMssUmE769VVuqKhL8YD1HqQQG8e6lkwueAopNu0vhJdqiJRHZdPIEomT2FxRzauOx4pgA=="}
```

The commit, connector lock hash and SDK integrity all match. The two
application builds produced different image IDs (independent builds are not
bitwise reproducible); both pass the nonroot/SDK-free assertion. Runtime trust
therefore rests on the recorded commit-scoped tag plus image ID, not on a
rebuild-equality claim.

## 4. Network exposure

- Application: `127.0.0.1:3100 -> 3100/tcp` (WSL `ss` confirms a loopback-only
  listener). Reachable from Windows at `http://127.0.0.1:3100` (verified by
  `curl` and the browser path reused in G3).
- PostgreSQL: `5432/tcp` inside the container only; `docker port` is empty and
  the database joins only the internal network.
- Connector: no `EXPOSE`, no published ports, executed with `--network none`.
- Edge network has no other members. The app therefore has outbound egress on
  that bridge; provider mode is `disabled`, mock is off and no live credential
  exists. Host-level egress policy remains an Owner operating decision.
- Unrelated workloads: 18 other containers were running before this gate and
  remained running; total running containers rose from 18 to 20 (the two G2
  containers). No unrelated container, volume, network or port was modified.

## 5. Defect found and fixed during provisioning

`ops/compose.yaml` attached `app` only to the `private` network marked
`internal: true`. Docker cannot publish ports for a container attached only to
an internal network, so the declared `127.0.0.1:3100` mapping produced no host
listener (`NetworkSettings.Ports` empty; Windows `curl` refused the connection).
A disposable `nginx:alpine` probe reproduced the behavior: no mapping on the
internal network, a loopback mapping on the default bridge.

Fix: add a non-internal `edge` network and attach `app` to `private` + `edge`.
PostgreSQL remains internal-only, so database isolation is unchanged. The app
container was recreated and the mapping became `3100/tcp -> 127.0.0.1:3100`.
This change is committed with the gate.

## 6. Operational commands

```bash
# Paths
REPO=/home/zen/Projects/zalo-shared
ENVF=/home/zen/pilot-private/zalo-shared/app.env
COMPOSE="docker compose -p zalo-shared-g2 --env-file $ENVF -f $REPO/ops/compose.yaml"

# Build and start the private stack.
cd "$REPO"
docker build -f ops/Dockerfile -t zalo-shared:g2-$(git rev-parse --short=12 HEAD) .
$COMPOSE up -d postgres
$COMPOSE run --rm migrate                       # one-off schema migration
/home/zen/pilot-private/seed-local.sh           # one-off seed; reads ADMIN_* from seed.env
$COMPOSE up -d app

# Health and logs.
curl -fsS http://127.0.0.1:3100/health/live
curl -fsS http://127.0.0.1:3100/health/ready
$COMPOSE ps
$COMPOSE logs --tail 50 app

# Quiesce (safe; preserves data), restart, or recover.
$COMPOSE stop app
$COMPOSE restart app
$COMPOSE down                                   # NEVER add -v against retained data
$COMPOSE up -d postgres app

# Connector offline gate.
cd "$REPO"
bash ops/local/make-synthetic-manifest.sh
bash ops/local/dry-run-connector.sh zalo-shared-connector:g2-<sha>
```

The worker is opt-in (`--profile dispatch up -d worker`) and is not part of the
provider-disabled G2 stack. Backup and isolated restore follow
`ops/backup.sh` / `ops/restore.sh`; they are exercised in G3.

## 7. Verification results

| Check | Result |
| --- | --- |
| PostgreSQL 17 container | healthy |
| App container | healthy, `restart=unless-stopped`, read-only root, cap-drop ALL |
| Health from WSL | `/health/live` and `/health/ready` = `{"ok":true}` |
| Health from Windows loopback | `{"ok":true}` |
| Published ports | app `127.0.0.1:3100` only; PostgreSQL none; connector none |
| Runtime DB role (`zs_app`) | non-superuser, non-createdb; audit UPDATE/DELETE/TRUNCATE denied; can read users |
| Seed | synthetic admin present; one user |
| App image SDK-free | UID 65532, no `zca-js`, no connector artifacts (both builds) |
| Connector identity | UID 65532, `zca-js` 2.2.0, commit/lock/integrity match |
| Connector dry-run | `{"ok":true,"gate":"admitted","purpose":"observe"}`, `--network none` |
| Stop/start cycle | app exits 0, health unreachable while stopped, healthy after restart |
| Unrelated services | unchanged; only project-owned network/volume/containers added |

## 8. Limitations carried forward

- Image builds are commit-bound and identity-verifiable, but not bitwise
  reproducible; trust the recorded tag + image ID.
- The app's edge network provides outbound egress. Live-provider modes remain
  unavailable; egress restriction is an Owner operating decision for the pilot.
- The PostgreSQL volume has no measured RPO/RTO and no backup schedule; G3
  exercises one encrypted backup/restore drill only.
- The connector image and synthetic manifest are offline artifacts. No real
  account, real peer or approved grant exists.
- Docker Desktop's engine is shared with unrelated workloads; G3 load numbers
  are local synthetic observations, not provider capacity.

## 9. Gate decision

**G2_INFRASTRUCTURE_READY — PASS.**

Required services run locally with loopback-only application access, the
database is isolated and least-privileged, private material is outside the
repository with enforced ownership/modes, both images have verifiable
commit-bound identities, the connector dry-run performs no network or vault
work, and no unrelated system was modified. The environment is reproducible
from the committed scripts and commands without any real Zalo access.
