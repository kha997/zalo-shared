# Independent whole-branch review

Date: 2026-10-28. Reviewer: independent review agent, read-only source inspection. Scope: staged original application relative to the pre-implementation base, requirements in `docs/DESIGN.md`, `docs/API.md`, and `docs/plans/implementation.md`. Review snapshot: `/tmp/zalo-shared-review.patch`, SHA-256 `55d2832b35f8e118e19f1d6de6793bf667009bd9c7d333bbd17f0ed547ea7225`. Source working tree matched staged files during inspection. No real provider, production deployment, network-granted command, or source modification was performed. Later fixes require a follow-up review; findings below describe this snapshot.

## Verdicts

**Specification verdict: partial implementation; simulator pilot acceptance is not complete.** The central shared inbox, named staff without a four-user cap, role enforcement, assignment version checks, durable transactional acceptance, actor-scoped idempotency, protected media, per-part dispatch tracking, explicit uncertain outcomes and safe disabled defaults are present. The implementation deliberately uses polling and an original simulator instead of a live Zalo integration. The user-authorized personal-Zalo operational outcome remains an open separately authorized live acceptance gate, not an achieved result. Even within simulator scope, complete timeline access, maximum advertised upload size, backlog processing, unread filtering, and the full requested acceptance evidence remain incomplete.

**Code quality/security verdict: request changes before declaring the simulator pilot complete.** No P0 or newly confirmed P1 authorization bypass was identified. The concrete P2 defects below affect ordinary product behavior and verification reliability. Earlier security review findings concerning retry after reassignment, transactional actor revalidation, interrupted-dispatch audit, pending-upload quota and restore access restrictions have visible remediations; source inspection alone does not establish all race guarantees.

## Actionable findings

### F1 — P2: legal 5 MiB uploads fail before storage

Location: `server/app.ts:549–553`.

The repeated-group base64 regular expression exceeds V8's regexp stack on a valid base64 string produced from a 5,242,880-byte file, below both the JSON body limit and the advertised attachment limit. This produces HTTP 500 rather than accepting the supported file. This affects ordinary allowed PNG/JPEG/PDF/TXT uploads, regardless of database quota.

Proof executed during this review: the exact expression returned true for 100,000 and 1,000,000 bytes; `Buffer.alloc(5*1024*1024,65).toString('base64')` raised `RangeError: Maximum call stack size exceeded`. An offline `buildApp` injection with a minimal authenticated pool stub and that valid text/plain payload returned `{statusCode:500,error:{code:'INTERNAL_ERROR'}}`; no database connection was reached. Replace the stack-consuming validator with bounded nonrecursive validation/canonical decode validation. Verify an actual 5 MiB upload and malformed input at the boundary.

### F2 — P2: message cursor truncates microseconds and skips stored messages

Location: `server/app.ts:454–466`.

The cursor row's PostgreSQL `timestamptz` is decoded by pg into a JavaScript Date, then passed back into `(created_at,id)<(...)`. Date keeps milliseconds, while PostgreSQL stores microseconds. If a page ends at `.000088`, the next query uses `.000000` and omits the remaining messages in that millisecond. This breaks durable history retrieval without deleting the underlying rows.

Proof by source/data model: `tests/backend/security.test.ts:105` inserts 100 distinct microsecond values in one millisecond and pages by 13; the current query necessarily discards the remaining same-millisecond rows after page one. That PostgreSQL regression has not been executed in this review. Keep the timestamp comparison in SQL, as the conversation-list endpoint now does, or preserve an exact database timestamp string. Require the existing precision regression to pass.

### F3 — P2: UI silently limits shared history to the latest 50 messages

Location: `client/src/App.tsx:230–236`, `client/src/App.tsx:769–828`; server default at `server/app.ts:448`.

Every poll requests the message endpoint without a cursor or larger limit and replaces the timeline with its response. There is no older-message control or page state in the rendered timeline. Once a thread reaches 51 messages, staff cannot read its earliest message through the application; conversation-list pagination does not fix message pagination. The UI describes this as shared history without showing a truncation boundary.

Add bounded timeline pagination with a load-older control and stable merging of live polls, preserve loaded older messages, and guard page requests against conversation/session changes. Verify a thread with more than one page, including a new arrival while an older page is loading. Also add the specified unread filter or explicitly record its deferral; unread badges alone are not an unread filter.

### F4 — P2: worker sleeps after successful dispatch and imposes a fixed backlog ceiling

Location: `server/worker.ts:144–146`.

The loop processes exactly one job and then sleeps 500 ms even when more jobs are ready. This caps the simulator below two logical messages per second independently of available resources. For 50 staff each enqueueing three messages, sleeping alone adds about 75 seconds of queue drain time. The current load runner measures acceptance, so its HTTP latency can look healthy while this backlog grows.

`tests/backend/worker-batch.test.ts` expects twelve jobs within four seconds; the current loop cannot satisfy that bound because the twelfth dispatch follows at least eleven 500 ms sleeps. The PostgreSQL test was not run here. Sleep/back off only when there is no dispatchable work or on an appropriate error; retain the one-worker invariant and safe unknown handling. Verify drain rate and pending age alongside API throughput.

### F5 — P2: stale unauthorized mutation response can log out a newer session

Location: `client/src/api.ts:93–94`; unabortable mutation callers include `client/src/App.tsx:326–357`.

The API helper dispatches a global `session-expired` event for every non-login 401 without checking which session initiated the request. Mutation requests have no lifecycle abort signal. Reproduce with a delayed response: A sends, logs out, B logs in, then A's delayed 401 is delivered. The helper clears B's UI and CSRF state before the caller's `sessionRef` guard can reject the stale result. The same problem occurs after reauthentication as the same user. Existing guards protect successful result insertion, but not this global error side effect.

Associate requests and expiration events with a session generation, and ignore expiration from a superseded generation (or cancel all old-session requests and still guard response side effects). Add a browser test delaying an old mutation's 401 until a new login finishes. This is a session disruption finding, not demonstrated cross-user data disclosure.

### F6 — P2: CI's restore safety drill prints invariants without asserting them

Location: `ops/ci-backup-drill.sh:17–21`; CI runtime credentials at `.github/workflows/ci.yml:21–22`.

The drill prints session count, dispatchable count and PUBLIC CONNECT but returns success for nonzero counts or true CONNECT. A regression removing the restore quarantine updates would still leave this drill green if dump integrity/count checks pass. CI also runs the app/tests as database owner `ci`; this does not exercise the restricted `zs_app` role or verify that runtime cannot alter audit protection. The prior local evidence of runtime CONNECT=false is useful but is not an assertion in the new CI gate.

Make each restore safety condition fail the drill on violation, create/use a restricted runtime login for privilege checks, and assert that that login cannot connect before release or update/delete/truncate/disable audit protection after controlled grants. Test attempted connection, not only PUBLIC ACL. Keep migrations/restores under the separate owner. The restore implementation now revokes PUBLIC CONNECT before restored jobs become visible; this finding concerns verification gaps rather than claiming the previous unprotected restore window still exists.

### F7 — P2: advertised load latency gate does not fail validation

Location: `tests/load/run.ts:186–192`, `tests/load/run.ts:227–233`.

The runner computes `engineeringTargetMet` using p95 <= 2000 ms and zero errors, but its exit condition checks only errors and message count. A run with every request taking 10 seconds can produce `engineeringTargetMet:false` and a green CI step. Either enforce the documented short-workload engineering target or explicitly make it observational and remove any acceptance-gate claim. Record dispatch drain/queue age independently; enqueue throughput does not prove delivery throughput.

## Security and durability assessment

- **Authentication/CSRF:** opaque high-entropy cookies, server-side token hashes, scrypt, bounded login schema, route throttling, current active-user lookup, idle/absolute expiry and same-origin plus CSRF mutation checks are implemented. Cookie flags follow TLS configuration. No public registration or default real credential was found. Expiration, fixation and exact in-flight revocation barriers are not all covered by current executed evidence.
- **Mutation revocation:** `transaction()` takes a shared staff-change advisory transaction lock (exclusive for staff changes), then re-reads and shares locks on current user/session before authorization. This structurally orders staff revocation against mutations. Privileged user/mock handlers recheck admin role; sends/assignments use the refreshed role. Add deterministic barrier tests for revoke/demote and simultaneous requests. Do not interpret this as cancellation of reads that already authenticated or messages already durably accepted.
- **Account isolation:** configured-account scoping precedes message and conversation operations; attachment reads and unbound attachment ownership are checked. Worker jobs are joined through the configured account. Shared access across staff is intentional. The schema does not enforce composite account foreign keys, so internal writes must preserve this invariant; no external route to create a cross-account link was identified.
- **CAS/idempotency:** conversation row locking plus expectedVersion prevents claim overwrite. Existing actor/key/body lookup now occurs before fresh-send assignment authorization; reassignment retry therefore returns the original accepted message. Enqueue/message/parts/audit commit together. Attachment rows are locked before binding. Required regressions are present but the new ones still need execution.
- **Worker/crash safety:** external acceptance is recorded separately in the mock ledger. Interrupted processing is quarantined with message/part/outbox updates and audit in a transaction. Uncertain sends are not automatically resent. A process kill after acceptance is not equivalent to a provider function throwing; dedicated process-kill and multi-part failure tests remain needed. Session-level advisory locking is held on one checked-out client, and try-lock losers release their clients. Provider mocks use another pool connection: a pool configured with `max:1` cannot make progress; default max15 avoids that particular configuration. Live stale-worker fencing remains unproved, as the design correctly states.
- **Media:** private authenticated bytes, safe download disposition, no arbitrary URL fetch, MIME allowlist and signatures, bounded count/size, and serialized per-user pending-upload quota are present. Quota cleanup occurs on a subsequent upload, not on a periodic sweep; sent media has no retention/storage budget. These bounds should be documented. Simulator acknowledgements do not prove transport consumed the media bytes.
- **Offline transport/vault:** no SDK import, QR/login route or live app wiring was found. All 12 transport/vault tests passed in this review. The vault uses AES-256-GCM, random nonce, version AAD, external key copy, exclusive 0600 temporary files and atomic rename; directory-fsync/power-loss durability and operational key recovery are not established. The listener callback is not a durable inbox transaction/acknowledgement boundary, and reconnect tests do not prove gap replay. These are integration/live acceptance gates, not claims that the current disabled app sends live traffic.
- **Operations:** Compose loopback publication, private network, disabled production provider, nonroot/read-only app, distinct runtime role provisioning, encrypted backup and content fingerprints materially improve the baseline. Runtime grants are reapplied separately after restore. Backup quiescence is an explicit operator prerequisite; dump/count/fingerprint operations do not share a database snapshot. Image build/advisory results need actual CI evidence.

## Evidence and remaining gates

Executed independently here: `npm run test:transport` **12/12 passed**, plus the exact base64 validator reproduction and offline authenticated route injection described in F1. Source, tests, CI and operations scripts were inspected. No PostgreSQL, browser, load, external network or real-provider execution was performed in this review.

Existing artifacts report an earlier local **20/20** test suite and browser **3 passed / 1 skipped** with four independent contexts, plus a local restore check of sessions0/dispatchable0/attachment1/runtime CONNECTfalse. These are bounded historical evidence, not a passing result for the current expanded suite. The seven newer security cases and worker-batch case are additional; at least the precision and batch tests target known current defects. There is no load result artifact in the reviewed snapshot. CI configuration is a plan to run validation, not proof that it ran.

Before simulator acceptance: fix the concrete product defects, rerun expanded PostgreSQL and browser suites at the final code revision, test in-flight revocation and stale requests, execute crash/partial-media/persistence scenarios, enforce restore checks, and produce the requested 4/10/25/50 measured workload with queue information. Four contexts remain distinct from four physical workstations. Before any live/production acceptance: approved separate-account authentication, phone coexistence, real text/media/receipt semantics, invalidation/reconnect and history gap recovery, provider-safe fencing, key/restore operations and Owner acceptance remain open. No production-readiness verdict is granted.
