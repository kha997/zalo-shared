# zca-zalo-service audit

Observed 2026-10-27. Pinned commit **5f3f66f722aaa29e877a258c218de9ae6759df39** (2026-08-25). Source snapshot: `/workspace/zalo-study/service/repo`. All file:line references below refer to that commit; canonical prefix: `https://github.com/leanhluong/zca-zalo-service/blob/5f3f66f722aaa29e877a258c218de9ae6759df39/`.

## Decision for one account, four staff and owner's phone

Potential low-level personal-account bridge, **not a complete or production-ready shared staff inbox**. Four staff should use an upstream inbox with separate identities, assignment, permissions, collision prevention and audit; they must not each establish independent QR sessions. This service has no staff model or identity on sends. Its source explicitly treats a newly logged-in PC/web session as replacing the previous one (`src/sessionStore.ts:59-75`, `src/routes/sessions.ts:83-90`). That is source commentary/design evidence, not an independently verified Zalo platform guarantee. Keeping the real phone active, phone self-echo completeness, web/PC conflict behavior, invalidation, login longevity and reconnect/backfill under real network failure remain **UNPROVEN**.

## Architecture and license

Express + TypeScript HTTP adapter over `zca-js`; QR login or cookie restoration creates an in-memory session, shared listener normalizes events and POSTs to an external upstream. Upstream must store cookies and business data and implement the webhook/session APIs (`src/index.ts:28-49`, `src/sessionRestore.ts:24-62`, `src/listener.ts:39-88`). No browser/staff UI or persistent database in this tree.

`package.json:17-27` requests express ^4.19.2, image-size ^1.2.0, uuid ^9.0.0, zca-js ^2.0.0 and TypeScript ^5.9.3. Lockfile resolves express 4.22.1, image-size 1.2.0, uuid 9.0.1, zca-js 2.1.2, TypeScript 5.9.3. zca-js's lockfile entry declares MIT; that does **not** license this service. The complete 41-blob pinned tree has no LICENSE/COPYING file and package.json has no license field (`private: true` is not a license grant). Obtain service reuse permission/license clarity. No dependency vulnerability scan completed; no claim of CVE cleanliness.

## Critical findings (source unless labeled runtime)

1. **No inbound service authentication/authorization.** `src/index.ts:15-37` mounts all routes with JSON parser/logger only. Sessions and sends do not check SYSTEM_KEY; it is an outbound upstream header (`src/listener.ts:55-58`, `src/sessionRestore.ts:55-57`). Account IDs are session selectors, not authorization. `src/routes/sessions.ts:329-333` permits deletion, and `src/routes/messages.ts:204-241` sends without staff identity. A private authenticated gateway is required. No per-staff audit, roles, assignment or immutable send log exists; console output contains path/account/message metadata.

2. **Cookies are base64, despite the name `cookiesEncrypted`.** `src/routes/sessions.ts:33-44` base64-encodes cookie JSON and `:116-133` returns it with imei/userAgent/phone. QR token is logged at `:108`, `:123`, and request paths at `src/index.ts:18-20`. A leaked token/log plus reachable API can expose account credentials. Actual encryption, tightly restricted status endpoint, log redaction and upstream secrets storage are required. Cookie persistence/encryption/retention is delegated upstream and unverified.

3. **Permanent inbound delivery loss risk.** `src/listener.ts:44-67` sends once, logs non-2xx/errors, has no durable queue, ACK retention, retry or request deadline; callers do not await delivery. Source itself records this limitation. **Synthetic runtime:** repeated same-id message events generated two webhook POST attempts; both returned mocked 503 and no retries occurred during the observation window. The source has no rescheduling path. Recovery history is best effort, not a lossless log.

4. **No dedup or outgoing idempotency in bridge.** `src/listener.ts:305-323` delegates old/live event dedup to upstream msgId; `src/inboundMsgCache.ts:31-66` and `src/msgIdCache.ts:5-28` are 5000-entry reference caches, not delivery ledgers. Missing ids receive new UUIDs (`src/listener.ts:162`, `:315`). Send-text invokes sendMessage per request (`src/routes/messages.ts:204-241`); media retries send operations up to three times (`:104-120`, `:269-277`). Timeout is Promise.race without cancellation (`:87-92`), so an unknown delivery result followed by caller retry can duplicate sends. Require persisted upstream request keys/outbox, reconciliation and same-account serialized operations.

5. **Session/reconnect defenses are partial.** New session adoption stops/removes older entries (`src/sessionStore.ts:125-137`). WS handlers and retryOnClose=true exist (`src/listener.ts:111-136`), and healer allows three scheduled attempts with 30s/120s/300s backoff (`src/sessionHealer.ts:19-26`, `:76-124`). However a failed attempt does not schedule the next attempt (`:106-124`); a new external call/closed event is needed. **Synthetic runtime:** one failed heal callback ran once and stayed at one call. Existing unit test reaches three by explicitly calling healAccount three times. Cookie invalidation restore failure returns false (`src/sessionRestore.ts:82-96`); no automatic QR renewal.

6. **Liveness can mislead.** `src/listener.ts:136-137` marks wsAlive immediately after start, before connected. **Synthetic runtime:** fake listener emitted no connected event yet state was true. Account health uses successful HTTP keepAlive/fetchAccountInfo as healthy, independently of wsAlive (`src/routes/sessions.ts:171-198`). A valid HTTP session therefore does not prove inbound WS delivery. Top-level /health always says ok (`src/index.ts:23-25`), and Docker healthcheck only checks that endpoint (`Dockerfile:17`). Require separate process/readiness/WS freshness metrics and real end-to-end alarms.

7. **Media URL fetch and resource risk.** User-supplied fileUrl is fetched with redirects and fully buffered to memory/disk; no host allowlist, address restriction, content-length cap or abort signal (`src/routes/messages.ts:126-147`). Deadlines wrap rather than cancel work (`:87-92`). This creates source-level SSRF/resource-exhaustion risk if API is reachable; no exploit against external/private hosts was attempted. URLs are partially logged (`:252`). Temp files are removed in normal finally paths (`:287-290`, `:332-335`), but process crash/late unfinished operation cleanup is not guaranteed. Video/voice/sticker/reaction/recall/forward routes exist; real upload compatibility and attachment availability/expiry remain untested.

8. **Default deployment exposure.** app.listen has no host (`src/index.ts:43`) and compose publishes `3100:3100` (`docker-compose.yml:14-15`); these are not loopback-only defaults. Dockerfile runs without a USER declaration. Compose has no persistent service storage; upstream is the persistence boundary. Deploy only behind protected private ingress with explicit loopback/private binding and credential controls; do not expose this API directly.

## Messaging and durability boundaries

`selfListen: true` is set for QR and restore (`src/routes/sessions.ts:22`, `src/sessionRestore.ts:31`). Self messages are forwarded as direction Out (`src/listener.ts:250-264`); phone origin versus staff origin is not identified. Text/media, group and 1:1 parsing, reactions, recall, typing, receipts and friend/group events exist in source, but no real Zalo action was exercised. Catch-up requests user old messages after 1s (`src/listener.ts:552-556`); completeness of past history, lost messages during disconnect and phone synchronization is unproven. Session store is a process Map (`src/sessionStore.ts:9-10`), and quote/reaction reference caches disappear on restart. Restore requires upstream cookies/imei/userAgent and an accessible authenticated session-list endpoint. No HA coordination, leader lock or split-brain protection was found in this tree; operate one listener owner per account.

## Executed evidence and reproduction

The cloud status reported current enforced unrestricted HTTP policy with no credentials. Git clone failed because local proxy:8080 refused connection:

```
git clone https://github.com/leanhluong/zca-zalo-service.git /workspace/zalo-study/service/repo
# fatal: Failed to connect to proxy port 8080
```

No proxy bypass. Used connected GitHub `github_fetch` for `/commits/HEAD` and `/git/trees/<SHA>?recursive=1`, then `github_fetch_file` with exact ref for all 41 blobs. All **41/41 Git blob SHA-1 hashes verified** against `service/source-manifest.json` after preserving exact upstream bytes. This is a pinned source snapshot, **not a successful Git clone**. No production/existing repositories changed; all audit code is under the requested new area. No real credentials, Zalo account or customer data were provided. No servers/listeners were started, so no non-loopback ports opened.

Node v24.19.0 and npm 11.9.0 available; TypeScript compiler/dependencies absent and shell registry network unavailable. Did **not** run npm ci/typecheck/build, Docker, official Node20 test pipeline or complete HTTP e2e. Upstream e2e script itself would attempt real Zalo login with fake cookies (`scripts/e2e-check.mjs:30-38`, `:104-110`), so it was deliberately not executed in this account-free test.

Adapted copies of `src/*.ts` to `service/strip-types-tests`, replacing only local `.js` import suffixes with `.ts`, then used Node24 native type stripping. Run each file directly to obtain individual test counts (the parent Node --test invocation reported only file-level results in this environment):

```
node /workspace/zalo-study/service/strip-types-tests/aliasList.test.ts
node /workspace/zalo-study/service/strip-types-tests/msgContent.test.ts
node /workspace/zalo-study/service/strip-types-tests/sessionHealer.test.ts
node /workspace/zalo-study/service/strip-types-tests/sessionStore.test.ts
node /workspace/zalo-study/service/strip-types-tests/userProfile.test.ts
node /workspace/zalo-study/service/strip-types-tests/audit-poc.ts
```

Observed unit results **46/46 pass**, 5 files: alias 9, content 18, healer 5, store 8, profile 6. Log: `service/unit-tests.log`. This is adapted-source runtime evidence, not a production Node20 compiled build test. Synthetic listener POC replaces the sole runtime zca-js import with an empty FriendEventType fixture, supplies EventEmitter listener and mocked fetch returning 503, and uses purely synthetic IDs/content. POC asserts duplicate POSTs, no retry, optimistic liveness and a failed healer's lack of self-scheduling. Log: `service/audit-poc.log`; reproducible executable: `service/strip-types-tests/audit-poc.ts`. No actual SDK transport, authentication handshake, webhook network listener, staff concurrency UI or live media behavior was proven.

## Required before any pilot

Clarify service license; build/test pinned dependencies under supported Node20 and scan them; add gateway authentication and staff identities/audit; encrypt/restrict session credentials and redact logs; durable event queue/inbox/outbox with dedup and unknown-send reconciliation; explicit single account owner lock; cancellable bounded media fetch; correct liveness/retry scheduling and alarms. Only then conduct a separately authorized test-account pilot covering one phone plus four staff, phone and web/PC concurrent sessions, invalidation/re-QR, restart/expired cookies, outage/backfill, duplicate sends and receipts/media. Those live acceptance gates remain open.
