# Privileged connector operation service independent review

Verdict: **no P0/P1/P2 identified in the reviewed Task2 source; accepted conditionally on hosted SQL/concurrency execution and authenticated HTTP integration**. This is not live delivery, external-fencing or production acceptance.

## Scope and method

Reviewed `server/connector-operations.ts`, its test file/report, Task2 of `docs/plans/connector-operations.md`, and the current store/worker/fault/ownership lock and reconciliation interfaces. No product implementation edits, network, real SDK/account actions, configured PostgreSQL attempts or commits were performed. Only this report was authored.

## Assessment

- Public operations validate strict bounded runtime shapes and decimal bigint versions before database access. MAX gap/resolution versions are rejected regardless of fault code; conflict resolution additionally refuses MAX-1 rather than resolving into a terminal version. Owner epoch is comparison-only and permits the full bounded bigint range. Errors expose only fixed safe 400/403/409 messages. Caller-owned transaction rollback remains mandatory after rejection.
- Authorization requires an explicit transaction marker, shared staff-change lock and a fresh active ACCOUNT admin row under SHARE lock. Database actor name supplies audit attribution. This protects the service against an in-flight role change when used with the existing authenticated HTTP transaction; it does not replace session, CSRF or Origin enforcement.
- Unknown-part confirmation takes the same worker advisory namespace before outbox/conversation/part/event locks. It requires unknown message/outbox/part, NULL prior part ID, a held/unlinked/nonconflicting exact scoped outbound event, matching thread mapping and resolution version, and no missing/overflow evidence. The provider ID comes from the durable receipt. `recordPartAccepted` reuses existing competing-mapping checks, preserves the staff actor and reconciles exact echoes. Partial confirmation leaves the job unknown; all-parts completion atomically finalizes sent and releases remaining eligible held events. No provider method, reset or resend path is introduced.
- Conflict resolution follows ingestion's conversation-before-event order, compares the complete retained hash set and current version, refuses overflow/legacy evidence loss/already-resolved/terminal cases, and retains canonical and variant bodies. Resolution only records the admin attestation and versioned metadata; it never clears quarantine or marks connectivity.
- Gap acknowledgement stabilizes dispatcher state with worker lock, then takes ownership before provider-row locks. It compares exact owner/epoch/gap version, permits only idle/active ownership, and refuses held/unresolved/overflow/legacy evidence and either message or outbox unknown/processing state. It clears reconciliation while keeping status disconnected and appends attribution. Owned ingestion/fault writes take owner SHARE before provider writes, so they cannot cross the acknowledgement owner lock. Direct fault updates serialize on the provider row and increment after an acknowledgement or make its expected version stale; no unconditional later clear was found. Concurrent conflict resolution can cause a conservative refusal, but does not erase a newer fault.
- Unsupported recovery cases remain blocked: conflicted self receipts cannot be arbitrarily assigned, unknown jobs cannot be abandoned/reset to pending, and no native attribution based on text/time is available. Evidence references are administrator attestations, not software proof of actual delivery/history/firewall state.

## Executed evidence and remaining gates

Independently ran:

`node --import tsx --test --test-isolation=none --test-name-pattern='operations reject invalid|operations require|operations fail closed' tests/backend/connector-operations.test.ts`

Result: **3/3 PASS**, exit0. These cover strict/terminal validation without DB access, transaction/current-admin refusal, worker contention without writes and raw-error sanitization. The selected invocation did not run SQL tests or contact a database.

The three authored PostgreSQL scenarios remain **UNPROVEN locally**: exact-ID partial/concurrent recovery and attribution, role/evidence/owner/CAS rejection, and queued-fault versus gap acknowledgement. Hosted CI must execute these alongside existing ingestion/worker/crash/restart/restore checks. HTTP integration must retain actual session/current-role checks, Origin/CSRF, account isolation, bounded pagination and safe error mapping. No real Zalo, physical phone, provider-side fencing or production-readiness conclusion follows from this review.
