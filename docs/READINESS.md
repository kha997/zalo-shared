# Readiness and evidence

**NOT PRODUCTION-READY. No live Zalo login, production deployment, real customer data or public application endpoint has been used.** The repository is public; runtime credentials and unlicensed upstream application snapshots are excluded.

## Private pilot review hardening — hosted PASS

A second independent review of the committed pilot runtime, CLI, connector image and CI job found one high-impact defect and several medium issues. All are fixed and the slice passed hosted CI.

- Policy halts now win over the abort they trigger, so an ambiguous send cannot exit 0 as `aborted`. Any halt outside `tick-limit`, `grant-expired` and `aborted` exits non-zero.
- Send-test can actually dispatch: the owned connector publishes `provider_state.status='connected'` after ownership, the UID-bound facade, transport start and `markActive`, in a transaction holding the active owner row `FOR SHARE`, and refuses while `reconciliation_required` is set. Before this fix the provider could never report connected.
- Worker claims are scoped to the grant's exact direct peers, so an out-of-scope staff message is never claimed or marked failed. A denied destination now defers instead of failing.
- The image embeds `/app/build-identity.json` derived from `SOURCE_COMMIT`, the connector lock and the pinned SDK integrity; the runtime refuses a manifest whose build block does not match. `DATABASE_URL` requires TLS for non-loopback hosts.
- The bound account is rejected in every peer allowlist. The scanner walks the image for manifest/key/session/QR files, and CI asserts the embedded identity equals the checked-out commit.
- `startPilotRuntime` re-validates the full manifest (build, consent scope, purpose, shape, freshness) instead of accepting a bare grant-shaped object, and collapses validation errors into the single runtime boundary error.

Hosted [CI 41379964911](https://github.com/kha997/zalo-shared/actions/runs/41379964911) on `a37935a` passed both jobs: **258/258** unit checks, **2/2** guarded offline SDK checks and **9 browser cases + 1 explicit skip, 0 failed**, including the four-staff browser/administrator flow, real-PostgreSQL durability, unclean restart, encrypted restore/quarantine, monitoring and the SDK-free nonroot application image. The pilot job built the separate connector image, admitted the synthetic dry-run, verified `/app/build-identity.json` against the checked-out PR merge commit `b7fe5db` and the connector lock, and reported UID 65532, `zca-js@2.2.0`, `crypto-js@4.2.0`, no private files, no exposed ports and **0 HIGH/CRITICAL (0 fixable)**. The preceding run `39a83ea`/41379789878 exposed one Linux-only boundary-error assertion (257/258); it is fixed in `a37935a` and covered by the hosted run above.

Four-staff acceptance and capacity remained within the short-workload target at the required scale: 4/10/25/50-client p95 **44.7/65.2/145.8/272.9 ms**, 50×50 p95 74.0 ms (10,050 requests, 2,500 idempotent retries verified), 100-client 470.3 ms and 200-client 1155.1 ms; **500 clients FAIL** at 3991.5 ms. There were zero request errors and every mock queue drained. The application has no hardcoded seat cap (the load run creates 10/25/50 accounts); the 1–4 peer bound is a pilot provider allowlist, not a staff limit.

Local evidence for the same source: typecheck and both builds PASS; focused pilot/connector suites **47/47** PASS; full local suite **258 tests, 256 PASS, 2 FAIL**, both the known Windows-only `vault.test.ts` POSIX mode assertions that pass on Linux. The Linux-only runtime branch was also exercised locally with a forced `process.platform`. The connector image built locally with a real identity; the inventory reported UID 65532, `zca-js@2.2.0`, `crypto-js@4.2.0`, the commit identity and no private files. [Review and dispositions](review/private-pilot-runtime-review.md).

### Third-pass review remediation — hosted PASS

A follow-up independent pass over the same slice raised seven additional issues; all are fixed in `44b677f` and covered by focused regressions.

- A provided worker scope is now validated before any lock or query: an empty, duplicate, malformed or absent `peers` list throws instead of silently widening the claim to the whole account. The interrupted-dispatch sweep is also limited to the scope, so a pilot no longer quarantines out-of-scope staff mail; the normal owner recovers those rows.
- A deferred destination now returns `processed:false`, so the main worker backs off instead of reclaiming the same row in a hot loop. The row and its parts remain `pending` and are never marked failed.
- The CLI restricts the operator-visible `gate` to the reviewed halt literals and maps any unknown or corrupted runner string to `runtime-error`, so a future reason cannot leak identifiers to stdout.
- `startPilotRuntime` now contains module loading and pool construction inside its single boundary error, matching the rest of the preflight.
- QR bootstrap validates the private key, session envelope and both private directories (or creates them 0700) before acquiring ownership, so a wrong path or mode cannot bump the connector epoch or quarantine provider state.
- The in-image build identity remains build-derived, not content-hashed: the trust anchor is the CI-built image digest recorded externally, and the runtime cannot attest its own provenance from inside the container. Deployment must pin that digest. Dry-run remains shape-only and intentionally reads no image file. This limitation is recorded in the review.

Hosted [CI 41381303200](https://github.com/kha997/zalo-shared/actions/runs/41381303200) on `44b677f` passed both jobs: **266/266** unit checks, **2/2** guarded offline SDK checks, **9 browser cases + 1 explicit skip, 0 failed**, plus the pilot image job. The image identity was verified against the checked-out PR merge commit `e5fb987` and the connector lock; the inventory reported UID 65532, `zca-js@2.2.0`, `crypto-js@4.2.0`, no private files, no exposed ports and **0 HIGH/CRITICAL (0 fixable)**. Load p95 was **60.9/74.9/228.7/418.0 ms** at 4/10/25/50 clients and 108.8 ms for 50×50; 100/200-client p95 was 880.3/1791.4 ms; **500 clients FAIL** at 4210.8 ms. There were zero request errors and all mock queues drained. [Retained measurements](evidence/ci-pilot-third-review-results.json).

Local evidence for the working slice: typecheck and both builds PASS; focused pilot/connector/worker suites **50/50** PASS; full local suite **266 tests, 264 PASS, 2 FAIL**, both the known Windows-only `vault.test.ts` POSIX mode assertions that pass on Linux.

### Follow-up review pass — hosted PASS

An independent re-audit of `44b677f` found no P1 or introduced regression, with three residuals and one incomplete fix. They are fixed in the follow-up slice:

- The session and QR view directories are validated (or created 0700) before bootstrap acquires ownership, not only when first written.
- A non-string runner halt (`42`, `null`, an object, a boxed string) is now a safety failure; it previously fell through as absent and exited 0.
- Publication re-checks the live transport and admission immediately before `COMMIT`, rolling back if the transport dropped during the round-trip. The in-process guard is not a database fence; the residual microsecond window is documented and cannot dispatch because `provider.connected()` also requires a connected transport and admitted owner.
- Observe mode now passes the grant peer scope too, and inbound re-checks the guard after the ownership fence await and before persistence.

Local evidence for the follow-up: typecheck and both builds PASS; focused pilot/connector/worker suites **52/52** PASS; full local suite **268 tests, 266 PASS, 2 FAIL**, both the known Windows-only `vault.test.ts` POSIX mode assertions.

Hosted [CI 41382664808](https://github.com/kha997/zalo-shared/actions/runs/41382664808) on `cc6614c` passed both jobs: **268/268** unit checks, **2/2** guarded offline SDK checks, **9 browser cases + 1 explicit skip, 0 failed**, all durability/restart/restore/monitoring/image gates, and the pilot job. The dry-run was admitted; the image identity was verified against the checked-out PR merge commit `fee2b21` and the connector lock; the inventory reported UID 65532, `zca-js@2.2.0`, `crypto-js@4.2.0`, no private files, no exposed ports and **0 HIGH/CRITICAL (0 fixable)**. Load p95 was **42.5/54.4/150.9/273.9 ms** at 4/10/25/50 clients and 80.2 ms for 50×50; 100/200-client p95 was 657.9/993.4 ms; **500 clients FAIL** at 2370.5 ms. There were zero request errors and all mock queues drained. The 200-client result is run-dependent (it failed in both earlier runs), so no stable 200-seat or provider capacity is claimed. [Retained measurements](evidence/ci-pilot-followup-results.json).

| Claim | Status |
|---|---|
| Policy-halt exit, real dispatch path, peer-scoped claims, image build identity, self-peer rejection, TLS rule, boundary error | PASS locally and hosted at `a37935a` |
| Exact-scope validation, scoped interrupted sweep, deferral backoff, CLI halt allowlist, preflight containment, bootstrap ordering | PASS locally and hosted at `44b677f` |
| Non-string halt rejection, pre-ownership directory validation, commit-time publication re-check, observe scoping, post-fence inbound guard | PASS locally and hosted at `cc6614c` |
| Four-staff browser acceptance and 4/10/25/50 capacity | PASS hosted; 500-client p95 FAIL |
| Live send-test against a real account or peer | UNPROVEN — requires Owner activation |
| Production readiness | NOT ESTABLISHED |

## Private pilot runtime, connector image and gate review — hosted PASS

The `f9ac8e5` slice adds a bounded pilot driver (`tools/pilot-runtime.ts`): a single-lifetime owned connector, pre-start abort handling, grant shape/lifetime/peer/budget/interval validation, observe mode that never constructs a dispatcher, send-test ticks at `max(2000 ms, grant.minIntervalMs)`, policy-halt propagation, and an exact direct-peer inbound gate bound to the grant account. Session envelopes carry an explicit `keyId` bound into AES-GCM AAD, so key rotation is explicit and cross-id reads fail. The CLI now maps safety halts (`runtime-error`, `already-reserved`, `reservation-denied`, `dispatch-uncertain`) to exit 1 and exposes only bounded tick/rejection counters. A separate SDK-bearing connector image (`ops/Dockerfile.connector`) uses a dedicated exact lock, runs as UID 65532 with no ports, and defaults to dry-run; a hosted `pilot` CI job builds it, runs the dry-run with a synthetic owner-only manifest, inventories `zca-js`/`crypto-js`, and scans it.

Hosted [CI 41377272040](https://github.com/kha997/zalo-shared/actions/runs/41377272040) on `105f2d7` passed both jobs: **251/251** unit checks, **2/2** guarded offline SDK checks and **9 browser cases + 1 explicit skip, 0 failed**, plus the pilot job. The connector dry-run was admitted with a synthetic manifest; the inventory reported `uid=65532`, `zca-js=2.2.0`, `crypto-js=4.2.0`, no exposed ports, and Trivy 0.76.1 reported **0 HIGH/CRITICAL, 0 fixable**. The first pipeline run for this slice (`f9ac8e5`, 41376771110) passed every substantive pilot step but failed evidence upload because the owner-only synthetic manifest was inside the artifact path; the manifest is now generated in `$RUNNER_TEMP` and the rerun is green. [Retained measurements](evidence/ci-pilot-runtime-results.json).

4/10/25/50-client p95≈63.0/88.8/204.6/392.7 ms and 50×50 p95≈111.3 ms; 100-client p95≈945.7 ms; **200 and 500 clients FAIL the 2 s target** in this run (2102.1/3372.0 ms) with zero request errors and all mock queues drained. Short synthetic API workloads do not establish provider throughput or staff-seat capacity.

Local evidence matches the hosted result for this slice: `npm run typecheck`, `npm run build` and `npm run build:connector` PASS; focused pilot/connector/QR/recovery suites **59/59** PASS; full local suite **253 tests, 251 PASS, 2 FAIL**, both the known Windows-only `vault.test.ts` POSIX mode assertions that pass on Linux. The recovery drill covers ciphertext+key restore, wrong-key, wrong-account, corrupted and truncated envelopes, and refuses an expired grant before connector start. It was committed as `f84b777` and passed hosted [CI 41378053199](https://github.com/kha997/zalo-shared/actions/runs/41378053199): **253/253** unit checks, **2/2** guarded SDK checks, **9 browser cases + 1 skip, 0 failed**, plus the pilot dry-run/scan job. Load p95 was 67.4/89.0/245.5/456.7 ms at 4/10/25/50 clients, 104.6 ms for 50×50 and 985.7 ms at 100 clients; **200 and 500 clients FAIL** (2272.4/4044.7 ms) with zero request errors. Independent review dispositions are in [private pilot runtime review](review/private-pilot-runtime-review.md) and [connector image review](review/private-pilot-connector-image-review.md); H1, M1–M4 and L2–L5/L7 were fixed with regressions in this slice, L1/L6 are accepted and documented, and the later P1/P2/P3 findings are covered in the section above.

Nothing here validates a real login, QR scan, session interoperability, provider delivery, phone coexistence or account health.

| Claim | Status |
|---|---|
| Bounded loop, grant shape, observe-never-dispatch, halt propagation, inbound sender/account gate | PASS locally and hosted |
| Separate exact-lock connector image, nonroot/no-port dry-run, SDK inventory | PASS locally and hosted |
| Real host runtime drill, phone coexistence | UNPROVEN |
| Media scheduling in the pilot loop | NOT ENABLED (`media:false`) |
| Production readiness | NOT ESTABLISHED |

## Inbound media hosted acceptance — 2026-10-31

[CI41076902601](https://github.com/kha997/zalo-shared/actions/runs/41076902601) on merge `e1cc3d9` (branch head `05c8082d200a78a7017f5a823277e7aa1a7cfe1e` into `787777e`): **171/171** unit checks, **2/2** guarded offline SDK checks, **9 browser cases expected + 1 explicit skip, 0 unexpected**. Raw logs confirm the real-PostgreSQL inbound receipt, provider journal, media worker, private-UI authorization/redaction, four-staff browser flow, ownership/recovery and encrypted backup/restore stages passed. Monitoring and SDK-free nonroot image smoke passed; Trivy 0.76.1 reported 0 HIGH/CRITICAL at scan time.

50×50 rounds measured 10,050 requests at p95≈108.6 ms; 100/200/500-client observational p95≈1117/1767/4749 ms. **500 clients FAIL the 2 s latency target**, with zero request errors, 2500 idempotent retries verified and all mock queues drained. These remain short synthetic API workloads, not provider throughput or staff-seat guarantees.

This evidence supersedes the earlier statement that inbound receipt/jobs/private UI were unvalidated. It does not validate the completion patch below, a long-lived scheduler process, real CDN behavior, real phone coexistence or production.

## Inbound media completion — hosted PASS

[CI41370951223](https://github.com/kha997/zalo-shared/actions/runs/41370951223) on `c1289331493f7bde3439a902f337a18a526eaadd` closes the review findings recorded in [inbound media completion review](review/inbound-media-completion-review.md): bounded ownership-fenced locator retention and one-step media scheduling, a `runMediaOnce()` seam on the owned runtime, queue-full degradation that preserves text ingress, a message-scoped media index, media jobs in counts/integrity, pending/processing restore quarantine, key-coverage refusal with a key-escrow runbook, and attachment authorization limited to `ready` provider media.

The hosted job passed **179/179** unit checks, **2/2** guarded offline SDK checks and **9 browser cases + 1 explicit skip, 0 failed**. Raw logs confirm the real-PostgreSQL receipt/journal/media-worker, ownership-fence, retention/scheduler, private-API and four-staff browser stages, the unclean-restart and encrypted restore drill (including quarantined media and restored fingerprints), monitoring checks and the nonroot/SDK-free image smoke. Trivy 0.76.1 reported **0 HIGH/CRITICAL**. The two Windows-only `vault.test.ts` mode failures observed locally did not reproduce on Linux.

4/10/25/50-client p95≈52.9/66.5/177.9/308.0 ms; 50×50 rounds p95≈123.2 ms; 100/200/500-client p95≈1610.6/1498.2/4132.4 ms. **500 clients FAIL the 2 s target** in this run, with zero request errors and all three mock queue drains passing. These remain short synthetic API workloads, not provider throughput or staff-seat guarantees.

| Claim | Status |
|---|---|
| Retention, scheduler, owner fence, quota degradation, restore quarantine, ready-only attachment access | PASS locally and hosted |
| A production/pilot process actually drives `runMediaOnce()` | UNPROVEN — pilot runtime wiring gate |
| Real CDN, cookie-free media, live locator schema | UNPROVEN |
| Metadata/audit/attachment retention and duplicate-egress bounds | OPEN — Owner policy decision |
| Album/multi-item media | NOT IMPLEMENTED |
| Production readiness | NOT ESTABLISHED |

## Private pilot contract — hosted PASS

The committed head `7e66b98a7781bd59cbe3a14ba11d8329d80a8dfe` adds `server/pilot-policy.ts` (exact-key grant/consent validation with expiry, lifetime, build-identity, account, peer, budget and interval bounds), `server/pilot-budget.ts` (transaction-required, advisory-locked, durable per-account/day part budget with idempotent `(message_id,part)` reservations and interval control), the two ledger tables in the provider schema plus backup/count/fingerprint fixtures, and an exact-UID guard in the guarded SDK facade (`expectedAccountId` validated before vault access/import; `getOwnId` checked after login and on every refresh before persistence or API exposure).

Local `npm run typecheck` PASS and the full local suite is **201/203** only because Windows does not honor POSIX `0600` in `vault.test.ts`; the Linux hosted job passed without those failures. [CI 41372493757](https://github.com/kha997/zalo-shared/actions/runs/41372493757) on `7e66b98` passed **203/203** unit checks, **2/2** guarded offline SDK checks and **9 browser cases + 1 explicit skip, 0 failed**, including the policy, budget and identity suites, real-PostgreSQL budget/ledger fixtures, unclean restart, encrypted restore quarantine, monitoring and nonroot SDK-free image smoke. Trivy 0.76.1 reported **0 HIGH/CRITICAL**. Hosted p95 was 88.3/64.5/169.3/351.3 ms at 4/10/25/50 clients and 168.6 ms for 50×50; 100/200/500-client p95 was 705.3/1819.8/2814.4 ms, so **500 clients FAIL the 2 s target** with zero request errors and all mock queues drained. The independent review is recorded in [private pilot policy review](review/private-pilot-policy-review.md); its P1 null-account consent finding and P2 idempotency/interval/binding findings were fixed with regressions. QR enrollment was later validated in the hosted section below; the pilot runtime/image were later validated in the newest hosted section above. The live host remains unproven.

| Claim | Status |
|---|---|
| Owner consent/grant scope, expiry, build identity and peer/account bounds | PASS locally and hosted |
| Durable per-day budget, interval, idempotency and grant/day boundaries | PASS locally and hosted |
| UID mismatch blocks persistence/API/listener/send and leaks nothing | PASS locally and hosted |
| QR enrollment, private identity confirmation, pilot runtime/image | NOT IMPLEMENTED in this hosted result |
| Live account behavior, phone coexistence, ban risk | UNPROVEN |

## Private pilot QR enrollment and CLI — hosted PASS at ad036f6

The committed slice `ad036f60ae4fa4a8b00cbd72e584c0a0128e1784` adds `adapters/zalo/qr-bootstrap.ts` (owner-checked, expiring-grant QR enrollment: bounded canonical PNG decoding, no `qrPath`, no `saveToFile`/retry, no listener start/send, staged encrypted session write, final-UID and final-cookie-jar checks, synchronous TTY identity confirmation and quarantine signalling), `server/private-pilot-files.ts` (AES-256-GCM session envelope, exclusive temp+rename installs, 0700/0600/non-symlink checks including POSIX ancestor realpath, stale-temp sweep and a private manifest reader) and `tools/pilot-connector.ts` (dry-run default; live commands require `--acknowledge-pilot-risk`, an absolute private manifest, matching grant purpose, Linux host; output carries no account, peer, grant or consent ID). `tsconfig.json` now includes `tools`.

Hosted [CI 41374543813](https://github.com/kha997/zalo-shared/actions/runs/41374543813) on `ad036f6` passed **229/229** unit checks, **2/2** guarded offline SDK checks and **9 browser cases + 1 explicit skip, 0 failed**. The job passed the full PostgreSQL, transport, recovery/restore, monitoring and SDK-free nonroot image stages. This does not cover the uncommitted runtime/image slice above.

Local evidence for the committed slice: `npm run typecheck` and `npm run build` PASS; focused QR/CLI suites **26/26** PASS; full local suite **229 tests, 227 PASS, 2 FAIL**, with both failures the known Windows-only `vault.test.ts` POSIX mode/rename assertions that pass on Linux. The independent review is recorded in [private pilot QR bootstrap review](review/private-pilot-qr-bootstrap-review.md); its P2 view-race and win32/no-follow findings, and all five P3 findings, were fixed. This remains synthetic and offline: no real SDK login, phone scan, session interoperability, runtime dispatch or connector image has been exercised in that run.

## Earlier verified source — operator acceptance, 2026-10-30

[Source4dd6f300](https://github.com/kha997/zalo-shared/commit/4dd6f3009ef5f02ff9e0d9ed2145be0dd5b45b93), [CI41026456993](https://github.com/kha997/zalo-shared/actions/runs/41026456993):145/145units,2/2guardedSDK cases,9browser cases (1skip), including four actual authenticated staff browsers and administrator recovery through private HTTP/PostgreSQL. Exact-ID confirmation preserves original staff attribution without another send. Conflict/gap/fence role/CSRF/session/CAS tests and positive resolved/admin/MAX-version restart/restore fixtures passed. Monitoring and SDK-free image gates passed, Trivy0HIGH/CRITICAL at scan time. [Retained measurements](evidence/ci-connector-operations-results.json).

50×50rounds10,050requests p95≈67ms;100/200/500-user p95≈531/985/2205ms.500FAILS the2s target, zero request errors and all mock drains passed. Runner variability prevents a stable200-seat guarantee; these remain short synthetic API workloads.

The first operator run passed145units but failed one browser assertion; the corrected canonical text/checksum DOM passed the rerun. Skipped recovery/image stages in that failed run were not passes. Inbound receipt/jobs/private file UI were not validated by that source; the newer 41076902601 section above validates them. Actual Zalo/phone/CDN, private activation and soak remain open.

## Previous verified foundation — 2026-10-30

[Source945d30f3](https://github.com/kha997/zalo-shared/commit/945d30f34289c00fdc4b7aeb292cfad35972f9b6), [CI40997300485](https://github.com/kha997/zalo-shared/actions/runs/40997300485):136/136units,2/2guardedSDK cases,6browser cases (1skip), nonempty conflict variants/journal/media/ownership restart and encrypted restore, monitoring and SDK-free image gates PASS. Trivy0HIGH/CRITICAL at scan time. [Retained measurements](evidence/ci-inbound-foundations-results.json).50×50rounds p95≈109ms;100/200/500-user p95≈790/1872/3855ms;500FAILS the2s target. Zero request errors and all mock drains passed.200varies across runs; no staff-seat/provider capacity guarantee.

Inbound parser/cipher/downloader are reviewed libraries, not integrated download jobs or verified real CDN contracts. Operator service/HTTP/UI is being integrated and is not validated by this source. Real phone, live delivery, account-ban risk acceptance, private activation and soak remain open. Earlier sections below are historical snapshots.

## Historical simulator baseline

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

- The application app/worker remains provider-disabled/mock and its production image stays SDK-free. The uncommitted tree adds a separate pilot host path and SDK-bearing image, but neither has a live drill; the owned runtime is single-lifetime and fails closed. SDK 2.2.0 is development/pilot-only; actual import/model tests and fake-login facade tests do not establish provider authentication. Real media scheduling in the pilot loop, key rotation and takeover fencing still need implementation/validation.
- The pilot peer allowlist is capped at 1–4 consenting peers by policy. This is a pilot safety scope, not a product seat limit: the application itself has no seat cap and has passed four-staff browser acceptance; capacity beyond four staff remains an infrastructure/load question, not a hardcoded product constraint.
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

## Pinned SDK foundation — offline and hosted gates validated

Npm `zca-js@2.2.0` is now an exact development dependency, tarball SHA512 matches registry/lockfile, and installation used `--ignore-scripts`. Registry gitHead differs from historical source; no source-to-binary equivalence is claimed. Static artifact review covers192ESM/183CJS reachable modules and selected contracts; [artifact evidence](evidence/sdk-artifact.json), [dependency inventory](evidence/sdk-dependency-inventory.json) and [audit](review/sdk-artifact-audit.md) preserve scope.31resolved SDK graph packages and32supplied notice files are retained; spark-md5's packaged README references a missing MIT LICENSE2, so only its supplied WTFPL notice is verified. Crypto-js4.2.0 is deprecated/unmaintained; live promotion remains an explicit risk gate.

Fresh offline installation from cache with scripts disabled succeeded. Local verification passed34/34 offline application/transport/facade cases,2/2 actual-SDK guarded probe cases and the full TypeScript/client/server build. The probe guards self-test denial of network, filesystem writes and child processes; it imports ESM/CJS and invokes models/constructor only, never login/QR. The gated session facade uses fake SDK login, actual tough-cookie and encrypted CredentialVault in tests.

Independent scoped reviews found two P1s (stale write after timeout and runtime media-input bypass); both were reproduced, fixed and re-reviewed with four new regressions passing. [Facade review](review/sdk-facade-review.md), [facade evidence](review/sdk-facade-report.md) and [foundation review](review/sdk-foundation-review.md) retain initial findings and limits. [Hosted CI40751604115](https://github.com/kha997/zalo-shared/actions/runs/40751604115) onf8167052 passed53/53 backend/transport/facade cases,2/2 guarded actual-SDK cases,6browser cases (1placeholder skip), all recovery/monitoring gates and the explicit SDK-free production image assertion. Npm reported0 vulnerabilities; signature verification returned invalid[]/missing[]; Trivy again reported0 HIGH/CRITICAL. [Retained results](evidence/ci-sdk-foundation-results.json) preserve exact measurements.50×50rounds p95≈97ms;100/200/500users≈971/1566/3711ms.500users failed the2s latency target with zero request errors and all queues drained. This remains a short simulator API workload. [SDK risk matrix](operations/SDK-RISKS.md) separates mitigations from open live-connector hazards. No real account has been used and no app/worker wiring is enabled.

## Connector journal and fresh ingress — hosted gates pending

Next source phase adds a PostgreSQL provider-event journal, scoped dedup/conflict quarantine, exact-ID staff echo reconciliation, held ambiguous self events and native/shared actor-null projection. New table counts/fingerprints and nonempty linked/held/conflict recovery fixtures are included. Independent review corrected quarantine replay, assignment-version, inbound-status and empty-drill gaps; no remaining scoped findings, conditional on hosted PostgreSQL evidence.

Transport now acquires fresh API/listener generations, bounds/cancels handshakes/retries, serializes bounded observed ingestion, drains accepted work on stop and fails closed on persistence/overflow/fault-observer failure. Two reviewed lifecycle races were reproduced/fixed and re-reviewed. Local transport/facade/vault39/39, guarded actual-SDK2/2 and typecheck passed. The complete suite still has PostgreSQL EPERM locally; no SQL/durability success is claimed before hosted CI. Worker bridge and later typed media/ownership/operator controls remain under development; SDK is still development-only, app provider disabled/mock, and no real account was used.

## Connector core hosted acceptance

[Run40908043580](https://github.com/kha997/zalo-shared/actions/runs/40908043580), sourcee31abe21, passed83/83 units,2/2 guarded actual-SDK cases and6browser cases (1placeholder skip). This includes four distinct staff HTTP clients through assignment/idempotent enqueue, real journal/worker, injected SDK-shaped early echoes/native attribution and session invalidation. It does not establish actual phone operation. Independent final review found a P1 cancellation-classification defect, reproduced and corrected it, then accepted the fix with two transport-to-bridge regressions.

Nonempty linked/held/conflict journal fixtures survived unclean PostgreSQL restart and encrypted fresh-database restore; quarantine/runtime-audit assertions passed. Monitoring rule checks and nonroot/read-only/SDK-free image smoke passed, Trivy reported0HIGH/CRITICAL. [Retained results](evidence/ci-connector-core-results.json) preserve measurements. Four/10/25/50-user p95≈64/87/240/445ms;50×50rounds10,050requests p95≈105ms.100/200/500users≈931/1561/4343ms:500fails the2s target. Zero request errors and all three mock drains passed. These are short hosted API workloads, not provider capacity or seat guarantees.

Typed media, lifetime ownership/takeover fencing, privileged reconciliation controls and private activation remain under development. SDK stays dev-only and disabled in the application runtime. No real Zalo account or production deployment was used. Earlier pending notes above describe historical snapshots; this evidence validates the connector-core snapshot only.

## Typed outbound media — hosted gates pending

New source binds attachment UUIDs to original part order and preflights bounded private PNG/JPEG/PDF/plaintext bytes before any text send. Separate Buffer-only facade/transport media operations preserve per-part confirmations and quarantine timeout/ambiguous results. Three independent scoped reviews accepted source conditional on hosted evidence; transport48/48, guardedSDK2/2 and complete build pass locally. Four-staff media HTTP flow and nonempty binding/content recovery fixture are authored but not yet passed on hosted PostgreSQL. Inbound media remains an explicit unsupported placeholder; real upload/phone operation and lifecycle ownership remain unproven.

## Outbound media hosted acceptance

[Run40913017350](https://github.com/kha997/zalo-shared/actions/runs/40913017350), source95783b0d, passed96/96units,2/2guardedSDK cases,6browser cases (1skip), four-staff ordered private-media HTTPflow, partial-confirmation/unknown/no-resend tests, nonempty bound-media/journal unclean restart and encrypted fresh restore. Monitoring checks and SDK-free nonroot image passed, Trivy0HIGH/CRITICAL. [Retained evidence](evidence/ci-connector-media-results.json) records exact scope.

4/10/25/50-user p95≈45/54/119/232ms;50×50rounds10,050requests p95≈81ms.100/200/500users≈774/957/3112ms;500fails the2s target, with zero request errors and all three mock drains passed. Short synthetic workloads do not establish staff-seat/provider capacity.

The guarded actual SDK checks remain import/models/constructor only; injected media sends are not uploads to Zalo. Inbound media is still an unsupported placeholder. Ownership/runtime/control work is separate and unvalidated by this media snapshot. Actual phone coexistence, account identity, network/schema compatibility and low-volume soak remain UNPROVEN. No real account or production deployment.

## Connector lifetime ownership — hosted gates pending

The next source snapshot adds dedicated PostgreSQL lifetime ownership, durable reserved/active/uncertain owner epochs, bounded health checks and explicit admin-attested external fencing. Injected runtime gates factories, dispatch, session persistence and ingress; lost ownership never permits automatic takeover or resend. Three independent scoped reviews accepted source after correcting stale fault-write and late API listener races. Seven controlled store tests and9runtime cases pass; new realSQL/race/crash/restore scenarios still need hosted CI. Ownership rows enter backup fingerprints and restore is always uncertain/disconnected with a required gap review, including previously idle rows. Native outbound actorNULL now displays “Zalo / thiết bị khác”. No actual provider operation is enabled.

## Ownership hosted acceptance

[Run40915139206](https://github.com/kha997/zalo-shared/actions/runs/40915139206), source0f4b4330, passed117/117units,2/2guardedSDK cases and6browser cases (1skip). Ownership contention, stale token/fault, database-session loss, four-staff owned flow and uncertain/no-resend cases passed. Nonempty journal/media/ownership fingerprints survived unclean restart and encrypted restore; restored idle and uncertain owners remain quarantined. Monitoring and SDK-free nonroot image gates passed; Trivy0HIGH/CRITICAL. [Retained evidence](evidence/ci-connector-ownership-results.json).

50×50rounds10,050requests p95≈87ms;100/200/500-user p95≈991/1692/3079ms.500fails the2s latency target. All three mock queue drains passed and request errors were zero. This does not establish real-provider throughput or staff-seat guarantees. Actual phone, external egress fencing, live schema and delivery remainUNPROVEN. Operator controls, inbound download and private activation remain unfinished; real provider stays disabled.

## Fault evidence and private inbound foundations — hosted gates pending

The next source snapshot retains at most8 normalized conflicting variants, preserves canonical evidence and legacy evidence-missing flags, and versions quarantine faults with bigint terminal gates. Independently reviewed source and17filtered offline regressions pass; SQL/cap/concurrency/restore remains pending.

Pure inbound candidate parsing and authenticated locator encryption passed6independent cases. The deny-by-default pinned-public-IP HTTPS downloader passed10independent cases after a reproduced/fixed late response-error defect. Exact ipaddr.js2.5.0 is promoted from the existing locked runtime graph; isolated offline install passed. These libraries are not wired into receipt/download jobs or enabled on any host. Live frame/CDN compatibility, actual download and phone coexistence remainUNPROVEN.
