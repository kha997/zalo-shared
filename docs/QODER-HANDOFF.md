# Qoder handoff — Zalo Shared

Updated: 2026-11-02
Repository: https://github.com/kha997/zalo-shared
Working branch: feat/shared-inbox
Pull request: #3 (keep draft; do not merge or deploy)

## Current boundary

Continue only with synthetic/offline work until the Owner supplies and approves a dedicated legitimate test account, official phone, consenting peer, four physical workstations, and private host for the staged pilot. Never use HANU production or real customer data. Do not put QR codes, cookies, session keys, account identifiers, or raw provider payloads in GitHub. No public listener or production deployment.

The main application remains provider-disabled/mock and SDK-free in its production image. The pinned `zca-js@2.2.0` is only for development/research/guard tests; no authenticated session was used.

## Latest evidenced hosted baseline — inbound media completion

Hosted CI **41370951223** on `c1289331493f7bde3439a902f337a18a526eaadd` passed **179/179** unit checks, **2/2** guarded offline SDK checks and **9 browser cases expected + 1 explicit skip, 0 failed**. Raw logs confirm real-PostgreSQL inbound receipt/journal/media-worker, retention/scheduler, ownership/recovery, encrypted backup/restore with media quarantine, monitoring and SDK-free nonroot image smoke. Trivy reported 0 HIGH/CRITICAL. Sustained 50×50 load p95≈123.2 ms; 4/10/25/50-client p95≈52.9/66.5/177.9/308.0 ms; 100/200/500-client p95≈1610.6/1498.2/4132.4 ms, so **500 clients FAIL the 2 s target** with zero request errors and all mock queues drained. This does not demonstrate provider compatibility, physical-phone coexistence or production readiness.

## Work in the committed head — private pilot contract

- Expiring grant and Owner-consent scope validation, including build identity, bound account, peers, purposes, daily part budget and minimum interval.
- Transaction-required, advisory-locked, durable per-account/day budget with idempotent `(message_id,part)` reservations and no reset on restart, day rollover or a new grant.
- Exact-UID facade binding: `expectedAccountId` is validated before vault access/import, and `getOwnId` is checked after login and every refresh before cookie persistence or API/listener exposure.
- Budget/ledger tables are included in counts, integrity fingerprints, the representative journal and restore drill.

Local typecheck passes; full local suite 201/203 (two Windows-only vault mode assertions). Hosted [CI 41372493757](https://github.com/kha997/zalo-shared/actions/runs/41372493757) on `7e66b98` passed 203/203 units, 2/2 guarded SDK checks, 9 browser cases + 1 skip, restore/restart, monitoring and nonroot SDK-free image smoke with 0 HIGH/CRITICAL; 500-client p95 2814.4 ms FAILS the 2 s target. Independent review findings and dispositions: [private pilot policy review](review/private-pilot-policy-review.md).

## Work in the uncommitted tree — QR enrollment and private files

- `adapters/zalo/qr-bootstrap.ts`: ownership-checked, expiring-grant QR enrollment. It decodes only bounded canonical PNGs, passes no `qrPath`, never calls `saveToFile`/retry, never starts the listener or sends, ignores the GotLoginInfo cookie, requires the final `getOwnId` and final serialized jar, requires synchronous TTY identity confirmation, stages one encrypted write and signals `quarantine-unconfirmed` if quarantine cannot be confirmed.
- `server/private-pilot-files.ts`: AES-256-GCM session envelope and atomic install; 0700/0600/non-symlink checks with POSIX ancestor realpath; stale ciphertext-temp sweep; bounded private manifest reader.
- `tools/pilot-connector.ts`: dry-run default that never imports the SDK, touches DB/network or reads the vault; live commands require `--acknowledge-pilot-risk`, an absolute private manifest, the matching grant purpose and a Linux host; all output is fixed status JSON with no account, peer, grant or consent identifiers.
- Local evidence: typecheck/build PASS, focused suites 26/26 PASS, full local suite 227/229 (only the two Windows-only `vault.test.ts` POSIX assertions). Review and dispositions: [private pilot QR bootstrap review](review/private-pilot-qr-bootstrap-review.md). Hosted CI for this slice is pending.

## Historical snapshot

- Encrypted inbound media locator receipts and semantic-conflict evidence, scoped to the owning connector generation.
- A bounded, injected media download worker. It has no real-network test path and cannot send messages.
- A private, account-scoped media status/read API and staff UI that never returns locator URLs or ciphertext.

## Next steps for Qoder

1. Read this file, `docs/READINESS.md`, `docs/plans/private-pilot-activation.md`, and the inbound receipts/worker/private-UI reports. Confirm the exact remote commit and branch before editing.
2. ~~Run hosted CI for the completion patch; inspect full logs.~~ Done: run 41370951223, 179/179, 2/2, 9+1 browser, restore and container PASS. Re-run after the pilot contract commit and inspect the SQL budget/ledger stages.
3. ~~Independently review the current inbound changes and close review findings; add the media lookup index.~~ Done; see the completion review. The pilot policy/budget/UID changes now need their own independent review before commit.
4. ~~Complete media backup/restore fixture coverage.~~ Done and hosted PASS, including pilot budget/ledger fixtures in the working head.
5. Admin retry remains deferred/open. Do not add it without an explicit policy (exact job/version, allowlisted retryable errors, capped attempts, no locator exposure, no accidental GET retry).
6. ~~Add ownership-fenced retention and bounded worker scheduling.~~ Done in the working head. The pilot runtime must still own the long-lived loop; the main app stays provider-disabled.
7. Re-run full hosted CI, four-staff browser flow, recovery/backup restore, SDK isolation, and larger observational load. Update readiness and PR description with exact commit and PASS/FAIL/UNPROVEN.
8. Continue the private test-account harness in `docs/plans/private-pilot-activation.md` only after offline gates are reviewed. Keep QR enrollment separate, private, locally displayed, deny-by-default and UID-bound before session persistence. Owner approval is needed for account/resources and material risk scope; ordinary technical fixes within the same approved scope do not need a repeated approval.
9. Keep PR #3 draft, do not merge, publish, or deploy. Ask the Owner only for the dedicated real test resources/risk acceptance or a production decision after a concrete reviewed offline result is ready.

## Honest status at handoff

- Inbound receipt/worker/private UI and completion patch: hosted PASS at `c128933`/41370951223; 500-client latency FAIL remains.
- Private pilot policy/budget/UID gates: local and hosted PASS at `7e66b98`/41372493757.
- QR enrollment and private files/CLI: local synthetic PASS pending hosted CI; runtime dispatch, separate image and live scan still open.
- Long-lived pilot runtime wiring, dedicated admin retry, metadata/attachment retention policy and duplicate-egress bounds: open.
- Actual Zalo login, messaging/media, account health, phone coexistence, terms compliance and ban risk: UNPROVEN. Production readiness: NOT ESTABLISHED.
