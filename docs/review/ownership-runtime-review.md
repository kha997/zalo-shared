# Owned connector runtime independent review

Verdict after correction: **no remaining P0/P1/P2 identified in the reviewed Task3 source; accepted conditionally on hosted SQL/crash/recovery CI**. One independently reproduced P2 was corrected and rechecked. This is local admission and injected-runtime acceptance, not proof of external egress fencing, actual Zalo operation or production readiness.

## Scope and method

Reviewed `adapters/zalo/connector-runtime.ts`, the ownership additions to `adapters/zalo/provider.ts` and `server/provider-store.ts`, `tests/transport/connector-runtime.test.ts`, and `tests/backend/connector-owned-flow.test.ts` against `docs/plans/connector-ownership.md`. Read ownership store/recovery reviews and inspected the actual facade, transport and worker boundaries. Root's onFault MVCC race correction was reviewed in its transaction context. No production code, external network, SDK/account operation, database attempt or commit was performed. Only this report was authored.

## P2 found and corrected — late discarded API error could escape

When stop occurred while an injected conforming facade's createApi awaited a result, the runtime wrapper intercepted the late API, called listener.stop and threw before the transport could adopt/dispose it. That path did not install the transport's normal permanent error sink. A later EventEmitter error on the discarded listener could throw and terminate its host. The current actual SDK facade already supplies a proxy error sink; this defect affected the runtime's declared injected API contract and alternate conforming facades rather than establishing a failure of that proxy.

Executed bounded offline reproduction before correction: start with a deferred createApi, stop runtime, resolve the API, then emit a late error under a caught assertion. Output was `{"lateErrorHandlers":0,"lateEmitThrows":true}`. No process crash or raw secret output was allowed.

The implementer added a shared discardApi helper that installs an error sink before stopping the API in both terminal-after-create and post-login ownership-check failure paths. A new regression first reproduced the unwanted exception, then passed. Independent final execution passed all nine runtime tests, including that regression. No unhandled late error remains in this reviewed path.

## Integrated assessment

- Default ownership service is acquired before any facade/vault factory. Reservation commit and bigint epoch handling belong to the reviewed ownership store. Failed admission calls no external factory. Single-flight start and terminal stop/revoke prevent same-handle resurrection.
- Stop during pending ownership/facade/transport/API work fences initialization; late resources are observed and disposed. In a separate executed late-owner probe, stop preceded resolution of acquisition: the late handle was invalidated once, external factories remained zero, and final status stayed stopped.
- Revocation synchronously stops transport and closes facade, catching cleanup exceptions. Fresh API/reconnect and explicit session persistence call assertCurrent before use; post-initialization checks refuse exposing an API whose owner was lost meanwhile. Cleanup is local and does not claim cancellation of an already-entered SDK operation.
- Provider readiness includes ownership admission plus socket and persisted reconciliation state. Dispatch rechecks owner immediately before invocation; pre-call denial may defer, while ownership loss after a possibly entered call becomes a generic uncertain result. Confirmed/skipped parts and the worker's no-auto-resend policy remain intact. Reentrant runOnce calls remain serialized by the existing worker advisory lock; stop blocks new provider execution.
- Owned ingress validates account/UUID/decimal bigint token before transaction work, locks the matching reserved/active ownership row FOR SHARE before event writes and retains the existing journal/conversation reconciliation. Context-free ingestion remains available for explicit synthetic fixtures only; the owned runtime always passes its token after its local current-owner check. A matching durable row alone is not a liveness proof after session loss; runtime-local revocation is part of this contract.
- Fault handling sets a local gap gate synchronously before awaiting pool acquisition, so a reconnect cannot race persisted quarantine into new sends. It uses BEGIN, bounded local statement timeout, matching owner FOR SHARE, provider gap update and fixed audit, then COMMIT. This closes the prior plain-EXISTS MVCC race: fencing/next-owner mutation must wait for the shared owner lock, or a stale callback finds no matching row and makes no provider/audit write. The local gap is never implicitly cleared by reconnect.
- The owned SQL flow cases cover valid/stale ingress, one owner for four distinct staff intents, backend termination blocking replacement until admin fencing, next epoch retaining reconciliation, SDK acceptance after lifetime DB loss becoming unknown/no resend, and retained stale fault callback after a newer epoch. These are authored SQL scenarios, not locally executed evidence. Four staff intents in this file are direct persistence fixtures; separate prior media/core HTTP tests establish authenticated four-client behavior.

## Executed evidence and acceptance limits

- Independent runtime suite: **9/9 PASS**, zero failed/skipped, including late error cleanup and local fault gate/transaction ordering.
- Independent `npm run typecheck`: **PASS**, exit0.
- Independent bounded late-owner probe: `{"lateOwnerDisposed":1,"externalFactories":0,"status":"stopped"}`.
- No PostgreSQL attempt was made by this review. Actual row-lock/session-lock behavior, SQL types/transactions, backend termination, owned SQL flows and ownership restart/restore remain **UNPROVEN locally** and require the ownership snapshot's hosted CI. Media-only CI does not validate this ownership delta.

The reviewed runtime has no live executable, environment switch, QR/session endpoint or SDK promotion; disabled/mock configuration remains unchanged. Actual provider cancellation, external firewall/orchestrator fencing, phone coexistence, live account identity/delivery and production activation remain separate gates. Administrator fencing attestation and a database lock do not prove external egress isolation.
