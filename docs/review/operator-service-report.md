# Privileged connector operation service — Task2

Implemented `server/connector-operations.ts` and `tests/backend/connector-operations.test.ts` only. No HTTP route, UI, schema, worker, SDK, ownership, media, production configuration or external network changes are part of this task. No staging/commit/publication performed.

## Interfaces and transaction contract

Exports match `docs/plans/connector-operations.md`: `confirmUnknownPart`, `resolveKnownConflict`, `acknowledgeProviderGap` and `OperationActor={id:string}`. `ConnectorOperationError.statusCode` is400,403 or409 with fixed safe messages and no raw SQL details/cause. Invalid input (including unknown keys) fails before database access. The caller owns an explicit transaction and must roll it back on rejection; existing authenticated HTTP transactions must retain their session/Origin/CSRF checks. These library helpers do not replace session authentication.

Each operation verifies an explicit transaction marker, shares the existing staff-change advisory lock and queries the current active ACCOUNT administrator under a row share lock. Actor names are read from PostgreSQL for audit, not trusted from a request object.

- Exact-ID confirmation acquires worker advisory transaction lock73001, locks the unknown outbox then conversation, and requires an unknown unconfirmed part plus a held, unlinked, nonconflicting same-account/conversation/direction/thread event with the exact resolution version. Provider ID comes only from that durable receipt. Existing `recordPartAccepted` rejects competing mappings and preserves staff attribution. Confirmed parts survive; message/outbox remain unknown unless every part is sent/skipped. Finalization and held-event reconciliation share the transaction. A fixed attributed `connector.part_confirmed` audit records the exact event/part/scoped provider ID and evidence reference. There is no send/reset/retry operation.
- Conflict resolution locks conversation before event (matching ingestion), compares exact retained variant hashes (canonical excluded), rejects already resolved, overflow, missing legacy evidence and exhausted versions, retains all canonical/variant bodies and records the administrator's external-review attestation. It never clears a gap. MAX-1 resolution is also refused rather than resolving into the terminal ceiling.
- Gap acknowledgement takes worker lock to stabilize delivery-state checks, then locks ownership before provider state, compares exact epoch/owner/gap version and refuses reserved/uncertain ownership, held or unresolved/overflow/legacy events and unknown/processing jobs or messages. It keeps status disconnected. MAX gap version is always rejected independent of fault_code; owner epoch may use the full bounded bigint range because it is compared rather than incremented. A new fault after acknowledgement reasserts quarantine; a queued earlier fault changes the version and defeats a stale acknowledgement.

Evidence references are restricted bounded nonsecret printable identifiers. They are administrator attestations, not software proof of provider delivery, reviewed history or external firewall state.

## Test evidence and limits

- Before module implementation, the new test file failed with module-not-found (required service unavailable RED).
- Final focused local invocation: `node --import tsx --test --test-isolation=none --test-name-pattern='operations reject invalid|operations require|operations fail closed' tests/backend/connector-operations.test.ts`: **3/3 PASS**. Cases check strict input/terminal versions before DB, explicit transaction and freshly denied administrator, worker contention with no writes and raw-error sanitization.
- `npm run typecheck`: **PASS**; `git diff --check`: **PASS**.
- Three real PostgreSQL scenarios are authored but **UNPROVEN locally** because the established database EPERM restriction remains; no redundant database attempt or approval request was made. Hosted CI must run them before acceptance. Scenarios cover exact-ID/thread scoping, denied staff, partial and concurrent confirmation, preserved actor/accepted IDs, no provider-ledger send, conflict evidence/CAS, agent/supervisor/foreign/inactive admin denials, owner phase/epoch refusals, reopened variants and stale gap versions. A separate race queues a fault UPDATE behind a held provider row before starting acknowledgement, then asserts that version8/quarantine survives and no gap-ack audit appears.

No SDK method or real account/phone operation is invoked. Independent review and hosted SQL/concurrency/crash/recovery acceptance remain required. No production-readiness claim.
