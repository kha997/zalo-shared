# Durable ownership store independent review

Verdict: **no P0/P1/P2 identified in Tasks1–2 source; accepted conditionally on hosted SQL execution and completion of runtime/restore gates**. This is not live fencing or production acceptance.

## Scope and method

Reviewed `server/connector-ownership.ts`, additive ownership DDL in `server/provider-schema.ts`, `tests/backend/connector-ownership.test.ts`, implementation report and `docs/operations/CONNECTOR-FENCING.md` against the ownership plan. No product code edits, external network, SDK/account operation, permission escalation or configured PostgreSQL attempt were performed. Only this report was authored.

The dedicated session acquires the lifetime lock before reservation. Reservation/epoch/audit commit precedes handle admission; commit uncertainty destroys the connection and never returns permission. The persisted nonidle row prevents replacement after lock loss, including reserved-before-active crashes. Epoch remains a bounded decimal bigint string and owner UUID/epoch conditional checks prevent stale heartbeat/state writes from updating a replacement owner.

Query operations serialize, carry bounded deadlines and discard the client after errors/end/timeout. Invalidation revokes local admission and invokes the observer before awaiting persistence. A healthy cleanup atomically marks uncertainty, disconnects/requires reconciliation and audits; a failed/lost cleanup leaves the existing nonidle row blocking replacement. A timed-out query cannot put its client back into the reusable pool; late resolution cannot restore admission. Pool acquisition also has a deadline and disposes a late client before querying. Cleanup is idempotent and safe error text excludes raw database details. Concurrent assert/close sequences enqueue cleanup after the in-flight serial operation; their outer catch does not retain the serial slot while waiting on cleanup.

External-fence acknowledgement requires a caller transaction, rechecks current active ACCOUNT admin under the staff-change lock, requires the distinct lifetime transaction lock, locks ownership and compares the exact prior owner/epoch. It appends attribution/evidence then changes ownership to idle with fencing history retained, leaving provider disconnected/reconciliation_required and message/outbox states untouched. The schema enforces valid phases and idle iff NULL owner. The documentation correctly states that database lock release/heartbeat expiry/SDK stop are not external egress fencing, and that administrator attestation is a trust boundary. No automatic takeover path was found.

## Executed evidence and limits

- Independently ran the seven controlled-client tests using the explicit positive name pattern `ownership reserves|ownership errors|heartbeat timeout|late pool acquisition|non-idle state|lock contention|invalid ownership`: **7/7 PASS**. These cover committed admission, bigint precision, error/end/query failure, heartbeat timeout and late resolution, pool deadline/late disposal, nonidle blocking, lock contention/unknown commit and invalid input.
- `npm run typecheck`: **PASS**, exit0.
- An earlier negative-lookahead name filter unexpectedly included the SQL test: seven controlled cases passed, SQL setup failed because `TEST_DATABASE_URL` was absent. No database assertion executed or connection was attempted by that setup. This is not SQL acceptance. The explicit positive filter above passed subsequently.

Hosted PostgreSQL must still establish actual session-lock contention, transaction-local marker behavior, migration preservation, admin/stale/concurrent acknowledgement behavior and SQL CTE/type correctness. Tests of actual backend loss, stale runtime callbacks, reserve/ack races, restore quarantine and external-factory blocking belong to the remaining owned-runtime/durability tasks. In particular the ownership table must enter backup counts/fingerprints and be forced uncertain on restore before this phase is accepted. These source and fake-client checks do not prove SDK cancellation, actual egress fencing, real phone coexistence or production readiness.
