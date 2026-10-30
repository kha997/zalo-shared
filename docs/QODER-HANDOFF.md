# Qoder handoff — Zalo Shared

Updated: 2026-10-30
Repository: https://github.com/kha997/zalo-shared
Working branch: feat/shared-inbox
Pull request: #3 (keep draft; do not merge or deploy)

## Current boundary

Continue only with synthetic/offline work until the Owner supplies and approves a dedicated legitimate test account, official phone, consenting peer, four physical workstations, and private host for the staged pilot. Never use HANU production or real customer data. Do not put QR codes, cookies, session keys, account identifiers, or raw provider payloads in GitHub. No public listener or production deployment.

The main application remains provider-disabled/mock and SDK-free in its production image. The pinned `zca-js@2.2.0` is only for development/research/guard tests; no authenticated session was used.

## Latest evidenced baseline before inbound-media work

The latest accepted hosted CI was run **41026456993** on source `4dd6f300`: 145 unit checks, 2 SDK-isolation checks, 9 browser checks passed, 1 intentionally skipped; encrypted backup/restore, integrated four-staff/admin operations flow, monitoring and image scan passed. Sustained 50-client synthetic load p95 was 67 ms; 100/200/500-client observational p95 was about 531/985/2205 ms, so the 500-client latency gate failed at 2 seconds. This does not demonstrate provider compatibility, physical-phone coexistence, or production readiness.

New inbound-media receipt, worker, and private UI changes in the current handoff were not part of that run. Treat their database/whole-flow gates as UNPROVEN until CI on the new commit completes. Local database-backed verification was unavailable in this environment; do not mark these gates passed based on authored tests or reports.

## Work now included in this snapshot

- Encrypted inbound media locator receipts and semantic-conflict evidence, scoped to the owning connector generation.
- A bounded, injected media download worker. It has no scheduler and no real-network test path; it cannot send messages.
- A private, account-scoped media status/read API and staff UI that never returns locator URLs or ciphertext.
- Offline pilot research/implementation plan and updated readiness evidence for the preceding accepted operator-flow run.

These changes are an engineering snapshot for review, not a live provider integration.

## Next steps for Qoder

1. Read this file, `docs/READINESS.md`, `docs/plans/private-pilot-activation.md`, and the inbound receipts/worker/private-UI reports. Confirm the exact remote commit and branch before editing.
2. Run hosted CI for the new head; inspect full logs. Fix failures and retain raw safe summaries. Specifically verify PostgreSQL migration/schema, receipt ingestion and conflict/echo behavior, worker concurrency/owner loss/expiry/quota/restore, private API authorization/redaction, and UI refresh behavior. Do not describe authored-but-unrun SQL cases as PASS.
3. Independently review the current inbound changes and close review findings. Add missing database index for account/message/item media lookup if query plan supports it. Keep review status explicit.
4. Complete media backup/restore fixture coverage using fake cipher, synthetic URLs, and injected downloader only. Verify pending/processing quarantine and ready attachment durability without network access. Document that offline backups can retain encrypted locators after online TTL cleanup.
5. Add bounded, audited admin retry only if the policy is explicit: exact job ID/version, allowlisted retryable errors, attempts remain capped, no bulk/reset, no locator exposure, and no accidental GET-triggered retry. Otherwise defer and mark it open.
6. Add an explicit, reviewed maintenance/retention path for expired locator envelopes and bounded worker scheduling; scheduler must use ownership/fencing and must never retry ambiguous sends. Test with synthetic data.
7. Re-run full hosted CI, four-staff browser flow, recovery/backup restore, SDK isolation, and larger observational load. Update readiness and PR description with exact commit and PASS/FAIL/UNPROVEN.
8. Continue the private test-account harness in `docs/plans/private-pilot-activation.md` only after offline gates are reviewed. Keep QR enrollment separate, private, locally displayed, deny-by-default and UID-bound before session persistence. Owner approval is needed for account/resources and material risk scope; ordinary technical fixes within the same approved scope do not need a repeated approval.
9. Keep PR #3 draft, do not merge, publish, or deploy. Ask the Owner only for the dedicated real test resources/risk acceptance or a production decision after a concrete reviewed offline result is ready.

## Honest status at handoff

- Synthetic core operator/ownership/media-outbound evidence through `4dd6f300`: hosted PASS with the 500-client latency FAIL stated above.
- Inbound receipt/worker/private UI code: present in this snapshot; latest hosted CI and independent integrated review: pending.
- Database-backed local tests, full restore coverage for inbound locator jobs, bounded retention scheduling, and dedicated admin retry: UNPROVEN / open.
- Actual Zalo login, messaging/media, account health, phone coexistence, terms compliance and ban risk: UNPROVEN. Production readiness: NOT ESTABLISHED.
