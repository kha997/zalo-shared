# Ownership recovery integration

Ownership rows now participate in backup counts and full-row content fingerprints. The guarded disposable CI fixture requires a pristine ACCOUNT owner row, persists an uncertain synthetic owner at epoch17, and adds a second synthetic idle row solely to cover the NULL-owner restore branch (not application multi-account support).

Fresh restore first verifies full original counts/fingerprints, then quarantines all ownership rows as uncertain with non-NULL owner identities, preserving existing owner/epoch and assigning a synthetic quarantine identity for prior idle rows. Provider state is disconnected and reconciliation_required=true. The drill asserts nonempty uncertain/idle preconditions and both post-restore branches while preserving bound-media/journal/audit checks. No dispatcher is started against the restore.

Local bash syntax and diff checks PASS; SQL/restart/restore runtime acceptance remains UNPROVEN until hosted ownership CI. Database locks and quarantine are local admission controls, not external provider egress fencing. No account/SDK login or production action.
