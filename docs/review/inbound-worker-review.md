# Private inbound worker independent review

Verdict: **no concrete P0/P1/P2 identified in the reviewed worker source; accepted conditionally on hosted SQL/concurrency/recovery and application integration evidence**. This is a bounded injected-library review, not actual CDN, phone or production acceptance.

## Scope and method

Read `server/media-worker.ts`, the current receipt/job helpers and schema, `tests/backend/media-worker-boundary.test.ts`, and all six scenarios in `tests/backend/media-job-flow.test.ts`. Cross-checked the receipt quota/provider lock order, ownership admission interfaces, locator cipher and bounded downloader contracts. No product changes, PostgreSQL attempts, network, real SDK/account use, commits or subagents were performed. Only this report was authored.

Independently executed:

- `node --import tsx --test --test-isolation=none tests/backend/media-worker-boundary.test.ts`: **8/8 PASS**, zero failed.
- `npm run typecheck`: **PASS**, exit0.

The real PostgreSQL scenarios were inspected but not run locally. Existing local EPERM restrictions are not SQL passes.

## Assessment

- Before pool access the worker validates the current admitted ACCOUNT owner/token, decimal epoch, bounded storage budget, cipher methods and network-policy shape. It snapshots the token and policy. Local ownership checks precede admission/claim and follow the GET; transaction-local matching active owner row SHARE locks protect claim/completion. Provider reconciliation gates prevent GET and materialization while quarantined. A lost owner or pooled connection cannot turn a late response into ready bytes.
- Two database session lanes bound healthy cross-caller work. A separate per-job session advisory lock prevents a worker on another lane from recovering a still-active processing job. Hash collisions conservatively serialize unrelated jobs rather than authorize cross-job access. The in-process two-call counter remains held until the GET settles, including after a database session disappears. This assumes the prescribed single admitted connector process; database lock release itself is not external egress fencing.
- Pool acquisition and individual pooled queries have two-second deadlines. Late acquisition is discarded before querying; errors/end/timeouts destroy the checked-out client and never return a failed or transaction-bearing client reusable. Late query completion cannot revive local state. Session locks are released on healthy cleanup; uncertain paths discard the session. Fixed public errors omit causes, locators and database exception text.
- Claim and completion take owner, conversation, event and job locks before changing a specific ACCOUNT job. Completion takes the quota advisory lock before its provider-state SHARE read, matching receipt admission's quota-before-provider ordering. Claim does not subsequently acquire quota while holding its provider-state read lock. The authored cross-conversation lock-order scenario is relevant positive coverage, but only hosted execution can establish the SQL race behavior.
- Exact receipt projection/linkage controls whether held work is eligible. Staff echoes reuse an existing confirmed part attachment and do not initiate another download; unresolved or unprojected events remain held. Matching message/event/job identity and descriptor fingerprint/category/name are checked before claim. Processing is committed before GET, attempts are bounded to three, and recovery requires the per-job lock. Only network/timeout failures receive automatic bounded GET retry; this never retries an outgoing send.
- Validated bytes are privately cloned through the shared media validator. Per-job bytes are capped by policy at no more than5MiB. Under the quota lock, the default250MiB budget counts distinct ready inbound attachments with NULL staff owner, excluding staff-owned echo reuses. Attachment insertion, job ready/linkage, ciphertext removal and audit commit atomically. Lost completion acknowledgement does not authorize another attachment: a committed ready job is no longer selected; rollback leaves recoverable download processing. The authored before/after-COMMIT scenarios must run on hosted PostgreSQL.
- Version arithmetic is decimal bigint with terminal handling before the ceiling; stop transitions saturate instead of wrapping. Audits contain fixed reason codes, attempt counts and attachment metadata, not URL/key/body contents. Source contains no outbox or delivery-part state mutation and no SDK send/authentication path.

## Evidence limits and follow-up gates

The six authored SQL scenarios cover native attribution and exactly-once private bytes without send-state changes; two lanes/per-job contention and unlocked processing recovery; expiry/key/content/budget/three-attempt limits; owner loss after GET; rollback versus committed acknowledgement loss; and receipt/completion lock ordering. All remain **UNPROVEN locally** until hosted CI.

The24h check is an eligibility/erasure policy executed by a healthy admitted worker: expired locators are erased when revisited, and completion rechecks age. It is **not** absolute wall-clock deletion while the worker/database is offline, immediate cancellation exactly at the24h boundary, deletion from retained backups, or cryptographic shredding. Retention maintenance, key recovery/rotation and backup policy must state those operating limits explicitly.

Authenticated API/UI projections, retry administration if introduced, global queue/metadata retention, nonempty media-job restart/restore quarantine, whole-delta review and real approved schema/host observations remain later gates. Production adapters are bounded, but injected downloader/cipher implementations are trusted code rather than hostile plug-ins. No actual CDN request, real Zalo delivery, phone coexistence or production readiness is established here.
