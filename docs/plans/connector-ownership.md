# Connector lifetime ownership implementation plan

> Implement with subagent-driven-development or executing-plans, task by task. Owner delegated engineering decisions; no further design approval is needed within existing invariants.

**Goal:** Allow exactly one admitted connector runtime for the shared account and refuse unsafe automatic takeover after a lost or uncertain owner.

**Architecture:** A dedicated PostgreSQL session holds lifetime advisory lock `(73002,1)` before any SDK factory/vault operation. A durable account row records a monotonically increasing epoch and owner identity before external initialization. Losing database/session health revokes local permission immediately, stops transport/facade, and leaves durable uncertainty. A new process may acquire the database lock but cannot authenticate or send until an administrator has recorded externally verified fencing of the previous runtime. Database ownership checks do not cancel an SDK operation or fence external Zalo egress.

**Tech stack:** Existing TypeScript/pg, injected transport/facade, PostgreSQL transactions and append-only application audit. No new runtime SDK dependency.

**Spec:** Owner invariants; docs/DESIGN.md; docs/plans/connector-core.md; docs/operations/SDK-RISKS.md.

## Global constraints

- Current `configFromEnv` accepts disabled/mock only. This phase adds an injected runtime library, not a live executable, environment switch, QR endpoint or public listener.
- One connector account/session is independent of the number of authenticated staff. No four-seat cap; staff API replicas share PostgreSQL/outbox while one connector owns provider access.
- No real login, session, phone, customer data or external network in tests. SDK remains a development dependency absent from the production image.
- Advisory lock 73001 remains the existing worker per-job lock. Lifetime ownership uses the distinct two-integer lock `(73002,1)` for the current single ACCOUNT; do not derive a future multi-account key by unchecked hash.
- Heartbeat expiry, PID reuse, missing socket, successful database lock acquisition or elapsed time never establish fencing. There is no automatic lease-time takeover.
- Unknown delivery remains unknown. Neither fencing acknowledgement nor gap acknowledgement resets messages, delivery parts or outbox to pending.

## Current boundaries inspected

`server/config.ts` rejects live modes. `server/worker.ts` uses a shared-pool client and advisory lock73001 for one job; it has no lifetime SDK owner. `adapters/zalo/provider.ts` gates sends on transport status plus provider_state/reconciliation_required. `adapters/zalo/transport.ts` uses in-process listener ownership, bounded generation/ingress/drain and private non-dispatch identity; none coordinates multiple processes. `adapters/zalo/sdk-facade.ts` exposes createApi/refreshSession/close with bounded persistence and no default login. Its close/transport stop do not prove the remote service canceled earlier work. `ops/restore.sh` already quarantines jobs and provider status, but must also quarantine durable owner state.

## State and interfaces

New `connector_ownership` table (DDL in `server/provider-schema.ts`):

- account_id UUID primary key; epoch BIGINT NOT NULL DEFAULT0 CHECK(epoch>=0).
- phase TEXT CHECK IN ('idle','reserved','active','uncertain'); owner_id UUID nullable; owner_label VARCHAR128 nullable (operator-assigned nonsecret deployment identifier).
- reserved_at, heartbeat_at, uncertain_at TIMESTAMPTZ nullable; fault_code VARCHAR64 nullable.
- last_fenced_owner_id UUID nullable; last_fenced_epoch BIGINT nullable; last_fenced_at TIMESTAMPTZ nullable.
- CHECK idle iff owner_id IS NULL; non-idle requires owner_id. Seed ACCOUNT idle epoch0 only on first migration; rerun never resets ownership.

An `idle` row means either pristine installation or explicit external fencing acknowledged for its prior owner. A reserve claim increments epoch, creates a cryptographically random owner_id and commits phase reserved BEFORE the SDK factory starts. Crash during reserved blocks later claims. Reserved->active is conditional on matching account/owner/epoch; this records admission, not remote connected status. Uncertain retains owner identity. Releasing the advisory lock never clears the row by itself.

`server/connector-ownership.ts` exports:

```ts
type OwnerToken = Readonly<{accountId:string;ownerId:string;epoch:string}>;
type OwnerFault = 'database-lost'|'heartbeat-timeout'|'initialization-failed'|'shutdown'|'ownership-mismatch';
interface OwnershipHandle {
  readonly token: OwnerToken;
  readonly admitted: boolean;
  assertCurrent(): Promise<void>; // fixed safe error on revocation/query failure
  markActive(): Promise<void>;
  invalidate(reason:OwnerFault): Promise<void>; // synchronous local revoke before first await
  close(): Promise<void>;
}
async function acquireConnectorOwnership(pool:pg.Pool, options:{ownerLabel:string;onRevoked:()=>void;heartbeatMs?:number;queryTimeoutMs?:number}):Promise<OwnershipHandle>;
async function acknowledgeConnectorFence(db:pg.PoolClient, actor:Staff, input:{expectedOwnerId:string;expectedEpoch:string;evidenceRef:string;acknowledgeExternalFence:true}):Promise<void>;
```

Use bigint epoch as validated decimal string, never convert to JS number. ownerLabel/evidenceRef are bounded printable128/256 characters, contain no URLs with credentials/session material; audit only stable nonsecret references. `Staff` is the existing authenticated staff shape; admin/current active role is rechecked in the transaction. No endpoint is introduced in this task; privileged operator controls later call this service under CSRF/Origin checks.

`adapters/zalo/connector-runtime.ts` exports `createOwnedConnector({pool,ownerLabel,createFacade,createTransport,createProvider})` returning `{start():Promise<void>;stop():Promise<void>;get status(): 'stopped'|'starting'|'active'|'blocked'}`. Factories are injected and never default-import the SDK. `start` acquires ownership before invoking createFacade, reading a vault, or constructing/starting transport. Duplicate start is single-flight; stop fences a pending start and disposes late factory results. Runtime stop always records uncertainty once external initialization was entered, including graceful shutdown. Only a pre-factory cancellation proven not to have called any factory may transactionally return its reserved row to idle. Do not add a more permissive graceful-release path without separate evidence.

## Review focus

1. Old runtime loses DB but SDK still executes: local stop and epoch checks cannot promise cancellation; mark outcome unknown and block new owner until externally fenced.
2. Lock holder crashes after reserving but before active: next process must not call SDK even though it acquired the lock.
3. Stale callback/heartbeat completes after a new epoch: conditional updates must not reconnect or overwrite the new owner.
4. Pool reconnect silently replaces session: lifetime dedicated client must never reacquire transparently; any error is terminal for that handle.
5. Restored idle/active state accidentally enables dispatch: restore forces uncertain with synthetic quarantine identity if necessary; no restored owner is automatically admitted.

## Task 1 — durable ownership and guarded admission

Files: server/provider-schema.ts, server/connector-ownership.ts (new), tests/backend/connector-ownership.test.ts (new).

- [ ] RED SQL tests: simultaneous two dedicated clients admit only one; no SDK callbacks in this layer. Existing non-idle row blocks admission even after lock release; migration rerun preserves epoch/state.
- [ ] Acquire one dedicated pool client; subscribe to error/end before querying; use pg_try_advisory_lock(73002,1). Reject and release on contention without changing durable state. Never use pool.query for lifetime lock calls.
- [ ] Under BEGIN/row FOR UPDATE require idle, increment epoch and set reserved owner, insert system connector.reserved audit, COMMIT. If commit outcome is unknown, revoke local handle and never initialize external service; durable reserved/idle state determines future admission, not an optimistic retry.
- [ ] Heartbeat default5000ms, configurable integer100..60000; query timeout default2000ms bounded100..10000. Heartbeats serialize, use UPDATE ... WHERE owner_id/epoch/phase and require one row. No overlapping timer queries or detached promises.
- [ ] invalidate revokes admitted synchronously, invokes onRevoked once, cancels timers and best-effort conditional UPDATE uncertain + provider_state disconnected/reconciliation_required true + fixed fault audit. If DB write fails, prior reserved/active row is sufficient to block a new owner. Never clear it in cleanup.
- [ ] assertCurrent checks local revocation then dedicated-session health/conditional owner row; failure revokes and throws a safe fixed error. markActive checks matching token and no reconciliation flag clearing. Old epoch cannot update current state.
- [ ] RED/GREEN tests with controlled clients: heartbeat error/end/timeout, late successful heartbeat, failed uncertainty persistence, cleanup invoked twice, query exception sanitization. PostgreSQL integration is hosted if local EPERM persists; report UNPROVEN locally.

## Task 2 — external fence acknowledgement

Files: server/connector-ownership.ts; tests/backend/connector-ownership.test.ts; docs/operations/CONNECTOR-FENCING.md (new).

- [ ] RED tests: agent/supervisor/inactive admin denied, stale owner/epoch denied, empty evidence denied, explicit flag false denied; denied attempts cannot clear quarantine or change epoch. Current admin positive case audits once.
- [ ] Acknowledge on caller transaction client: current active admin check, acquire pg_try_advisory_xact_lock(73002,1); if another session holds lifetime lock reject. Lock row, compare expected owner/epoch, require non-idle, validate reference/flag. Record connector.external_fence_ack with prior owner/epoch/admin/reference, then idle ownerNULL while retaining last_fenced metadata and epoch. Provider remains disconnected/reconciliation_required true; no message state changes.
- [ ] Actual external fence instructions require stopping old connector workload plus denying its provider egress or removing its network/workload credential capability and verifying its termination independently. If its location is unknown, do not acknowledge. Killing its database backend is insufficient. Revoke prior session upstream if the dedicated-account operator determines necessary; do not perform real account actions in this phase.
- [ ] Explain trust boundary: application audit records administrator attestation; it cannot verify firewall/orchestrator truth. The initial library accepts this attestation only; later private UI must display exact identity/epoch and warning. Gap reconciliation remains an independent gate after fencing.
- [ ] Test stale concurrent acknowledgements and reserve races. Transaction lock prevents acknowledging while an owner holds session lock; row CAS prevents stale confirmation. Never offer force takeover or elapsed-time override.

## Task 3 — injected runtime and send/event gates

Files: adapters/zalo/connector-runtime.ts (new), adapters/zalo/provider.ts, server/provider-store.ts, tests/transport/connector-runtime.test.ts (new), tests/backend/connector-owned-flow.test.ts (new).

- [ ] RED offline tests: factory/vault spy stays zero when lock/row admission fails; reserve commits before first factory; stop during initialization disposes late facade/API; initialization rejection and close failure retain uncertainty; repeated stop has no timer/promise resurrection.
- [ ] Runtime wires onRevoked to synchronous transport.stop and facade.close; catch/sanitize cleanup failures. Every factory/reconnect/session refresh begins with owner.assertCurrent; no separate reconnect may bypass it. Provider connected requires ownership admission plus existing socket/provider-state/reconciliation gates. Dispatch-boundary assertCurrent runs immediately before transport invocation. Failure before SDK call raises ProviderNotDispatchedError; any already-entered SDK call remains unknown.
- [ ] Bound worker dispatch to runtime lifetime: no second runtime may share its provider/prepared cache; stop prevents fetching new jobs and marks in-flight interrupted work unknown through existing worker recovery. Do not reset accepted delivery parts.
- [ ] Extend ingestProviderEvent with optional `{owner:OwnerToken}` context for owned runtime only. In its existing event transaction, require matching owner/epoch and phase active or reserved before state writes, using a row lock. Preserve the current context-free API for explicit synthetic unit fixtures only; live host must not select that path. Events accepted into the transport queue before local revoke may drain only while their token still owns durable row; failure is observed and gap stays required. Do not silently claim recovery of undurable events.
- [ ] SQL tests: two runtimes/four staff enqueues yield one provider owner; DB backend kill revokes old and blocks new factory; stale owner callback/heartbeat cannot mutate newer row; accepted send then DB loss is unknown/no resend; privileged fencing admits next epoch only after reconciliation gate. Simulated SDK call continuing after stop must prove unknown rather than cancellation.
- [ ] Keep config disabled/mock. No main-process wiring or SDK promotion until separate explicit private pilot activation work and independent review.

## Task 4 — durability, restore and evidence

Files: ops/counts.sql, ops/integrity.sql, ops/restore.sh, ops/ci-provider-journal.ts, ops/ci-backup-drill.sh, docs/READINESS.md.

- [ ] Include connector_ownership in counts and full-row SHA256 fingerprints. Seed a representative uncertain owner/epoch in guarded disposable fixture after workers stop; include no host secrets.
- [ ] Restore compares original fingerprints before quarantine, then forces every ownership row uncertain/disconnected with reconciliation_required true; preserve non-null previous owner or assign a fresh synthetic restore owner UUID for prior idle. Audit restore quarantine. No restore admits a runtime.
- [ ] Assert restored owner cannot acquire/start until explicit external-fence acknowledgement and separate gap reconciliation. Verify runtime role cannot mutate/delete/truncate audit; normal owner-state permissions remain scoped by application account checks.
- [ ] Full build, transport/SDK guard suites, real SQL race/crash tests, four-client/browser flow, nonempty restart/restore drill and fresh independent review. Retain source SHA, counts and PASS/FAIL/UNPROVEN. Database reconnect tests prove local admission behavior only, never provider-side fencing or phone coexistence.

## Acceptance boundary

This phase is complete only when injected runtime, SQL contention/crash, no-factory-on-block, stale-epoch, unknown/no-retry and restore quarantine checks pass. It provides conservative single-connector admission and administrator-attested takeover. Reliable automatic provider failover, actual egress fencing, real-account session behavior, phone coexistence and production activation remain UNPROVEN. The dedicated-account pilot remains necessary and requires Owner resources/consent through the existing live-risk gate.

## Execution ledger

- Tasks1/2 implemented and independently reviewed:7controlled client testsPASS, typecheckPASS; realSQLUNPROVENlocalEPERM.
- Task3 implemented with injected owned runtime/provider and transactional token-checked ingress/fault writes. Root MVCCfault race and reviewerP2lateAPI error-sink defect corrected; independent9/9runtime testsPASS, no remaining scopedP0/P1/P2.
- Task4 nonempty uncertain/idle restore branches, ownership counts/fingerprints and provider gap quarantine implemented and independently reviewed; BashsyntaxPASS, hostedSQL/recovery pending.
- Native actorNULL UI now labels messages “Zalo / thiết bị khác”, rather than suggesting a known staff author. No realphone claim.
- Local gap gate remains conservative/permanent within a runtime; operator reconciliation/resume is later work. Database ownership is admission control, not external egress fencing.

- Frozen staged-source verification in isolated /tmp checkout:57/57transport/facade/vault/runtime cases PASS,2/2actualSDKguards PASS, complete client/server build exit0. Initial guarded SDK run rejected symlinked dependencies outside its fs allowance (1/2); copying dependency bytes locally resolved that environment-only failure without changing code or weakening permissions. Hosted PostgreSQL acceptance remains pending.

- HostedCI40915139206/source0f4b4330 passed117units/2SDKguards/6browser cases, ownership contention/session-loss/stale-callback/four-staff flows and nonempty ownership/media/journal restart/restore. Offline ownership phase accepted; external provider fencing/real phone remainsUNPROVEN.
