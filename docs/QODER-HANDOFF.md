# Qoder handoff — Zalo Shared

Updated: 2026-11-02
Repository: https://github.com/kha997/zalo-shared
Working branch: feat/shared-inbox
Pull request: #3 (keep draft; do not merge or deploy)

## Current boundary

Continue only with synthetic/offline work until the Owner supplies and approves a dedicated legitimate test account, official phone, consenting peer, four physical workstations, and private host for the staged pilot. Never use HANU production or real customer data. Do not put QR codes, cookies, session keys, account identifiers, or raw provider payloads in GitHub. No public listener or production deployment.

The main application remains provider-disabled/mock and SDK-free in its production image. The pinned `zca-js@2.2.0` is only for development/research/guard tests; no authenticated session was used.

## Latest evidenced hosted baseline — QR enrollment and CLI

Hosted CI **41374543813** on `ad036f60ae4fa4a8b00cbd72e584c0a0128e1784` passed **229/229** unit checks, **2/2** guarded offline SDK checks and **9 browser cases expected + 1 explicit skip, 0 failed**, including the full PostgreSQL, transport, recovery/restore, monitoring and SDK-free nonroot image stages. The prior inbound-media completion baseline is CI 41370951223 on `c128933` (179/179, 2/2, 9+1). Neither run demonstrates provider compatibility, physical-phone coexistence or production readiness.

## Work in the committed head — private pilot contract

- Expiring grant and Owner-consent scope validation, including build identity, bound account, peers, purposes, daily part budget and minimum interval.
- Transaction-required, advisory-locked, durable per-account/day budget with idempotent `(message_id,part)` reservations and no reset on restart, day rollover or a new grant.
- Exact-UID facade binding: `expectedAccountId` is validated before vault access/import, and `getOwnId` is checked after login and every refresh before cookie persistence or API/listener exposure.
- Budget/ledger tables are included in counts, integrity fingerprints, the representative journal and restore drill.

Local typecheck passes; full local suite 201/203 (two Windows-only vault mode assertions). Hosted [CI 41372493757](https://github.com/kha997/zalo-shared/actions/runs/41372493757) on `7e66b98` passed 203/203 units, 2/2 guarded SDK checks, 9 browser cases + 1 skip, restore/restart, monitoring and nonroot SDK-free image smoke with 0 HIGH/CRITICAL; 500-client p95 2814.4 ms FAILS the 2 s target. Independent review findings and dispositions: [private pilot policy review](review/private-pilot-policy-review.md).

## Committed head — QR enrollment and private files (hosted PASS)

- `adapters/zalo/qr-bootstrap.ts`: ownership-checked, expiring-grant QR enrollment. It decodes only bounded canonical PNGs, passes no `qrPath`, never calls `saveToFile`/retry, never starts the listener or sends, ignores the GotLoginInfo cookie, requires the final `getOwnId` and final serialized jar, requires synchronous TTY identity confirmation, stages one encrypted write and signals `quarantine-unconfirmed` if quarantine cannot be confirmed.
- `server/private-pilot-files.ts`: AES-256-GCM session envelope and atomic install; 0700/0600/non-symlink checks with POSIX ancestor realpath; stale ciphertext-temp sweep; bounded private manifest reader.
- `tools/pilot-connector.ts`: dry-run default that never imports the SDK, touches DB/network or reads the vault; live commands require `--acknowledge-pilot-risk`, an absolute private manifest, the matching grant purpose and a Linux host; all output is fixed status JSON with no account, peer, grant or consent identifiers.
- Hosted PASS at `ad036f6`/41374543813; review and dispositions: [private pilot QR bootstrap review](review/private-pilot-qr-bootstrap-review.md).

## Committed head — pilot runtime and isolated connector image (hosted PASS)

- `tools/pilot-runtime.ts`: single-lifetime owned connector loop, pre-start abort, grant shape/lifetime/peer/budget/interval validation, observe-never-dispatch, send-test at the grant interval, policy-halt propagation, exact direct-peer inbound gate bound to the account, and real Linux host wiring with encrypted session/key files.
- `server/private-pilot-files.ts`: session envelopes carry an explicit key identifier bound into AES-GCM AAD, so rotation is explicit and cross-id reads fail.
- `tools/pilot-connector.ts`: safety halts now exit 1 and expose only bounded counters; live commands return the loop outcome.
- `ops/Dockerfile.connector`, `connector/`, `tsconfig.connector.json`, `ops/pilot-compose.example.yml`, `ops/pilot-scan.sh`, `ops/ci-pilot-manifest.ts`: separate SDK-bearing image with an exact dedicated lock, UID 65532, no ports, default dry-run, and a hosted `pilot` CI job that builds, dry-runs, inventories and scans it. The application image remains SDK-free.
- Locally: typecheck/build/build:connector PASS; focused pilot/connector/QR/recovery suites 59/59 PASS; full local suite 253 tests, 251 PASS, 2 FAIL (only the two Windows-only `vault.test.ts` POSIX assertions).
- Hosted [CI 41377272040](https://github.com/kha997/zalo-shared/actions/runs/41377272040) on `105f2d7` passed both jobs: 251/251 units, 2/2 guarded SDK checks, 9 browser cases + 1 skip, dry-run admitted, UID 65532, `zca-js` 2.2.0, no exposed ports, Trivy 0 HIGH/CRITICAL (0 fixable). The first run (`f9ac8e5`) passed every substantive pilot step but failed evidence upload because the owner-only synthetic manifest was inside `docs/evidence/`; it is now generated in `$RUNNER_TEMP`. [Retained measurements](evidence/ci-pilot-runtime-results.json).
- Review: [private pilot runtime review](review/private-pilot-runtime-review.md) (H1, M1–M4, L2–L5/L7 fixed; L1/L6 accepted and documented) and [connector image review](review/private-pilot-connector-image-review.md).

## Historical snapshot

- Encrypted inbound media locator receipts and semantic-conflict evidence, scoped to the owning connector generation.
- A bounded, injected media download worker. It has no real-network test path and cannot send messages.
- A private, account-scoped media status/read API and staff UI that never returns locator URLs or ciphertext.

## Next steps for Qoder

1. Read this file, `docs/READINESS.md`, `docs/plans/private-pilot-activation.md`, and the inbound receipts/worker/private-UI reports. Confirm the exact remote commit and branch before editing.
2. ~~Run hosted CI for the completion patch; inspect full logs.~~ Done: 41370951223. ~~Run hosted CI for the pilot contract.~~ Done: 41372493757. ~~Run hosted CI for QR enrollment/CLI.~~ Done: 41374543813.
3. ~~Independently review inbound and pilot policy changes.~~ Done. ~~Review the pilot runtime/image slice.~~ Done; see the two pilot review documents. The hosted `pilot` job for the image/scan slice is still pending.
4. ~~Complete media backup/restore fixture coverage.~~ Done and hosted PASS.
5. Admin retry remains deferred/open. Do not add it without an explicit policy (exact job/version, allowlisted retryable errors, capped attempts, no locator exposure, no accidental GET retry).
6. ~~Add ownership-fenced retention and bounded worker scheduling.~~ Done, hosted PASS. The pilot loop still sets `media:false`; wiring real media download requires a private CDN drill and remains open.
7. ~~Commit and push the pilot runtime/image slice, run full hosted CI including the new `pilot` job, and update readiness.~~ Done: `f9ac8e5` plus the artifact-upload fix `105f2d7`; run 41377272040 green.
8. Continue the private test-account harness in `docs/plans/private-pilot-activation.md` only after the offline gates are reviewed. Keep QR enrollment separate, private, locally displayed, deny-by-default and UID-bound before session persistence. Owner approval is needed for account/resources and material risk scope; ordinary technical fixes within the same approved scope do not need a repeated approval.
9. Keep PR #3 draft, do not merge, publish or deploy. Ask the Owner only for the dedicated real test resources/risk acceptance or a production decision after a concrete reviewed offline result is ready.

## Honest status at handoff

- Inbound receipt/worker/private UI and completion patch: hosted PASS at `c128933`/41370951223; 500-client latency FAIL remains.
- Private pilot policy/budget/UID gates: local and hosted PASS at `7e66b98`/41372493757.
- QR enrollment, private files and CLI: hosted PASS at `ad036f6`/41374543813.
- Pilot runtime, separate connector image, scan and review fixes: local and hosted PASS at `105f2d7`/41377272040.
- Long-lived pilot runtime live drill, media scheduling in the pilot loop, dedicated admin retry, metadata/attachment retention policy and duplicate-egress bounds: open.
- Actual Zalo login, messaging/media, account health, phone coexistence, terms compliance and ban risk: UNPROVEN. Production readiness: NOT ESTABLISHED.
