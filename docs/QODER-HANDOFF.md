# Qoder handoff — Zalo Shared

Updated: 2026-10-30
Repository: https://github.com/kha997/zalo-shared
Working branch: feat/shared-inbox
Pull request: #3 (keep draft; do not merge or deploy)

## Current boundary

Continue only with synthetic/offline work until the Owner supplies and approves a dedicated legitimate test account, official phone, consenting peer, four physical workstations, and private host for the staged pilot. Never use HANU production or real customer data. Do not put QR codes, cookies, session keys, account identifiers, or raw provider payloads in GitHub. No public listener or production deployment.

The main application remains provider-disabled/mock and SDK-free in its production image. The pinned `zca-js@2.2.0` is only for development/research/guard tests; no authenticated session was used.

## Latest evidenced hosted baseline — inbound media

Hosted CI **41076902601** on merge `e1cc3d9` (branch head `05c8082`) passed **171/171** unit checks, **2/2** guarded offline SDK checks and **9 browser cases expected + 1 explicit skip, 0 unexpected**. Raw logs confirm real-PostgreSQL inbound receipt/journal/media-worker and private-UI tests, four-staff browser flow, ownership/recovery, encrypted backup/restore, monitoring and SDK-free nonroot image smoke. Trivy reported 0 HIGH/CRITICAL at scan time. Sustained 50×50 load p95≈108.6 ms; 100/200/500-client observational p95≈1117/1767/4749 ms, so **500 clients FAIL the 2 s target** with zero request errors and all mock queues drained. This does not demonstrate provider compatibility, physical-phone coexistence or production readiness.

## Work in the current working head — completion patch

- Bounded ownership-fenced locator retention and one-step media scheduling; `createOwnedConnector` exposes `runMediaOnce()` under the same gap/terminal fence.
- Quota exhaustion now persists the event and degrades only that receipt's media to `queue-full` instead of rolling back text ingress.
- Media jobs are indexed by message, included in counts/integrity, and quarantined on restore.
- Key coverage is checked before downloads; the runbook now requires locator-key escrow and explicit rotation/retirement.
- Attachment bytes for provider media are served only while the job is `ready`.
- Independent findings and PASS/FAIL/UNPROVEN dispositions: [inbound media completion review](review/inbound-media-completion-review.md).

Local typecheck passes; full local suite is 177/179 with two Windows-only POSIX file-mode assertions. Hosted CI for this patch is pending. It is still an engineering snapshot, not a live provider integration.

## Historical snapshot

- Encrypted inbound media locator receipts and semantic-conflict evidence, scoped to the owning connector generation.
- A bounded, injected media download worker. It has no real-network test path and cannot send messages.
- A private, account-scoped media status/read API and staff UI that never returns locator URLs or ciphertext.

## Next steps for Qoder

1. Read this file, `docs/READINESS.md`, `docs/plans/private-pilot-activation.md`, and the inbound receipts/worker/private-UI reports. Confirm the exact remote commit and branch before editing.
2. Run hosted CI for the completion patch; inspect full logs. Fix failures and retain raw safe summaries. Verify PostgreSQL migration/schema, receipt ingestion, worker concurrency/owner loss/expiry/quota, retention/scheduler, private API authorization and UI refresh. Do not describe authored-but-unrun SQL cases as PASS.
3. ~~Independently review the current inbound changes and close review findings; add the media lookup index.~~ Done in the working head; see the completion review. Re-review after CI.
4. ~~Complete media backup/restore fixture coverage.~~ Done in the working head; hosted drill remains pending.
5. Admin retry remains deferred/open. Do not add it without an explicit policy (exact job/version, allowlisted retryable errors, capped attempts, no locator exposure, no accidental GET retry).
6. ~~Add ownership-fenced retention and bounded worker scheduling.~~ Done in the working head. The pilot runtime must still own the long-lived loop; the main app stays provider-disabled.
7. Re-run full hosted CI, four-staff browser flow, recovery/backup restore, SDK isolation, and larger observational load. Update readiness and PR description with exact commit and PASS/FAIL/UNPROVEN.
8. Continue the private test-account harness in `docs/plans/private-pilot-activation.md` only after offline gates are reviewed. Keep QR enrollment separate, private, locally displayed, deny-by-default and UID-bound before session persistence. Owner approval is needed for account/resources and material risk scope; ordinary technical fixes within the same approved scope do not need a repeated approval.
9. Keep PR #3 draft, do not merge, publish, or deploy. Ask the Owner only for the dedicated real test resources/risk acceptance or a production decision after a concrete reviewed offline result is ready.

## Honest status at handoff

- Inbound receipt/worker/private UI: hosted PASS at `05c8082`/`e1cc3d9`; 500-client latency FAIL remains.
- Completion patch (retention/scheduler/runtime seam/restore/index/healthy attachment gating): local PASS, hosted CI pending.
- Long-lived pilot runtime wiring, dedicated admin retry, metadata/attachment retention policy and duplicate-egress bounds: open.
- Actual Zalo login, messaging/media, account health, phone coexistence, terms compliance and ban risk: UNPROVEN. Production readiness: NOT ESTABLISHED.
