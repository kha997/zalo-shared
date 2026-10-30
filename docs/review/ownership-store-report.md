# Durable connector ownership — Tasks 1 and 2

Implemented `connector_ownership` DDL in provider-schema, the dedicated-session admission/heartbeat library and privileged external-fence acknowledgement. No runtime/worker/provider wiring, live configuration, actual SDK import/login, external network, production data or deployment was performed. Root must complete ownership table backup/restore integration before accepting this phase.

## Interfaces and guarantees

`acquireConnectorOwnership(pool,{ownerLabel,onRevoked,heartbeatMs?,queryTimeoutMs?})` returns `OwnershipHandle` with immutable `{accountId,ownerId,epoch:string}`, `admitted`, `assertCurrent()`, `markActive()`, `invalidate(reason)` and `close()`. Defaults are 5s heartbeat and 2s query deadline; bounds are respectively 100..60000ms and 100..10000ms. Owner labels are nonsecret restricted printable references. Bigint epochs never pass through JS Number.

A dedicated client holds `(73002,1)`; reservation/epoch/audit commit precedes returning admission. Nonidle rows block takeover even after lock release. Dedicated queries are serialized and bounded. Error/end/timeout revokes permission and invokes the callback synchronously once; client discard releases the session lock without reusing a hung connection. Late successful query completion cannot restore admission. Pool acquisition is also bounded; late clients are destroyed before any query. Unknown COMMIT never returns an admitted handle.

Healthy shutdown/invalidation performs a conditional atomic CTE to retain owner identity, mark uncertainty, disconnect provider/requires reconciliation and append fixed safe audit. If the client is lost, the existing reserved/active row itself blocks replacement; cleanup never clears it. Every client is ultimately destroyed once, never returned reusable with session locks. Raw errors are replaced with a fixed safe message.

`acknowledgeConnectorFence(db,actor:{id},input:{expectedOwnerId,expectedEpoch,evidenceRef,acknowledgeExternalFence:true})` requires an existing explicit transaction, rechecks current active admin for ACCOUNT under the staff-change lock, attempts the owner transaction lock, checks exact owner/epoch under row lock and records the attestation audit. It changes ownership to idle while preserving last-fenced metadata, leaves disconnected/reconciliation_required, and changes no message/outbox/part states. The caller owns COMMIT/ROLLBACK. Evidence references reject credential/URL syntax and controls. This records external fencing attestation, not proof of actual external egress fencing.

## Evidence

- Before implementation, new test file failed because ownership module did not exist (behavior unavailable RED).
- Controlled client tests cover admitted reserve/commit ordering, bigint precision, single cleanup, active/current checks, error/end/query rejection, heartbeat timeout with no writes on hung client, late-success rejection, nonidle block, lock contention, unknown COMMIT and invalid input before DB. These passed locally; final count is recorded in the follow-up below.
- Initial SQL invocation lacked TEST_DATABASE_URL. One properly configured invocation sourced the private local environment without printing values; isolated-schema setup failed at `connect EPERM 127.0.0.1:55432`. No real SQL assertion executed; PostgreSQL contention/migration/admin/fencing tests remain UNPROVEN pending hosted CI. No escalation or repeated configured PostgreSQL attempt was made.
- New SQL scenario tests two-owner contention, nonidle blocking after close, migration preservation, agent/supervisor/inactive admin denial, transaction requirement, stale epoch, false flag, single audited admin acknowledgement, next epoch and refusal while a live lifetime lock is held.
- Initial `npm run typecheck` PASS. Full coordinating checks must run after concurrent media edits settle.

Not production acceptance: independent review, owned runtime and send/ingress gates, stale callback/crash coverage, backup/restore table quarantine, private operator UI and live-account pilot remain separate tasks. No account resources are needed for these offline tasks.

Final verification: seven controlled-client scenarios PASS, including bounded late pool acquisition disposal. The file-level run reports7PASS/1FAIL because its required SQL scenario cannot initialize without TEST_DATABASE_URL; the one configured SQL attempt was already EPERM as documented. Do not describe the whole file as green. Fresh `npm run typecheck` and `git diff --check` PASS. No files staged or committed.
