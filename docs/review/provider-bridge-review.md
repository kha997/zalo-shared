# Task 3 independent specification and quality review

Current verdict after scoped re-review: source review passes; host PostgreSQL CI is still required. The original P1 below is resolved. No open P0/P1/P2 findings.

Initial verdict: changes required (one P1). No P0 findings. Reviewed task3-brief.md, task3-review.patch, actual provider/worker/store/transport code, bridge tests, the existing SIGKILL regression and helper, and provider-bridge-report.md. This was a source review; unchanged tests were not rerun. The reported pure preflight/typecheck success and three PostgreSQL tests blocked by local EPERM are not database acceptance evidence. Host CI remains required.

## P1 — Recheck dispatch eligibility after preparation

Locations: server/worker.ts:66,96,119; adapters/zalo/provider.ts:70–79.

The only connectivity/quarantine check occurs before selecting/preparing the job. After the awaited preparation queries and processing-state commit, sendPart calls transport.sendText without checking provider_state again. If reconciliation_required becomes true (or database status becomes disconnected) during that interval while the transport remains connected, the worker still sends externally. The transport checks its own socket generation/connectivity, but cannot enforce the database reconciliation hold. A disconnect during preparation also reaches sendPart and is classified unknown even when a fresh eligibility check could establish that no dispatch should begin.

Reproduction: start with database and fake transport connected; during a wrapped metadata-only prepareMessage, finish normal preparation and update provider_state.reconciliation_required=true using a second client; return to the worker. The current worker invokes fake sendText once despite the active hold. The same issue occurs if database status changes without an immediate socket transition. Existing tests mutate these states only before calling runWorkerOnce, so do not cover this interval.

Required change: enforce current eligibility at the dispatch boundary using the supplied worker client, after preparation and before marking execution possible/calling transport. Preserve already confirmed parts; a known pre-execution refusal must not be represented as uncertain external acceptance. Add deterministic tests that change database reconciliation/status and transport connectivity between prepare and send, assert zero external sends, and assert the selected durable pre-dispatch state. Document the boundary for a concurrent state change after dispatch has actually begun rather than promising an impossible atomic database/network operation.

## Other reviewed behavior

- Preparation is optional and metadata-only. SDK bridge uses account-owned thread mapping, rejects media and unmapped jobs before text, bounds its sole private cached payload, and releases it in worker cleanup. No SDK/session escape or configuration promotion was introduced.
- Worker passes its client to preparation/connectivity/send; the mock prefers it, avoiding nested pool acquisition. SDK preparation uses that client. sendPart currently does no database work, which is precisely why the eligibility finding needs attention.
- Pending jobs with processing/unknown parts are held unknown; failed parts require reset. Sent/skipped parts are not sent again. Preparation exceptions become failed with fixed audit metadata. Exceptions after possible dispatch conservatively become unknown, and confirmed parts survive later failure.
- Null is accepted only for blank part zero with actual attachments and attachment parts; no provider ID is invented. Invalid null outcomes become unknown. Record acceptance runs inside BEGIN/COMMIT using the reviewed conversation-locking store. Final message/outbox/audit/reconciliation is transactional and selects the first real accepted part ID.
- Existing SIGKILL helper still pauses after provider acceptance and before return to worker, with durable processing state already committed. Recovery still quarantines rather than resending. Static compatibility is intact; runtime behavior needs host PostgreSQL CI.

## Validation limits and acceptance

No additional P2 code finding. Tests cover the principal success/failure paths but do not exercise the P1 transition window. Retry-key coverage is only a database fixture with a request_key; the implementation report correctly disclaims HTTP enqueue/idempotency proof. Existing crash coverage is the mock boundary, not a new SDK-backed process-kill test. Run the bridge integration tests and existing worker/crash regressions in host CI after the dispatch-boundary fix; do not treat the local EPERM failures as passes. No real SDK, network session, customer data, deployment, or production-readiness claim was involved.


## Scoped re-review — dispatch-boundary fix

Reviewed the updated four owned files and the necessary queue ruling supplied by the owner: proven non-execution may return to pending and resume after reconnect; uncertainty may never be automatically retried. This explicitly refines the initial brief's conservative treatment of transport failures.

The original P1 is resolved in source. SDK sendPart now rechecks connected using the worker client immediately before transport execution. Database disconnect, reconciliation hold and socket disconnect are covered by deterministic preparation-to-send regression scenarios. Invalid whitespace-only thread metadata now fails preflight.

The typed catch is consistent with the approved queue ruling: ProviderNotDispatchedError resets only processing parts to pending, retains sent/skipped and future pending parts, and records a fixed message.deferred reason. The production transport's failed path represents pre-execution refusal; exceptions, timeouts and unrecognized acceptance remain unknown. The bridge translates only the explicit failed result or a false eligibility check to the typed error. Already ambiguous parts are rejected before preparation with an ordinary error, so they cannot enter the new retry path. Acceptance persistence failures also remain ordinary unknown failures.

Deferred message/outbox changes, the limited part reset, audit and held-event reconciliation share one transaction. Exact provider mappings for confirmed parts remain available; unmatched self events may project only after the proven non-execution gap ends, and another processing/unknown job still keeps them held. No source-level evidence of confirmation loss or unknown-to-pending retry was found. The added multipart regression checks preservation and non-repetition of the accepted first part across a later refusal.

Verification remains limited: the implementation report records three passing pure tests and typecheck; this review did not rerun unchanged checks or attempt PostgreSQL access. The added PostgreSQL transition/reconnect tests and existing bridge/worker/SIGKILL regressions must pass on host CI before integration acceptance. There is no atomic database/network eligibility guarantee after the final check; the report now states that limit correctly.
