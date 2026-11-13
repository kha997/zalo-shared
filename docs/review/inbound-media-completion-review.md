# Inbound media completion — independent review and dispositions

Reviewed: 2026-11-02. Baseline `05c8082d200a78a7017f5a823277e7aa1a7cfe1e` plus the working-tree completion patch. This report is an engineering review of synthetic/offline code only. No live provider, account, network download or production deployment was used.

## Scope

`server/provider-store.ts`, `server/media-jobs.ts`, `server/media-worker.ts`, new `server/media-retention.ts`, new `server/media-scheduler.ts`, `server/app.ts` media projection/attachment boundary, `adapters/zalo/connector-runtime.ts`, `server/provider-schema.ts`, and the `ops/` counts/integrity/restore/drill fixtures.

The earlier findings F1–F9 were raised against the inbound-media worker snapshot. Dispositions below state exactly what changed and what remains open.

## Findings and dispositions

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| F1 | P1 | Nothing ran the media worker; jobs stayed held/pending, quota filled, and quota exhaustion aborted the whole receipt so media-heavy days could halt text ingress. | **Source fixed.** `media-scheduler.ts` runs bounded, ownership-rechecked retention plus one download step; `connector-runtime.ts` exposes `runMediaOnce()` under the same gap/terminal dispatch fence. Quota exhaustion now persists the event and marks only that receipt's media `unavailable`/`queue-full` instead of rolling back text. Remaining gate: no long-lived production loop calls `runMediaOnce()`; the pilot runtime must own that loop, and the main app stays provider-disabled/mock. |
| F2 | P1 | `provider_media_jobs` was absent from counts/integrity, and restore did not quarantine pending/processing jobs. | **Fixed.** Table added to `ops/counts.sql` and `ops/integrity.sql`; `ops/restore.sh` moves pending/processing to `held`, clears `claimed_at`, and bumps version without wrapping. The CI drill seeds named ready/pending/processing/held/unavailable jobs and asserts the post-restore state and byte linkage. |
| F3 | P1 | A host without the locator key silently converted every envelope to `key-unavailable`; key durability after restore was unverified. | **Mitigated offline.** The scheduler checks distinct envelope `keyId` values against the keyring and refuses downloads with `key-missing` without logging locators. Runbook now requires independent key escrow and an explicit rotation/retirement procedure. Live key custody and restore with real keys remain UNPROVEN. |
| F4 | P1 latent | The per-message media projection had no supporting index. | **Fixed.** Added `provider_media_jobs_message(account_id,message_id,item_index,id) WHERE message_id IS NOT NULL`. The 500-client latency FAIL is not attributed to this index. |
| F5 | P2 | Ownership can be revoked during a bounded media GET; the request may still egress with a decrypted locator. | **Accepted residual.** The worker checks ownership immediately before the GET, but a database fence cannot cancel already-entered network I/O. The response is discarded unless a later CAS and owner-row check succeed, and media work never sends messages. True cancellation/egress isolation requires process-level fencing at the pilot host. |
| F6 | P2 | Several `version=version+1` updates could overflow the bigint ceiling and abort the ingest transaction. | **Fixed.** All touched updates use the guarded ceiling expression. |
| F7 | P2 | The receipt contract accepts exactly one media item, so a future multi-item/album capture would abort the whole receipt. | **Open, documented.** Current transport captures one item; album support is not implemented. A future parser must degrade per-item to `unavailable` rather than throw. This is a known limitation, not a claimed album capability. |
| F8 | P2 | Materialized bytes could remain downloadable after a media job stopped being `ready`. | **Partially fixed.** `/api/attachments/:id` now serves provider-media bytes only while the referencing job is `ready`; staff-upload and outbound message attachments keep existing behavior. Current conflict resolution only retains the canonical receipt, and media jobs are created for that canonical receipt, so alternate-variant bytes are never materialized. If a future resolution can select non-canonical bytes, an explicit retraction design is required. |
| F9 | P2 | Metadata, audit and attachment retention/purge are undefined; duplicate GET amplification is possible after a worker DB-session loss. | **Open, Owner decision.** Locator envelopes expire after 24h through the scheduler, but message/job/audit/attachment rows and duplicate egress are not bounded. The code does not delete audit or message history. Storage retention, purge authority and duplicate-egress acceptance remain explicit operating decisions. |

## Verification performed

- `npm run typecheck`: PASS.
- Local full suite: 179 tests, 177 PASS, 2 FAIL. Both failures are `tests/transport/vault.test.ts` file-mode assertions (`438` vs `384`) caused by Windows not honoring POSIX `0600`; the code is unchanged and Linux hosted CI must confirm.
- New `tests/backend/media-scheduler.test.ts`: 6/6 PASS (retention scope, fail-closed owner, bound, key-missing, bounded scheduler, index).
- New `tests/backend/connector-media-seam.test.ts`: 2/2 PASS (one bounded download under the fence with no outbox mutation; opt-in seam and owner-fence refusal).
- `tests/backend/media-jobs.test.ts` and `tests/backend/media-private-api.test.ts`: PASS with the queue-full and ready-only attachment assertions.
- CI fixtures and drill assertions are authored but hosted execution is UNPROVEN until the next CI run.

## PASS / FAIL / UNPROVEN

| Claim | Status |
|---|---|
| Offline/source behavior of retention, scheduler, quota degradation and restore quarantine | PASS locally; hosted UNPROVEN |
| Attachment authorization restricted to `ready` provider media | PASS locally; hosted UNPROVEN |
| Production process actually schedules media work | UNPROVEN — pilot runtime integration gate |
| Real CDN download, cookie-free media, live locator schema | UNPROVEN |
| Real account, phone coexistence, account-ban risk | UNPROVEN |
| Retention/purge policy and storage bounds | OPEN — Owner decision |
| Album/multi-item media | NOT IMPLEMENTED |
| Production readiness | NOT ESTABLISHED |
