# G3 offline acceptance

**Baseline:** `feat/shared-inbox` @ `adf8ceca9bd615004486b14ebc07da8475b71a3a` (local clone `/home/zen/Projects/zalo-shared` in WSL2 Ubuntu-24.04).
**Date:** 2026-11-02 (Asia/Saigon).
**Scope:** local, synthetic, mock-provider acceptance only. No Zalo account, QR, cookie, live network call, production deployment or real customer data was used. PR #3 remains Draft.

## Environment and isolation

| Item | Value |
| --- | --- |
| Host | Windows 11 10.0.26100, WSL2 Ubuntu-24.04 |
| Toolchain | Node 24.19.0, npm 11.17.0, TypeScript/Vite/Playwright (Chromium 1248) |
| Application | image `zalo-shared:g2-adf8ceca9bd6` (`sha256:9d3454015db1…`), run as UID 65532 |
| Connector | image `zalo-shared-connector:g2-adf8ceca9bd6` (`sha256:fba2882d3330…`), separate build |
| Database | disposable `postgres:17-bookworm@sha256:858bb5e9…`, container `zalo-g3-db`, loopback `127.0.0.1:54317`, DB `zalo_test` |
| App runtime | `g3-app` on project network `zalo-g3-net`, published only `127.0.0.1:3101`; `g3-worker` same network, no ports (containerised because WSL reaped host-launched processes) |
| App config | `NODE_ENV=test`, `PROVIDER_MODE=mock`, `MOCK_ENABLED=true`, synthetic `.test` admin |
| Unrelated systems | G2 compose stack on `127.0.0.1:3100` left running; no changes to other containers, volumes or services |

The G3 database is disposable. It was reset once, after browser/load capture, to run the restore drill against a clean fixture database; the drill, durability and restart checks therefore ran on that fixture set.

## Commands and outcomes

| Area | Command | Result |
| --- | --- | --- |
| Typecheck + builds | `npm run typecheck && npm run build && npm run build:connector` | PASS — [g3-build.log](g3-build.log) |
| Unit/integration (real PostgreSQL) | `npm test` | **273 pass, 0 fail, 0 skipped** — [g3-unit-tests.log](g3-unit-tests.log) |
| Offline SDK guard | `npm run test:sdk` | **2 pass, 0 fail** — permission-restricted ESM/CJS import, no network/subprocess/write — [g3-sdk-guard.log](g3-sdk-guard.log) |
| Browser acceptance | `npm run test:e2e` | **9 passed, 1 skipped, 0 failed** — [g3-browser.log](g3-browser.log), [g3-qa-browser.json](g3-qa-browser.json), contexts [1](g3-qa-browser-context-1.png)/[2](g3-qa-browser-context-2.png)/[3](g3-qa-browser-context-3.png)/[4](g3-qa-browser-context-4.png) |
| API load 4/10/25/50 | `LOAD_USERS=4,10,25,50 LOAD_ROUNDS=3 npm run test:load` | PASS — [qa-load.json](qa-load.json) |
| Compose topology | `ops/local/check-compose-topology.sh APP_ENV` | PASS — loopback-only ingress, DB private-only — [g3-topology-check.txt](g3-topology-check.txt) |
| Encrypted backup + isolated restore | `ops/ci-backup-drill.sh` in `zalo-g3-db` (quiesced, fresh fixtures) | PASS — [summary](G3-BACKUP-RESTORE-SUMMARY.txt), [log](g3-backup-restore.log) |
| Unclean PostgreSQL restart | integrity fingerprints before/after `SIGKILL` | PASS — 17 identical rows — [before](g3-durability-before.tsv)/[after](g3-durability-after.tsv) |
| App image scan | `ops/scan-image.sh zalo-shared:g2-adf8ceca9bd6` | PASS — 0 HIGH/CRITICAL for the named image — [scan log](g3-app-image-scan.log), [summary](container-scan-summary.json) |
| Connector image scan + inventory | `ops/pilot-scan.sh zalo-shared-connector:g2-adf8ceca9bd6` | PASS — 0 HIGH/CRITICAL, UID 65532, 0 private files — [summary](connector-image-scan-summary.json), [inventory](connector-image-inventory.json) |
| Monitoring config/rules | `ops/check-monitoring.sh` | PASS — promtool config + 3 alert rules — [g3-monitoring.log](g3-monitoring.log) |
| Metrics auth | `/metrics` with/without bearer token | 401 without token, 200 with token; queue/HTTP/provider instruments exported — [g3-metrics.txt](g3-metrics.txt) |
| Windows loopback | `curl.exe http://127.0.0.1:3101/health/ready` and `/` | `{"ok":true}` and HTML login shell — [g3-windows-access.txt](g3-windows-access.txt) |
| Clean app/worker restart | stop/start containers, compare table counts | PASS — counts `messages=6 outbox=3 delivery_parts=4 provider_events=5 media_jobs=5 sessions=0` unchanged, health `{"ok":true}` — [g3-restart.log](g3-restart.log) |
| App/connector separation | `ops/local/check-app-image.sh` | `{"uid":65532,"sdkPresent":false,"connectorArtifacts":false}` — [identity](g3-app-image-identity.txt); connector image contains `zca-js@2.2.0` + `crypto-js@4.2.0` |

Hosted evidence previously committed as `qa-browser.json` and `qa-browser-context-*.png` was preserved; local-run results are stored alongside it under `g3-*` names.

### Load detail (short local API workload, not an SLA)

| Clients | Requests | p50 | p95 | Errors | Idempotent retries verified |
| --- | --- | --- | --- | --- | --- |
| 4 | 52 | 13.8 ms | 68.8 ms | 0 | 12 |
| 10 | 130 | 22.6 ms | 95.2 ms | 0 | 30 |
| 25 | 325 | 31.9 ms | 239.0 ms | 0 | 75 |
| 50 | 650 | 65.9 ms | 395.0 ms | 0 | 150 |

Mock dispatch drained to `pending=0, unknown=0, failed=0` in 2.84 s.

### Topology note

The compose file publishes only `127.0.0.1:3100` and keeps PostgreSQL on the internal `private` network. Docker cannot publish a port for a container attached only to an internal network, so the app joins a non-internal `edge` network; the rendered-config assertion and the running G2 container confirm the loopback-only mapping and private-only database. This does give the app outbound egress on `edge`; host-level egress policy remains the operator control documented in the runbook. The G3 app used an ad-hoc bridge (`zalo-g3-net`) with the same loopback-only publication; the compose topology was validated separately rather than by running G3 through compose.

### Behaviour covered by the passing suites

- Four independent browser sessions claim/send concurrently; agents are excluded from administration; unsafe text is not rendered as markup; send deduplication and CSRF/session checks hold; attachments are bounded.
- 100-message history survives polling and older-page loads; delayed stale mutation 401 does not log out a re-authenticated browser; inbound ordering is preserved against locally appended sends.
- Connector ownership: reserve-before-admission, durable crash guard, admin fencing, `SIGKILL` after provider acceptance quarantines as unknown without resend, stale factories/listeners cannot take over, unknown work is never automatically retried.
- Cross-account isolation: foreign-account conversations and attachments return 404; private API rejects unauthenticated requests.
- Inbound media: expiry, missing key, content checks, budget and GET ceiling; restore re-holds pending/processing media with locator intact and erases expired locators.
- Restore deletes sessions, denies runtime `CONNECT`, preserves provider journal/variant digests, quarantines interrupted outbound work to unknown and leaves never-attempted work pending.

## Defects and deviations

1. **First browser run failed on infrastructure, not product code.** App/worker had been launched as host processes; when the launching WSL session ended they were reaped, so 8 cases hit `ECONNREFUSED`. Re-running the same suite with containerised app/worker produced 9 pass + 1 skip. No product defect was observed in the failure.
2. **Journal fixture must be seeded while quiesced.** With the worker running, the "interrupted processing" fixture was reconciled to `unknown` before the drill precondition, and the drill correctly refused. Re-seeded after stopping app/worker.
3. **Fixture seeder is single-run by design.** Re-seeding a used database conflicts on provider mappings (`DISPOSABLE` guard). The drill was run once on a freshly migrated database.
4. **Image rebuild is not bitwise reproducible.** The independent rebuild has a different image ID but passes the same nonroot/SDK-free assertions; the scan was performed on the Compose-built image that actually served the tests.
5. **One browser scenario skipped locally.** "Last active admin protection and mock-disabled behaviour require an isolated server configuration" was not executed; this is the same skip as the hosted CI distribution and is recorded as UNPROVEN here.
6. **Evidence-provenance fixes after independent review.** Local browser output had overwritten the hosted `qa-browser.*` files; those were restored and local copies kept as `g3-*`. Monitoring, metrics, Windows access, clean restart, build and topology outputs were captured to files instead of existing only as prose. `ops/scan-image.sh` now records the scanned image name in its summary, and the app image was rescanned.

## Limitations / UNPROVEN

- Load is a short local synthetic profile. It does not establish capacity or an SLA; the earlier hosted 200- and 500-client results FAIL the 2 s target and were not re-run here.
- The backup drill generates its age key inside the drill and uses synthetic locator ciphertext; it does not prove pilot locator-key escrow or session-key recovery.
- Image scans are point-in-time (Trivy DB 2026-11-02) and digests are not a refreshed security baseline.
- No live provider, QR, cookie, CDN or account behaviour was exercised; SDK declarations and offline contracts remain the only evidence.
- The isolated-server browser scenario was not executed locally.
- Local HTTP has no TLS; loopback exposure only.

## Independent review

A read-only independent reviewer inspected the acceptance record, logs, JSON evidence, compose change, git state and sanitization. Verdict: **PASS WITH FINDINGS**. It independently confirmed the 273/2/9+1 counts, load percentiles, durability identity, zero HIGH/CRITICAL scan results, connector identity (`zca-js` 2.2.0, UID 65532, no private files, source commit) and that PR #3 is `OPEN` + `isDraft: true`. Its findings (overstated gate wording, unverified compose topology, prose-only checks, missing scan-image attribution, overwritten hosted evidence, fragment-only drill log) are addressed in this revision. A focused follow-up review confirmed the corrected links and artifacts; its residual items were the missing 401 capture, thin restart/build provenance, a lost executable bit and prose-only local-image checks, all since fixed. The backup drill log remains a trimmed fragment, with the explicit summary alongside it. Both reviews were static: they did not re-execute gates or establish live/capacity behaviour.

## Gate

**G3_OFFLINE_VERIFIED (scoped)** — every executed offline check above passed. Explicitly excluded from this gate as UNPROVEN: 200/500-client capacity, the isolated-server browser scenario, pilot key escrow and any live-provider behaviour. The gate does not authorize live login, real provider traffic or production use.
