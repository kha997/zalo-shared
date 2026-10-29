# Independent Task1 provider-store review

Scope: task1 brief and review patch, actual provider-store/schema/db, provider-store tests, backup count/fingerprint/drill SQL, and existing app API contracts. Transport changes excluded. Static review only; no unchanged tests rerun, network, real SDK, or implementation edits. PostgreSQL execution remains **UNPROVEN** because the recorded local runs fail with EPERM; hosted CI is required. No production readiness claim.

## Scoped re-review

Inspected the revised provider-store, new regression tests, guarded `ops/ci-provider-journal.ts`, and amended backup drill. All four original findings are resolved in the inspected implementation, subject to CI fixture wiring and hosted execution below. No new P0/P1/P2 implementation finding identified in this bounded re-review.

- P1 resolved: any receipt of an already-conflicted row, including the original payload replay, reasserts disconnected/reconciliation_required/fault_code; only the first conflict audits. The new regression resets provider state between both replay variants and asserts quarantine plus a single audit.
- Assignment-version P2 resolved: projection updates updated_at only. The regression verifies a version-conditional assignment update remains possible after native activity.
- Inbound-status P2 resolved: direction selects received for inbound and sent for native outbound, with explicit assertions.
- Empty-journal P2 resolved in fixture/drill code: the fixture requires explicit disposable opt-in, mock mode, and the exact zalo_test database basename. It creates linked, held and conflict rows, a linked staff echo, and an unknown outbox. The backup drill requires those states and staff linkage, then checks full journal content digest and count after restore. Generic integrity fingerprints include these nonempty rows for restart comparison.

**Required integration gate:** root must invoke this fixture with CI_PROVIDER_JOURNAL_DISPOSABLE=yes and PROVIDER_MODE=mock after load/browser workers stop and before the unclean restart step. At re-review inspection that workflow step had not yet appeared. Without it the stricter drill fails rather than silently passing an empty journal. Hosted CI must successfully execute PostgreSQL regressions, nonempty restart fingerprints, and backup/restore verification. Local PostgreSQL behavior remains EPERM-blocked and UNPROVEN; no new tests were rerun here.

The fixture is intended for one fresh CI database run: rerunning it in the same database can collide with its accepted provider mapping. That is consistent with its documented disposable fixture purpose.

## Original findings (resolved as described above)

### P1 — Repeated known conflicts stop enforcing the provider quarantine

`server/provider-store.ts:175-186` updates provider_state only inside `if (!row.conflict)`. Scenario: receive conflicting semantic payload, then another component/admin reconnects by writing status=connected (existing app.ts:649 does exactly this), then replay the conflicting event. The call reports conflict=true but leaves provider_state connected. Existing worker.ts:15 gates dispatch on status alone, so reconciliation_required does not stop dispatch. Likewise, an accidental reset of reconciliation_required is not repaired by the repeated conflict. Deduplicate the audit insertion, but reassert disconnected/reconciliation_required/fault_code on every conflicting receipt. Add a regression that resets state between conflicting replays and verifies quarantine with exactly one conflict audit. The first-conflict implementation and existing test do not catch this control gap.

### P2 — Message projection changes assignment concurrency semantics

`server/provider-store.ts:95-98` increments conversations.version for every new inbound/native message. Existing app.ts:406-432 uses that field as the expectedVersion guard for assignment/status changes, while the existing inbound route (app.ts:680-684) updates only updated_at. Scenario: supervisor reads version N, customer sends a message, supervisor assigns using N; the assignment now returns 409 although assignment/status never changed. Busy conversations can repeatedly reject assignment. Preserve assignment version semantics when refreshing message activity, and add an API contract regression.

### P2 — Inbound journal projections use outbound status

`server/provider-store.ts:85` hardcodes sent for inbound and outbound. Existing inbound API inserts received (app.ts:676). A customer message ingested through the new path therefore exposes a different status from the same message through the existing contract. Parameterize status by direction and assert inbound=received/native outbound=sent. No current provider-store assertion checks projected status.

### P2 — Backup/restart checks can pass with an empty journal

Counts and full-row fingerprints correctly include provider_events. However, provider-store tests use isolated schemas and destroy them, and the CI drill merely compares before/after counts without seeding or requiring a nonempty journal. The currently inspected integration callers do not populate provider_events in the main CI database. Thus zero==zero and empty fingerprints can pass despite journal restoration never being exercised. Seed representative linked/held/conflict journal rows (including an app actor link) in the disposable drill database and assert their content/state after restore and unclean restart. Preserve existing quarantine and audit restrictions.

## Compliance and quality assessment

No P0 identified. Initial verdict was request changes for the quarantine hole and API regressions. Revised static verdict: these issues are addressed; acceptable for the bounded next integration phase once the fixture workflow is wired and hosted gates pass. Execution and the additional boundary coverage noted below remain unproven; this is not production acceptance.

- Identity is correctly scoped by account, thread type, thread ID, direction, provider ID. SHA256 covers sender, kind, text for text messages, client ID and provider timestamp; absent optional fields normalize to null. Unsupported content is intentionally omitted and replaced by an honest placeholder. Optional correlation/timestamp differences therefore count as semantic conflicts; callers must normalize them consistently. Bounds exist for IDs, text, timestamp, NULs, and total serialized event size.
- Conversation upsert/row lock serializes same-conversation ingests and the acceptance/reconciliation helpers. Journal insert, projection, activity and audit share one transaction. Exact replay does not project or audit again. Different thread type/direction isolation is tested; different thread ID is not explicitly asserted.
- Exact sent-part matching preserves the existing app message and actor. Early echoes are held while processing/unknown exists; unmatched self messages become native outbound with NULL actor only when that ambiguity is gone. Acceptance rejects aliases across parts/messages and refuses to steal an already projected native event. No text/time guessing was found.
- Reconciliation requires a transaction via a transaction-local marker and locks the conversation. The approach is reasonable for ordinary clients; recordPartAccepted's missing-transaction path is not directly tested. Acceptance rollback tests cover part mapping and held event restoration. Ingest/projection/conflict-audit failure rollback is not injected/tested.
- Tests include concurrent duplicate ingest, sequential early/late echo cases, unknown holds, actor preservation, mapping collision and migration rerun. They do not force concurrent ingest-versus-acceptance interleavings, verify conflict rollback, test the full field-boundary matrix, or prove process/database restart durability with nonempty provider journal data. Reported PostgreSQL coverage describes test intent, not successful local execution.
- DDL is rerunnable and new table grants participate in runtime migration privileges. Backup uses pg_dump and explicit table counts/full row fingerprints; restore compares these before quarantine. Audit restrictions remain intact in inspected changes. Actual migration/runtime-role/restore behavior awaits hosted PostgreSQL verification.

Integration constraint: worker transitions into/out of processing/unknown must coordinate with the conversation lock and invoke reconciliation at terminal success as the brief requires. These helpers alone cannot make unrelated callers follow that protocol. This review does not judge the separately ongoing worker/transport implementation.
