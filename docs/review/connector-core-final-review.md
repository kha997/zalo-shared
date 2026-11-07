# Connector core final independent review

Verdict after bounded independent re-review: **the sole reported P1 is corrected; offline source accepted subject to hosted integration CI**. Original finding and reproduction are retained below. No P0 or additional P2 findings identified. Hosted CI remains mandatory after correction; PostgreSQL integration, process/database durability and restoration are **UNPROVEN locally**. This is not production acceptance.

## Scope and method

Reviewed the combined connector-core delta against local d9c97ea / source 30a7f466, Tasks 1–3 and global constraints in `docs/plans/connector-core.md`, the provider-store, transport-ingress and provider-bridge reports/reviews, and the connector-flow report. Inspected actual current store/schema/migration, worker/bridge/transport, HTTP flow test, regression test cases, CI fixture/workflow, counts/fingerprints/restore drill, package/build/container boundaries. Actual files include the follow-up ingress thread-type narrowing and documentation rulings beyond the snapshot. Accepted scoped corrections were checked in their integration context.

No implementation edits, network, real SDK/account operation, subagents, PostgreSQL attempts or unchanged-suite reruns were performed. One new, bounded offline reproduction used EventEmitter, the actual transport and bridge, and a metadata-only fake database. It exercises the finding below, not database execution. The original review authored only this report. The bounded follow-up additionally authored tests/backend/bridge-sentinel.test.ts; no production code was changed by the reviewer.

## P1 — An SDK response can masquerade as proven non-dispatch and enable resend

Locations: `adapters/zalo/transport.ts:380–386`, `adapters/zalo/provider.ts:83`, `server/worker.ts:155–175`.

The transport represents its internal pre-call cancellation as `{ cancelled: true }`, then recognizes that condition by reading the same property on **any result returned by `sendMessage`**. The new bridge translates `status: failed` to `ProviderNotDispatchedError`; the new worker catch resets the processing part and job to pending for automatic retry.

Consequently, an unexpected SDK result `{ cancelled: true }` after invocation is treated as proof that no external execution occurred. The SDK response has crossed the dispatch boundary and cannot supply that proof. A malformed/provider-dependent response may follow acceptance, so automatic retry can duplicate a message. Although the transport sentinel predates this delta, the new bridge/worker deferred retry makes this a new integrated correctness defect.

Offline reproduction: an injected connected EventEmitter API increments `calls` inside `sendMessage` and returns `{ cancelled: true }`. Prepare a valid text payload through the actual SDK bridge and call its `sendPart`. Observed output:

```json
{"externalCalls":1,"error":"ProviderNotDispatchedError","workerCatchState":"pending"}
```

`externalCalls` and the thrown error are executed evidence; the worker state is the source-derived branch selected by that error, not a claim of executed PostgreSQL verification.

Required correction: distinguish internal cancellation by private identity (for example a locally allocated Symbol) or return a failed delivery only from a branch that demonstrably did not invoke the SDK. All unrecognized SDK results after invocation must remain unknown. Add a regression for an SDK-returned `cancelled` property, including the bridge boundary; retain a regression proving genuine generation cancellation performs zero SDK calls and may safely defer. Hosted worker integration must establish that the ambiguous result is not retried.

## Integrated specification and quality assessment

- Journal keys scope account, thread type, thread ID, direction and provider ID. Semantic replay is idempotent; conflict receipts reassert quarantine and audit only the first conflict. Exact accepted-part mappings preserve the staff actor; unmatched self events stay held during processing/unknown, otherwise native projections have NULL actors. No text/time attribution was found.
- Ingestion and acceptance/reconciliation serialize through the conversation row. Acceptance updates parts under that lock. Worker processing commits precede external invocation; acceptance commits preserve confirmations. Completion and proven-nonexecution defer reconcile held rows inside the same transaction as their outbox/message transitions. Ingestion can observe the prior processing state while finalization is uncommitted, but the final reconciliation waits for the conversation lock and then sees committed held events. No additional concrete lock-order deadlock was established by source inspection. This does not replace hosted concurrent SQL execution.
- Unknown/processing prior parts are quarantined; sent/skipped parts are skipped. Acceptance persistence failures and uncertain sends remain unknown. Apart from the P1 response-classification hole, the reviewed deferred path preserves accepted parts and resets only the current processing part. Final provider ID selects the first real accepted part; final message/outbox/audit/reconciliation commit together.
- Transport generation fences, fresh-listener use, bounded serial ingestion, explicit drain, stop behavior and the two scoped lifecycle corrections are present. Persistence failure retains bounded in-memory work and blocks further work; this is not durable recovery before receipt. Fault persistence and lifetime ownership remain the caller's responsibility.
- The new HTTP test uses four independent authenticated staff sessions, real HTTP CSRF/Origin checks, assignment, concurrent idempotency retries, actual persistence/worker/transport, and synthetic SDK-shaped events. Early echo drain explicitly establishes the held-before-ack ordering; assertions check actor preservation, thread-scoped reused IDs, no duplicate transcript, native actor NULL and blocked sends after invalidation. Fault persistence has an explicit barrier. Cleanup closes the app, stops transport and closes the isolated database on the exercised body path. Setup errors before its try/finally and hung fault barriers could give poorer failure cleanup/diagnostics; these are test-hardening opportunities rather than a demonstrated product defect. Runtime assertions remain unproven locally.
- CI now invokes the guarded nonempty journal fixture after browser/load worker cleanup and before unclean database restart. The fixture creates linked, held, conflict and staff-linked events plus an unknown job. Restart fingerprints include full journal rows; the restore drill requires representative states and compares nonempty full-content digest and count. Runtime audit restrictions and restore quarantine remain checked. Thus the earlier empty-journal coverage gap is wired closed in source, subject to hosted execution.
- Migration imports only server-local schema code. Server compilation and the production image do not acquire a runtime SDK import; SDK remains a dev dependency, with the image smoke checking its absence. The actual worker executable remains disabled by default and only selects mock under existing explicit mock configuration. The injected bridge does not establish an enabled SDK application host.

## Required evidence and remaining scope

The targeted P1 correction and bridge regression are now verified offline. Hosted CI must still pass the complete PostgreSQL tests (including HTTP connector flow, worker/crash and transition regressions), migration/runtime-role checks, nonempty unclean-restart fingerprints, encrypted backup/restore integrity and quarantine, build/container checks, guarded SDK contracts and existing browser regressions. Reported local EPERM failures are not passes; the HTTP report's generic local failure alone does not establish its specific cause.

Typed media, connector lifetime/ownership and takeover fencing, operator reconciliation controls, and explicit private pilot activation remain separate later phases. Four HTTP clients do not establish physical workstation/phone operation. No real-provider delivery, no-gap recovery, live-account safety or production readiness is established by this review.

## Independent bounded re-review — private cancellation identity

Inspected the current transport, bridge and worker catch path. Each send allocates a private Symbol; only the local generation/status fence returns that exact identity before invoking sendMessage. A returned SDK object cannot equal that identity. The `{ cancelled: true }` payload therefore classifies as unknown and the actual bridge throws generic `Provider execution uncertain`, rather than ProviderNotDispatchedError. Source inspection of the worker maps that generic error after dispatch to unknown, not pending. This worker database outcome remains source-derived until hosted integration executes.

Added and executed `node --import tsx --test --test-isolation=none tests/backend/bridge-sentinel.test.ts`: **2/2 PASS**, using the actual transport and actual bridge with EventEmitter and metadata-only fake SQL responses, no database/network/account. Case one returns the hostile cancellation-shaped SDK payload: one external fake invocation and a generic uncertainty error. Case two stops the generation immediately after queuing sendText but before its SDK microtask: zero invocations and ProviderNotDispatchedError, preserving safe deferral. The initial test assertion expected a different fixed error string; correcting the assertion to the implementation's existing `Provider dispatch deferred` resolved that test-only mismatch. No product code was altered.

No additional finding was identified in this bounded correction review. This is not a repeat of the full integrated review, does not replace hosted PostgreSQL/worker/crash/restore evidence and does not establish live SDK, phone, media or production readiness.
