# Readiness and evidence

**NOT PRODUCTION-READY. No live Zalo login, production deployment, real customer data or public application endpoint has been used.** The repository is public; runtime credentials and unlicensed upstream application snapshots are excluded.

## Validated simulator revision

Source commit [`a74268c95e8eda5536d5f6429cf21cb62fa2b698`](https://github.com/kha997/zalo-shared/commit/a74268c95e8eda5536d5f6429cf21cb62fa2b698), [hosted CI run40687394289](https://github.com/kha997/zalo-shared/actions/runs/40687394289). Results below come from raw assertion output, not merely the job icon. Machine-readable summary: [ci-validated-results.json](evidence/ci-validated-results.json).

| Gate | Demonstrated outcome |
|---|---|
| Typecheck and production client build | PASS |
| PostgreSQL, concurrency, security, worker crash and offline transport/vault tests | **38/38 PASS**, zero failures/skips in this suite |
| Chromium actual application sessions | **6 browser/security/history cases PASS**, including 4 distinct concurrent staff contexts; 1 explicit placeholder skip for cases covered by isolated PG tests |
| Short API load4/10/25/50 named users | PASS; p95≈40/57/177/248ms, zero request errors; 267 unique logical sends/retries verified |
| 50 users×50 rounds | PASS; 10,050 measured HTTP requests, 2,500 unique logical sends/retries, p95≈86ms; 12.03s measured request window |
| Mock dispatch after loads | PASS; pending/processing0, unknown0, failed0; final queue drain wait9.13s after larger run |
| SIGKILL after simulator acceptance | PASS; original accepted part retained once, interrupted delivery quarantined unknown without resend |
| Unclean PostgreSQL restart | PASS; committed table-content fingerprints match before/after |
| Encrypted fresh restore | PASS; content fingerprints/counts verified before quarantine; sessions0 and dispatchable0 asserted; runtime audit mutation/trigger privileges and restore CONNECT denied |
| Nonroot/private/read-only image smoke | PASS on validated revision |
| Dependency advisory audit | PASS, npm audit0 findings in hosted run |
| Independent scoped code review | Seven P2 findings and follow-up history cases repaired; final scoped review19/19 offline tests, no remaining P0/P1/P2 within its scope, conditional integration gate now evidenced by hosted CI |
| Runtime image scan | CI gate: checksum-pinned official Trivy release, full HIGH/CRITICAL report; fixable findings fail. See latest CI artifact before claiming a clean image. |

These are **simulator/application results**, not proof of four physical workstations, real Zalo delivery/phone coexistence, maximum user capacity, long-term soak, or real-provider throughput. The longer workload was only12seconds of measured HTTP traffic plus dispatch drain; it is not a production soak. Exact runner CPU/memory metadata is in `qa-load*.json` CI artifacts.

## Latest runtime, monitoring and capacity evidence

[Run40724950532](https://github.com/kha997/zalo-shared/actions/runs/40724950532), source9a77cbca, passed the complete CI job. [Machine-readable results](evidence/ci-distroless-results.json) preserve measurements. Compiled JavaScript runs as nonroot in a read-only distroless image; Trivy0.76.1 reported **0 HIGH/CRITICAL findings** at scan time. This is a dated advisory snapshot, not a guarantee of no vulnerabilities. The resolved runtime digest is now pinned in `ops/Dockerfile`; [Pin-validation run40726830070](https://github.com/kha997/zalo-shared/actions/runs/40726830070) also passed the entire job, including38/38 units,6 browser cases, recovery, image smoke and another0 HIGH/CRITICAL scan; see [retained results](evidence/ci-pinned-results.json).

The same run repeated38/38 units and6 browser cases (1 placeholder skip), crash/restart/restore checks, private image smoke and monitoring configuration/rule tests. Monitoring notification delivery has not been deployed or tested.

| Concurrent API users | Rounds | Requests | p95 | Result against 2s target |
|---|---:|---:|---:|---|
| 4 / 10 / 25 / 50 | 3 each | 52 / 130 / 325 / 650 | 45 / 57 / 146 / 271ms | PASS |
| 50 | 50 | 10,050 | 72ms | PASS |
| 100 | 3 | 1,300 | 644ms | PASS in this short workload |
| 200 | 3 | 2,600 | 1,001ms | PASS in this short workload |
| 500 | 3 | 6,500 | 2,191ms | **FAIL latency target**; functional/integrity checks passed |

The pinned rerun illustrates runner variability:100/200/500-user p95≈1105/2072/3334ms, so **200 and500users failed the2s latency target in that run**. Its strict4–50-user profiles still passed;50×50rounds measured10,050requests, p95≈101ms. The earlier200-user success is not a reliable capacity guarantee.

All measured loads had zero request errors and verified idempotent retries. All three final mock queue drains passed with pending/processing0, unknown0 and failed0. These are API clients on a hosted runner, not500 browser staff seats or real-provider throughput. The500-user result establishes a failed latency observation, not a universal capacity ceiling. Artifacts expire after14days; the committed summary retains essential evidence.

## Open live/operating gates

- Offline injectable transport, AES-GCM vault and gated SDK facade remain **unwired into app/worker**. SDK2.2.0 is development-only; actual import/model tests and fake-login facade tests do not establish provider authentication. Real media, durable inbound integration, key rotation and takeover fencing still need implementation/validation.
- A legitimate, dedicated test account/phone/test peer and Owner approval are required before any real login. Never HANU production; never send cookies/passwords through chat.
- Real phone coexistence, delivery/media, invalidation, missed history, reconnect/fencing and7–14day low-volume soak remain UNPROVEN. Platform terms/account-ban risk cannot be removed by tests.
- No maximum staff count or capacity ceiling is established. There is no product seat cap; additional infrastructure/longer workload tests are required before broader promises.
- Four physical workstations, external audit immutability, chosen retention/storage budgets, larger-data restore RPO/RTO and optional unread-filter UX remain separate operating/product decisions.
- Production approval is not granted or implied.

## Traceability

The first baseline [`29c9c7`](https://github.com/kha997/zalo-shared/commit/29c9c7422ce5719e9c39986934edd08ef3c24857) had26passed/2failed units despite a green job because tee hid the upstream failure. This was corrected with an explicit bash/pipefail default. The validated run above reports38passed/0failed in raw logs. Historical reports remain as dated snapshots; read the latest evidence before interpreting earlier pending/failure notes.

Tracking: [implementation#1](https://github.com/kha997/zalo-shared/issues/1), [live readiness#2](https://github.com/kha997/zalo-shared/issues/2), [draft PR#3](https://github.com/kha997/zalo-shared/pull/3).

Image scan evidence: [run40721532703](https://github.com/kha997/zalo-shared/actions/runs/40721532703), commit393e277, passed the functional/recovery/browser stages but failed the new image gate:83HIGH/CRITICAL package findings,25fixable. Baseline retained in `evidence/image-scan-baseline.json`. This is not a clean image. Remediation replaces the general-purpose Node runtime with official distroless Node24/Debian13 (no npm/shell/unused system tools); CI records and builds an immutable resolved base digest, which must be committed before release. Remediated in run40724950532: zero HIGH/CRITICAL findings at scan time; see latest evidence above.

Additional capacity observation at100/200/500users is separate from the enforced50-user latency target. Integrity, idempotency and queue-drain errors always fail; upper-range latency exceedance is reported as a measured boundary, not concealed as a passed SLA. Monitoring CI checks rule semantics only; notification receiver/deployment remains an Owner operating gate.

## SDK contract follow-up

A source-backed follow-up found that the research SDK declares outbound message IDs as numbers while the candidate accepted only strings. The candidate now preserves string IDs, canonicalizes safe integer IDs and holds unsafe numeric precision as unknown. Its regression test first failed, then passed. Independent scoped review found no P0/P1/P2 in that change and reproduced13/13 transport/vault tests; coordinating verification passed20/20 offline tests and the full local build. [Follow-up CI40730035434](https://github.com/kha997/zalo-shared/actions/runs/40730035434) on2dda735c passed **39/39 units,6 browser cases (1 placeholder skip)**, full recovery/restore/monitoring/image gates and another **0 HIGH/CRITICAL** scan. It does not wire a live connector. [Retained measurements](evidence/ci-sdk-contract-results.json):50×50rounds p95≈80ms;100/200/500users≈903/1324/2454ms.500users again failed the2s latency target, with zero request errors and all mock queue drains passed.200users varies across runs, so no stable200-seat or real-provider capacity is claimed. See [SDK contract audit](review/sdk-contract-review.md), [current pilot handoff](operations/LIVE-PILOT.md) and [current-architecture cost assumptions](operations/COSTS.md).

## Pinned SDK foundation — hosted gates pending

Npm `zca-js@2.2.0` is now an exact development dependency, tarball SHA512 matches registry/lockfile, and installation used `--ignore-scripts`. Registry gitHead differs from historical source; no source-to-binary equivalence is claimed. Static artifact review covers192ESM/183CJS reachable modules and selected contracts; [artifact evidence](evidence/sdk-artifact.json), [dependency inventory](evidence/sdk-dependency-inventory.json) and [audit](review/sdk-artifact-audit.md) preserve scope.31resolved SDK graph packages and32supplied notice files are retained; spark-md5's packaged README references a missing MIT LICENSE2, so only its supplied WTFPL notice is verified. Crypto-js4.2.0 is deprecated/unmaintained; live promotion remains an explicit risk gate.

Fresh offline installation from cache with scripts disabled succeeded. Local verification passed34/34 offline application/transport/facade cases,2/2 actual-SDK guarded probe cases and the full TypeScript/client/server build. The probe guards self-test denial of network, filesystem writes and child processes; it imports ESM/CJS and invokes models/constructor only, never login/QR. The gated session facade uses fake SDK login, actual tough-cookie and encrypted CredentialVault in tests.

Independent scoped reviews found two P1s (stale write after timeout and runtime media-input bypass); both were reproduced, fixed and re-reviewed with four new regressions passing. [Facade review](review/sdk-facade-review.md), [facade evidence](review/sdk-facade-report.md) and [foundation review](review/sdk-foundation-review.md) retain initial findings and limits. Hosted advisory/signature verification, integration and SDK-free image gates are pending for this new revision. No real account has been used and no app/worker wiring is enabled.
