# Ownership recovery independent review

Verdict: **no P0/P1/P2 identified in the scoped recovery source; accepted conditionally on hosted SQL/restart/restore evidence**. This is not runtime ownership, external fencing or production acceptance.

## Scope and method

Reviewed the ownership delta against local c92abf8 in ops/counts.sql, integrity.sql, restore.sh, ci-provider-journal.ts and ci-backup-drill.sh, plus ownership DDL and docs/review/ownership-recovery-report.md. Inspected existing backup ordering, the CI worker shutdown/restart sequence and ownership admission's idle-state requirement. No product edits, database attempt, external network, SDK/account operation or commit was performed. Only this review report was authored.

## Assessment

- Backup counts include connector_ownership. The full-row SHA256 aggregation orders by the primary account ID, so epoch, owner UUID, phase and fencing history participate in the same pre-quarantine restart/restore fingerprints as existing data. Existing media, journal and audit coverage remains intact.
- Fresh restore compares original counts and full-content fingerprints before changing ownership. Its quarantine transaction revokes sessions, holds uncertain dispatch parts/jobs, disconnects provider with reconciliation_required=true, then forces every ownership row uncertain. Existing non-NULL owner UUIDs and epochs are preserved; a previously idle row receives a new UUID, satisfying the idle-if-and-only-if-NULL constraint without enabling admission. Fault reason is fixed and no SDK operation is invoked.
- The disposable fixture retains its explicit mock/database-name opt-in and runs after load/browser workers have stopped. It requires the main account owner to be pristine idle before creating an epoch17 uncertain owner. A second synthetic idle row covers the previously NULL-owner restore branch; the report correctly avoids claiming application multi-account support. A nonempty fixture is required before backup.
- Post-restore assertions cover no sessions/dispatchable jobs, disconnected/reconciliation-required provider, uncertain non-NULL ownership, preserved epoch17/label and the second idle-to-uncertain UUID branch. Bound-media linkage/content, journal content/count and runtime CONNECT/audit restrictions are retained. Original owner UUID preservation follows the SQL coalesce expression and pre-quarantine fingerprint check; the final drill does not independently compare that UUID after quarantine. No concrete source defect was identified in that transformation.
- Ownership admission requires phase idle, whereas restored rows are uncertain. The restore therefore cannot admit a connector through the reviewed admission API. A separate admin fencing attestation and gap reconciliation are still required; database quarantine does not verify provider-side cancellation or external egress isolation. No dispatcher is started against the restored database by this drill.

## Verification and remaining evidence

`bash -n ops/restore.sh ops/backup.sh ops/ci-backup-drill.sh`: **PASS**, exit0. No real SQL assertion was executed in this review. Hosted ownership CI must execute the nonempty fixture, full fingerprints across unclean restart, encrypted fresh restore, both quarantine branches and ownership admission tests before these runtime outcomes can be marked PASS. Current media-only CI does not validate this uncommitted ownership delta.
