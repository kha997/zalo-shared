# Versioned provider faults and retained conflict evidence — Task 1

Implemented source for Task1 of `docs/plans/connector-operations.md`. No HTTP/operator actions, real SDK login, network requests, customer data or production deployment. No commit/staging/publication performed. Backup/restore integration remains the coordinating agent's separate task.

## Interfaces and durable fields

- `recordProviderFault(db, code): Promise<{gapVersion:string}>` requires an existing explicit transaction, validates a fixed `ProviderFaultCode`, disconnects/requires reconciliation and atomically increments the account's bigint `gap_version`. Decimal strings preserve precision; `MAX_GAP_VERSION` is `9223372036854775807`. The version saturates and changes fault_code to `version-exhausted` on subsequent faults rather than wrapping. Recovery must refuse the maximum version regardless of code.
- `nextGapVersionSql` is a fixed SQL expression reused by healthy ownership invalidation's existing bounded atomic CTE. This preserves the dedicated client's serialized query deadline/discard behavior rather than adding an unbounded cleanup query. External-fence acknowledgement uses the explicit-transaction helper. Runtime faults retain the matching-owner SHARE lock and local synchronous send gate before calling the helper. No status reconnect/heartbeat clears a gap/version.
- New event fields: resolution_version, resolved_at, resolved_by, resolution_ref; variant_overflow, overflow_receipts, last_overflow_hash; variant_evidence_missing. Legacy conflicts lacking discarded payload evidence are marked missing on migration; later evidence never clears that marker automatically.
- `provider_event_variants` retains event_id + semantic_hash primary key, sender_id, kind, bounded text, client_id, provider_timestamp and received_at. The canonical provider event and projected message stay unchanged. At most8 differing normalized variants are retained under the existing conversation-row lock. Overflow retains only a bounded receipt counter/last hash and permanently blocks resolution in the proposed operator service. No raw SDK JSON/media URLs are retained.
- New evidence invalidates any prior resolution and increments resolution_version. Known canonical/retained-variant replay after explicit resolution does not re-open; unresolved replay reasserts quarantine/increments gap_version. A genuinely new hash reopens the conflict. Repeated unretained overflow hashes cannot be treated as complete retained evidence.

## Verification and limits

The previous implementer reported a missing-module RED followed by one pure boundary GREEN before its session ended; this continuation did not repeat that initial source state. Current verification independently executed17/17 filtered ownership/fault/runtime regressions PASS, including invalid fault codes/decimal versions, runtime fault transaction order and dedicated-client failure/cancellation behavior. `npm run typecheck` and `git diff --check` passed.

Continuation review corrected a ceiling edge: the receipt reaching resolution_version MAX from MAX-1 now sets the permanent overflow gate immediately, not only on a subsequent receipt. Added a PostgreSQL regression for that transition; this SQL behavior remains UNPROVEN locally rather than a demonstrated executed RED/GREEN.

Hosted SQL scenarios now cover two retained variants, canonical preservation, exact replay, resolved known replay, genuinely new reopening, ninth-variant overflow, migration/legacy evidence retention,30 concurrent variant receipts retaining exactly8, resolution-version ceiling, bigint fault precision/exhaustion, explicit transaction refusal and a blocked stale acknowledgement versus a new fault. None of these SQL assertions were reattempted locally: previously established PostgreSQL EPERM remains, and the coordinating hosted CI must execute them. No database setup failure is counted as a pass.

## Required integration boundaries

Task2 must reject variant_evidence_missing, variant_overflow, exhausted resolution versions and MAX_GAP_VERSION recovery; it must never reset an unknown message to pending. Root must include variants in counts/fingerprints and nonempty fixtures and increment the gap version during restore quarantine. Independent review and hosted full SQL/race/recovery evidence remain required before source acceptance. This is no claim of production readiness, actual history completeness or real-phone compatibility.
