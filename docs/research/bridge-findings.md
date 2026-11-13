# zca-bridge + Chatwoot audit (2026-10-27)
Scope: one personal Zalo account shared operationally by four staff through Chatwoot, while owner uses Zalo phone. No real account, messages, credentials or external writes used. No server started; no ports exposed.

## Pinned evidence
Bridge source pin: `1d7fd5946711ab44ef4427561c872ae0ae7e2248` (2026-09-23). Relevant files fetched via connected GitHub tool into `bridge/source`; this is a **partial source snapshot, not a successful git clone or deployed service**. Canonical citation prefix: https://github.com/diendh/zca-bridge/blob/1d7fd5946711ab44ef4427561c872ae0ae7e2248/
Chatwoot independently inspected develop pin: `90ed589c695f6aeaeea0e78f6be7d4ec0fb3e1b3`; snapshot `bridge/chatwoot`. Citation prefix: https://github.com/chatwoot/chatwoot/blob/90ed589c695f6aeaeea0e78f6be7d4ec0fb3e1b3/
These pins were read through GitHub API commits endpoints, not inferred from mutable READMEs.

## Verdict
Best architectural fit among a raw library and a bridge: staff use individual Chatwoot accounts; only the bridge owns personal Zalo session. **Not accepted for production yet.** The source provides meaningful queue, recovery, media, self-message and logging work, but authentication and delivery failure cases require hardening. Four-seat workflow and phone coexistence remain UNPROVEN without live authorized acceptance testing.

## Evidence and results
- PASS (source/license): bridge Apache-2.0, `LICENSE:1`; personal Zalo dependency exactly zca-js **2.1.2**, `package.json:28`, lock `package-lock.json:3838` includes resolved tarball/integrity and MIT metadata. Package version 1.0.4 differs from lock root 1.0.1; not by itself proof npm ci is invalid. No vulnerability scan completed. Root's zca-js 2.2/HEAD tests do not establish behavior of this 2.1.2 pin.
- PASS (source/license): Chatwoot outside enterprise MIT; enterprise code has separate subscription/seat restrictions (`chatwoot/LICENSE:3`, `enterprise/LICENSE:6`). Do not assume enterprise audit features are included free.
- PASS (architecture source): durable PostgreSQL queue with unique(kind,dedup_key), exponential retry/dead-letter states and stale processing reclaim: `src/store/jobQueueRepo.ts:40`, `:50`, `:75`; `src/store/migrations/002_durable_queue.sql:1`; `src/worker/worker.ts:47`. Main inbound key account:msgId and outbound Chatwoot message id: `src/main.ts:184`, `:275`. Database crash/restart recovery UNPROVEN operationally.
- FAIL (security, source + executable synthetic route): Chatwoot webhook URL secret is optional, unset by default. Route does not inspect signatures/timestamp/headers or validate schema (`src/chatwoot/webhookServer.ts:12`, `:40`; `src/config/env.ts:56`). A fabricated unsigned outgoing payload reaches enqueue and returns 200 when secret omitted. Secret segment is bearer authorization and still lacks cryptographic replay protection. Configure mandatory secret immediately, then verify HMAC of raw body with timestamp and bounded replay window.
- PASS (source + synthetic handler): route awaits durable enqueue and returns 500 on failure (`webhookServer.ts:48`). **Do not rely on comment claiming Chatwoot retries**: inspected Chatwoot `lib/webhooks/trigger.rb:26` rescues errors, only re-raises retryable agent-bot failures, not API inbox webhook (`:125`). API inbox errors update message status failed (`:100`). End-to-end retry guarantee FAIL for inspected Chatwoot source; actual deployed version needs validation.
- PASS (Chatwoot source capability): API inbox includes webhook signing secret; listener passes secret/delivery id (`app/models/channel/api.rb:30`; `app/listeners/webhook_listener.rb:139`); trigger signs timestamp.body using SHA256 HMAC in X-Chatwoot-Signature (`lib/webhooks/trigger.rb:54`). Bridge ignores this available mechanism.
- FAIL (source): session absent/reconnecting at send time causes note then successful return/drop (`src/handlers/outbound.ts:62`), so worker marks done rather than retaining until reconnect. Staff must notice failed delivery and manually resend; acceptance criterion of reliable queueing during outage not met.
- FAIL (source): send then persist mapping (`src/handlers/outbound.ts:110`) leaves crash/database-failure gap with possible duplicate send. Incoming non-self creates Chatwoot message before mapping and lacks mapping precheck (`src/handlers/inbound.ts:145`, `:186`), also allows duplicate after create succeeds but completion fails. Queue dedup is not transactional exactly-once delivery.
- FAIL (source): first attachment maps whole Chatwoot message immediately (`outbound.ts:81`); later attachment transient failure throws. Retry sees message mapping and returns at `:56`, potentially dropping remaining attachments. Needs per-attachment progress/idempotency.
- PASS (source + synthetic crypto): credentials AES-256-GCM (`src/crypto/credentials.ts:4`); passwords scrypt, timing-safe comparison and HMAC signed seven-day cookies (`src/admin/auth.ts:3`, `:8`, `:25`). Tests verify roundtrip, wrong password, tampered session.
- FAIL (source + synthetic cookie): login/setup call sessionCookieHeader without secure flag (`src/admin/authRoutes.ts:39`, `:54`), helper defaults omit Secure (`auth.ts:76`). First-run admin bootstrap open to first caller (`authRoutes.ts:33`); no login throttle visible in inspected auth routes. Require protected bootstrap, TLS and Secure cookies/rate limiting before external exposure.
- FAIL (deployment defaults/source): server binds all interfaces (`src/main.ts:377`), compose publishes 4000:4000, floating latest image and example DB password zca (`docker-compose.full.yml:17`, `:31`, `:39`). Despite filename, inspected full compose only includes bridge and bridge-db: Chatwoot must be deployed independently. Pin immutable images; change credentials; bind 127.0.0.1 and terminate authenticated HTTPS proxy.
- PASS (source existence): reconnect supervisor loads stored credentials, guards overlapping connection, persists cookies, backoff and auth-error -> expired handling (`src/zalo/reconnectSupervisor.ts:66`, `:90`, `:115`, `:167`); adapter explicitly starts retryOnClose true (`src/zalo/zcaAdapter.ts:18`). Real reconnect and phone web-session conflicts UNPROVEN.
- PASS limited (source): native phone messages imported as outgoing and mapping suppresses echoes (`src/handlers/inbound.ts:198`, `:221`; `outbound.ts:56`). All sends on Zalo still appear from same personal identity. Chatwoot agent attribution does not prove Zalo transport identity or an immutable audit trail.
- FAIL (audit durability/security source): persisted DB logs redact by selected key names, buffer in memory with cap and prune to 10,000 rows (`src/logging/dbLogStream.ts:5`, `:64`, `:86`). Full errors also go stdout (`src/main.ts:90`). Logs are operational evidence, not tamper-evident per-agent audit. Free-text URLs/errors can retain sensitive values; signed URL query in outbound download error (`outbound.ts:207`) not necessarily covered by key redaction.
- UNPROVEN: four concurrent staff login/assignment/collision behavior, all real Zalo message types, phone coexistence, complete history/backfill, offline gap recovery, delivery/read receipts, restore from backups and sustained load. No unsupported claims of full sync.

## Reproducible commands and limitations
Original attempt:
```sh
git clone https://github.com/diendh/zca-bridge.git /workspace/zalo-study/bridge/source
# failed: unable to connect to configured proxy:8080
```
Fallback used connected `github_fetch` for `https://api.github.com/repos/diendh/zca-bridge/commits/main` and raw files at full pinned SHA. Existing source files were not modified.
```sh
cd /workspace/zalo-study/bridge/source
npm ci --ignore-scripts --fetch-retries=0 --fetch-timeout=10000
# failed EPERM connecting to proxy for registry.npmjs.org/zca-js/-/zca-js-2.1.2.tgz
node /workspace/zalo-study/bridge/synthetic.mjs
```
Synthetic harness executes unmodified dependency-free original webhook/auth/crypto modules with Node v24.19.0 type stripping and an in-memory Fastify-shaped double, no network/database. Four positive groups PASS: parser, enqueue rejection handler, password/session, crypto. Two negative security criteria confirmed FAIL: unsigned request and cookie Secure omitted. Exit 0 means assertions describing observed behavior passed, not security acceptance. Initial harness incorrectly expected verifySession to return string, corrected to its documented object username before rerun. This is **not** an HTTP integration test or deployed POC. Full npm tests/build/Docker/Chatwoot deployment UNPROVEN due missing dependencies/network, and partial snapshot is not buildable independently. No real QR login attempted.

For a later complete checkout: git checkout exact pin, npm ci, npm run build, npm test, provision independent Chatwoot + Redis/Postgres and bridge Postgres with fresh synthetic-only secrets, override ports to 127.0.0.1, mock ZaloAdapter. Test duplicate callbacks, worker kill after remote send before map commit, DB failure during inbound enqueue, reconnect during queued send and attachment N failure after attachment1 success. Live phone coexistence requires separate explicit real-account authorization; do not infer it from mocks.

## Additional executable outbound failure demonstrations
Run `node /workspace/zalo-study/bridge/outbound-synthetic.mjs` (Node v24.19.0). Output saved in `bridge/outbound-synthetic-results.txt`; exit 0 confirms assertions about failure behavior, not production acceptance. The harness reads original pinned `OutboundHandler` and `Worker`, transforms TypeScript with Node's `stripTypeScriptTypes`, replaces import declarations with isolated doubles, and executes original dispatch/send/map/retry logic. HTTP, account repository, queue storage and Zalo sessions are in-memory synthetic doubles; no network listener or real account is used.

- **FAIL demonstrated, no-session delivery:** a worker tick dispatches an outgoing text with session absent. Actual handler returns after one agent note; actual worker marks job `done`; zero transport sends. This is an executable source-level failure, no longer only static evidence.
- **FAIL demonstrated, partial attachment delivery:** attachment one succeeds and stores message mapping; attachment two throws a transient transport error. Actual worker places job pending. On next tick actual handler's mapping precheck skips it and actual worker marks done; HTTP request and transport call counts stay at two, proving second attachment is never retried.

These are source-level mocked demonstrations, not PostgreSQL, HTTP, Chatwoot or real Zalo integration tests. They establish deterministic bridge control-flow defects at the pinned revision without making assumptions about zca-js 2.1.2 internals.

