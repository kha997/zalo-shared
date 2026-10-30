# Connector core implementation plan

Owner delegated implementation/review decisions. Use the existing isolated worktree and synthetic data; do not request design approval or use any real Zalo session. This plan is the next bounded engineering phase, not the entire production acceptance gate.

**Goal:** Connect the transport's observed events and worker's durable attempts through a transactional provider journal, while fixing listener reuse and unobserved asynchronous ingestion.

**Architecture:** PostgreSQL records provider events before projecting messages. Conversation row locks serialize self-echo reconciliation with delivery-part confirmation. SDK transport always obtains a fresh API/listener after interruption and accepts bounded, serial, observed ingestion. The application still defaults to disabled/mock; no environment variable enables real login in this phase. SDK remains development-only and absent from the production image.

**Spec:** docs/DESIGN.md, docs/operations/LIVE-PILOT.md, docs/operations/SDK-RISKS.md and Owner's autonomous development directive.

## Global constraints / review focus

- No production deployment, real account/QR/cookies/customer data, public endpoint or existing upstream repository changes.
- No automatic resend after an operation might have reached the provider. No text/time-based self attribution.
- Events from different account/thread type/thread/direction must not deduplicate each other. Repeated IDs with changed semantic payload are explicit conflicts, never silent overwrites.
- Native/shared self messages have actor_id NULL; app echoes retain the original staff actor. Ambiguous self events stay held in the journal.
- Stop rejects new callbacks but drains previously accepted bounded events. Persistence/overflow failure is observed and stops transport; do not claim no loss before durable local receipt or history recovery.
- SDK reconnect must never restart an already used listener. Old socket events cannot reset a fresh API/listener generation. Retry and handshake timers are bounded/cancelled.
- New tables must participate in backup counts/content fingerprints and restoration, with runtime audit restrictions preserved.

## Task1 — durable provider store

Files owned: server/provider-schema.ts (new SQL DDL), server/provider-store.ts, server/db.ts (migration import/call), tests/backend/provider-store.test.ts, ops/{integrity.sql,backup.sh,restore.sh,ci-backup-drill.sh} only as necessary for new table coverage; docs/review/provider-store-report.md.

Interfaces:

```ts
interface ProviderEvent {
  threadType: 0 | 1; threadId: string; providerId: string; senderId: string;
  isSelf: boolean; kind: 'text' | 'unsupported'; text?: string;
  clientId?: string; providerTimestamp?: string;
}
ingestProviderEvent(pool: pg.Pool, event: ProviderEvent): Promise<{
  eventId: string; messageId: string | null;
  duplicate: boolean; held: boolean; conflict: boolean;
}>;
recordPartAccepted(db: pg.PoolClient, messageId: string, part: number, providerId: string): Promise<void>;
reconcileSelfEvents(db: pg.PoolClient, conversationId: string): Promise<void>;
```

- [ ] Write failing real-PostgreSQL tests, then implement validated bounded event acceptance. Use existing isolatedDatabase helper; schema per test and suite concurrency1. Account remains ACCOUNT constant.
- [ ] Migration adds nullable conversations.provider_thread_type/id, unique(account_id,provider_thread_type,provider_thread_id); provider_state.reconciliation_required boolean defaultfalse and fault_code nullable. Add provider_events with UUID id, account/thread/direction scoped unique key, semantic SHA256, bounded text/correlation fields, state linked/held/conflict, message FK, conflict flag and receipt timestamp. Re-running migration preserves records.
- [ ] In one transaction create/find conversation contact_id=`zalo:<type>:<threadId>`, lock it, insert scoped event and audit/projection. Text <=10000 chars; IDs <=200; optional providerTimestamp <=64; total JSON <=65536bytes. Unsupported messages use an honest placeholder, no raw URLs/content object. Duplicate semantic payload does not create another message/audit. Conflict sets reconciliation_required, disconnects provider and audits once.
- [ ] Find self echoes by exact accepted delivery_parts.provider_id joined to the same conversation; preserve actor. If an outbox in processing/unknown could have produced an unrecognized echo, hold it. With no such ambiguous job, project it as a native/shared outbound message with actor_id NULL. No content/time guessing.
- [ ] recordPartAccepted is called INSIDE an existing transaction: lock conversation, reject conflicting provider mapping, update the specified part to sent and reconcile held exact-ID echoes. After final outbox success, reconcileSelfEvents releases remaining nonmatching self events only when no processing/unknown remains. It also requires an existing transaction.
- [ ] Cover concurrent replay, thread-type separation, inbound vs self IDs, conflict rollback/flag/audit, early/late self echo, phone attribution, held unknown, actor preservation and transaction rollback/restart durability. Include provider_events in backup count/fingerprint/drill SQL.
- [ ] Review the task before worker integration. No actual SDK/network use.

## Task2 — fresh transport and bounded ingress

Files owned: adapters/zalo/transport.ts, tests/transport/transport.test.ts, tests/fixtures/sdk-offline-probe.mjs (only metadata contract expectations if changed), package.json (only probe permission if a helper module is added); docs/review/transport-ingress-report.md.

- [ ] Reproduce old-socket close affecting a reused listener and rejected async callback before fixing. Use fresh fake API/listener per createApi; never invoke a real SDK login.
- [ ] Preserve start/stop/sessionInvalid/sendText/status interface. Add drain():Promise<void>, onInbound returning void|Promise<void>, onFault(reason) with observed void|Promise callback, maxPendingInbound default100 (positive bounded configuration), handshakeTimeoutMs default15000, reconnect maximum3 with existing delay option. Retain clientId/providerTimestamp only when bounded valid strings are present.
- [ ] On interruption release/detach/stop old listener, then create a NEW API; reject reused listener objects within one transport. Stop during pending factory creation disposes late APIs. No attempt/budget/timer resurrection after stop/expiry. Connected event gates sends; handshake timeout triggers bounded reconnect. A delayed old-socket close/error/message cannot affect the new generation.
- [ ] Serialize accepted inbound callbacks and bound queued+in-flight events. On callback rejection/overflow/invalid provider event stop transport and report a fixed fault code without raw exception. drain waits accepted events; failure is reported when explicitly awaited, without unhandled rejection. Stop drains accepted callbacks and rejects new events. No automatic retry of failed persistence or external sends.
- [ ] Update source-backed ESM/CJS constructor contract expectations for optional clientId/providerTimestamp without weakening malformed-frame validation. Run existing transport/facade/guard suites.

## Task3 — worker/provider bridge (after Task1/2 review)

Files: adapters/zalo/provider.ts, tests/backend/provider-bridge.test.ts, server/worker.ts and relevant worker regression tests; docs/review/provider-bridge-report.md.

- [ ] createSdkProvider(pool, transport) implements existing Provider using DB-owned conversation mapping and payloads. It preflights all parts before any send, refuses unmapped or unsupported jobs deterministically and keeps SDK raw session objects private. prepareMessage(messageId,db) uses the worker transaction client; sendPart/connected may accept that client to avoid nested pool acquisition. Mock provider also uses a supplied client. releaseMessage(messageId) optionally clears prepared private payload state in worker cleanup. Actual media is a later typed boundary, not arbitrary sendMessage objects.
- [ ] Extend Provider with optional prepareMessage(messageId) and string|null sendPart result; null is permitted only for part0 with blank text. Worker records that as skipped with no invented provider ID. Existing mock behavior stays compatible.
- [ ] On accepted part use recordPartAccepted within BEGIN/COMMIT; never repeat sent/skipped parts. Final message.provider_id uses first real accepted part; final success/outbox/audit/reconcile are atomic. Preparation failure is failed before dispatch, while any possible execution uncertainty remains unknown. Confirmed parts survive later failure.
- [ ] Inject fake transport backed by the real store/worker: actual inbound, staff enqueue, exact-ID early/late echo, native phone, worker crash window, unsupported media before text, disconnect and retry-key cases. Verify no SDK network and no duplicate transcript/attribution.

## Next phases — remain required before Owner account participation

1. Typed, bounded PNG/JPEG/PDF/text outbound media; durable/private inbound media source with controlled downloader policy, no arbitrary URL fetch.
2. Connector lifetime ownership/lease-loss handling and persisted takeover guard that refuses automatic failover without confirmed old-owner fencing. No claim that a DB advisory lock fences external egress.
3. Privileged, audited reconciliation/held-event/gap controls and honest UI status; backup/restore of new state, security and four-client/browser regression.
4. Explicit private pilot activation/expected account identity checks and session/key operations; independent end-to-end review and CI. Only then request dedicated account/phone/peer and explicit live-risk consent. Physical phone/media/soak evidence stays UNPROVEN until performed.

## Ledger

- Baseline locald9c97ea / remote30a7f466:53/53 units,2 guarded SDK cases and6 browser cases validated on sourcef8167052. Existing worktree clean.
- Ruling: keep real provider disabled and SDK development-only during this phase; structural injection tests exercise the actual app persistence/worker without any account/network side effect.
- Task1 implementation and reviewed P1/P2 corrections complete; real PostgreSQL/durability/restore acceptance pending hostedCI.
- Task2 implementation39/39 transport/facade/vault +2/2 actualSDKguard cases andtypecheck passed; two P2 review corrections accepted by scoped re-review.
- Task3 implemented and scoped P1 corrected/re-reviewed;3pure cases andtypecheck passed; realPGintegration/SIGKILL requirehostedCI.
- Ruling: combineTasks1–3 plusindependent4HTTPstaffflow inone hosted snapshot becauseTask3 finished before firstsnapshot publication; no completionclaim beforeSQL/durabilityevidence.
- Added tests/backend/connector-flow.test.ts exercisesrealHTTPauth/CSRF/Origin/assignment/concurrentidempotency→worker→SDK-shapedselfecho→nativeattribution→invalidation; runtimeunproven locally, fourAPIclientsnotphysicaldevices. No production-ready claim.
- Ruling: ops/counts.sql and guarded ops/ci-provider-journal.ts are necessary Task1 extensions; fixture runs only after load/browser workers stop, before restart/restore.
- Ruling: use dedicated tests/transport/transport-ingress.test.ts for lifecycle/queue regressions, preserving existing transport contracts and actualSDKguard coverage.

- Ruling: proven nonexecution raises fixed ProviderNotDispatchedError and defers pending with confirmed parts preserved; uncertain outcomes remain unknown. Dispatch-boundary database/socket eligibility is rechecked.

- Final integrated review found a P1: SDK-returned cancelled metadata could impersonate pre-dispatch cancellation. Replaced structural sentinel with a per-call private Symbol; regression reproduced the old failed classification and now requires unknown after one SDK invocation. Fresh transport/facade/vault 40/40, actual offline SDK guards 2/2 and complete client/server build passed. Independent fix re-review and hosted PostgreSQL acceptance pending.

- Independent bounded re-review accepted the P1 correction. Added two actual transport-to-bridge offline regressions (2/2 PASS) and typecheck PASS; hosted SQL unknown/no-retry remains required.

- Hosted CI40908043580 on e31abe21 passed83/83 units,2 SDKguards,6browser cases, four-staff HTTPflow, nonempty journal restart/restore and image gates. See docs/evidence/ci-connector-core-results.json. Core offline acceptance complete; real account and later phases remain unproven.
