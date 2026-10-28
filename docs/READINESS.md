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

## Current packaging and audit gates

Runtime packaging is being hardened to compiled JavaScript plus production dependencies, removing build/test tools from the final image. Its CI rerun and image scan are required before accepting that packaging revision. Latest results are available on [Actions](https://github.com/kha997/zalo-shared/actions/workflows/ci.yml); artifacts are retained14days. Unfixed HIGH/CRITICAL findings, if any, remain an explicit production-risk decision rather than a claim of zero vulnerabilities.

## Open live/operating gates

- Offline injectable Zalo transport+AES-GCM vault exists and passed12tests, but is **not wired into app/worker and imports no live SDK**. Provider authentication, real media, durable inbound integration, key rotation and takeover fencing still need implementation/validation.
- A legitimate, dedicated test account/phone/test peer and Owner approval are required before any real login. Never HANU production; never send cookies/passwords through chat.
- Real phone coexistence, delivery/media, invalidation, missed history, reconnect/fencing and7–14day low-volume soak remain UNPROVEN. Platform terms/account-ban risk cannot be removed by tests.
- No maximum staff count or capacity ceiling is established. There is no product seat cap; additional infrastructure/longer workload tests are required before broader promises.
- Four physical workstations, external audit immutability, chosen retention/storage budgets, larger-data restore RPO/RTO and optional unread-filter UX remain separate operating/product decisions.
- Production approval is not granted or implied.

## Traceability

The first baseline [`29c9c7`](https://github.com/kha997/zalo-shared/commit/29c9c7422ce5719e9c39986934edd08ef3c24857) had26passed/2failed units despite a green job because tee hid the upstream failure. This was corrected with an explicit bash/pipefail default. The validated run above reports38passed/0failed in raw logs. Historical reports remain as dated snapshots; read the latest evidence before interpreting earlier pending/failure notes.

Tracking: [implementation#1](https://github.com/kha997/zalo-shared/issues/1), [live readiness#2](https://github.com/kha997/zalo-shared/issues/2), [draft PR#3](https://github.com/kha997/zalo-shared/pull/3).
