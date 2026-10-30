# Versioned fault recovery independent review

Verdict: **no P0/P1/P2 identified in the scoped source; accepted conditionally on hosted PostgreSQL/restart/restore execution**. This is Task1 fault-evidence durability review, not completion of all operator controls or production acceptance.

## Scope and method

Reviewed the current ops delta against local612c6b3: `ops/counts.sql`, `ops/integrity.sql`, `ops/restore.sh`, `ops/ci-provider-journal.ts` and `ops/ci-backup-drill.sh`, with existing backup/restore manifest and workflow ordering. Read the new conflict-variant/gap-version schema and existing fixture flow. No product edits, database attempts, external network, SDK/account operations or commits were performed. Only this report was authored.

## Assessment

- The variant table participates in counts and full-row content fingerprints, with deterministic ordering by its composite key `(event_id,semantic_hash)`. Provider-event and provider-state full-row hashes already include resolution metadata and gap versions. Fresh restore compares complete original counts/fingerprints before quarantine changes any dispatch or gap state.
- The guarded disposable mock fixture now submits two differing semantic payloads for one canonical provider ID through actual ingestion. The drill requires at least two retained variants, a nonzero gap, linked/held/conflict journal rows and existing staff/media/ownership fixtures. The workflow runs fixture creation only after browser/load workers have stopped, then compares unclean-restart fingerprints.
- Variant and canonical event digests are checked again after restore quarantine, so the intentional provider-state change cannot hide mutation or loss of event evidence. The variant digest refuses empty input. These are positive source-wired assertions, still awaiting hosted SQL execution.
- Restore disconnects the provider, preserves required reconciliation, increments gap_version once when below the bigint ceiling and saturates at the ceiling. It preserves existing event/variant evidence and quarantines ownership as before. Task2 must reject MAX_GAP_VERSION independently of fault_code, including a restore that first reaches MAX; this review does not weaken that existing required gate.
- The drill captures the ACCOUNT bigint version, requires a digits-only 1..19-character value before SQL interpolation, and compares the exact increment/saturation result after restore. This value comes from a constrained PostgreSQL bigint column, so it cannot introduce SQL syntax or exceed bigint range. Bash expansion leaves the intended `::bigint` cast suffix intact.
- Existing session revocation, unknown-job quarantine, media byte/link checks, uncertain/idle ownership checks and runtime audit/CONNECT restrictions remain present. The change does not add a dispatcher, network worker or restored admission path.

## Executed evidence and limits

`bash -n ops/restore.sh ops/ci-backup-drill.sh ops/backup.sh` and scoped `git diff --check` exited0. No SQL/restart/restore case was run locally; those outcomes remain **UNPROVEN** for this delta until hosted CI validates the exact source snapshot. The current fixture exercises an ordinary nonzero version; an exhausted-version restore branch and later resolved-conflict/admin metadata should gain positive coverage in the complete operator phase. Their absence is not reported as an executed pass. No real Zalo, phone or production readiness is established.
