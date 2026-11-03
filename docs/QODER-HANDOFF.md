# Qoder handoff — Zalo Shared

Updated: 2026-11-03
Repository: https://github.com/kha997/zalo-shared
Working branch: feat/shared-inbox
Pull request: #3 (keep draft; do not merge or deploy)

## Current boundary

Continue only with synthetic/offline work until the Owner supplies and approves a dedicated legitimate test account, official phone, consenting peer, four physical workstations, and private host for the staged pilot. Never use HANU production or real customer data. Do not put QR codes, cookies, session keys, account identifiers, or raw provider payloads in GitHub. No public listener or production deployment.

The main application remains provider-disabled/mock and SDK-free in its production image. The pinned `zca-js@2.2.0` is only for development/research/guard tests; no authenticated session was used.

## Network boundary resolution — G5-A (2026-11-03)

The R2 egress and R3 LAN blockers are resolved. The enforcement boundary is the
Docker `internal=true` topology plus a separate TLS-SNI gateway, not the
process-local Node guard. Implementation is committed at `2dff06e`; evidence is
in [G5A-NETWORK-BOUNDARY.md](evidence/G5A-NETWORK-BOUNDARY.md) with independent
review dispositions in
[G5A-NETWORK-BOUNDARY-REVIEW.md](evidence/G5A-NETWORK-BOUNDARY-REVIEW.md).
Authoritative state: [PILOT-GATE-STATUS.md](../PILOT-GATE-STATUS.md)
(`G5A_NETWORK_BOUNDARY_VERIFIED`).

- Connector image `zalo-shared-connector:g5-local`
  `sha256:9bced3eb…c8427998`; gateway
  `zalo-shared-egress-gateway:g5-local` `sha256:bfde5c7a…85ad4e75`. Embedded
  build identity matches `2dff06e`, the connector lock and the SDK integrity.
- Verified offline: static topology 15 assertion groups; unit 39/39; allow-path
  21/21; container boundary 25/25 (including a non-internal namespace refusal
  and probes with the guard provably absent); LAN 10/10; full suite 327/327 on
  Node v24.19.0.
- R2 is PASS for bootstrap only. Observe and send-test stay blocked until their
  runtime-only service-map/WebSocket hosts are admitted; the nine-host SDK
  inventory and the three admitted names are in
  [G5A-PROVIDER-ENDPOINT-POLICY.md](evidence/G5A-PROVIDER-ENDPOINT-POLICY.md).
- R3 is PASS for the pilot resources (bind scope and `internal=true`). The host
  as a whole remains UNPROVEN without an independent LAN device, and native
  Linux host-service reachability is a documented residual.
- Incident: an unauthorised diagnostic probe earlier in this directive
  contacted `id.zalo.me` and `wss://jr.chat.zalo.me/ws` without credentials or a
  session. Disclosed in
  [G5A-BOUNDARY-PROBE-INCIDENT.md](evidence/G5A-BOUNDARY-PROBE-INCIDENT.md); it
  is not evidence for any gate.
- No live login, QR scan, session, send or deployment occurred. No activation
  window is selected. A new G5-A authorization is required.


## Latest evidenced hosted baseline — restore re-audit

Hosted [CI 41386800622](https://github.com/kha997/zalo-shared/actions/runs/41386800622) on `a810087` (PR merge `2bd5e7f`) passed both jobs: **273/273** unit checks, **2/2** guarded offline SDK checks, **9 browser cases + 1 explicit skip, 0 unexpected**, and the pilot job. The restore drill now seeds an interrupted `processing` outbox/message/part fixture, asserts it before backup, and verifies all three rows become `unknown` after restore; the remaining `dispatchable|1` is the never-attempted pending fixture preserved by design. The no-network dry-run was admitted; the connector identity matched the PR merge commit and connector lock; inventory reported UID 65532, no ports/private files and both images **0 HIGH/CRITICAL (0 fixable)**. Load p95 was 62.9/82.9/222.5/435.6 ms at 4/10/25/50 clients, 119.7 ms for 50×50, 928.7/1661.8 ms at 100/200; **500 clients FAIL** at 3135.5 ms with zero request errors. The prior baseline was CI 41385140560 on `e0e635d` (273/273, 2/2, 9+1). None of these runs demonstrates provider compatibility, physical-phone coexistence or production readiness.

## Working slice — second-review hardening (hosted PASS)

A second independent review of the committed pilot slice found one high-impact defect and several medium issues; all are fixed and hosted CI passed at `a37935a`/41379964911.

- Policy halts take precedence over the abort they trigger; an ambiguous send can no longer exit 0 as `aborted`, and any halt outside `tick-limit`/`grant-expired`/`aborted` exits non-zero.
- Send-test can dispatch: the owned connector publishes `provider_state='connected'` after ownership, the UID-bound facade, transport start and `markActive`, under the active owner row lock, refusing while reconciliation is required. Ownership shutdown still returns it to disconnected/quarantined.
- Worker claims are scoped to the grant peers; out-of-scope mail is never claimed or failed, and a denied destination defers rather than fails.
- The image now embeds `/app/build-identity.json` (commit, connector lock hash, SDK integrity) and the runtime refuses a manifest that does not match; `DATABASE_URL` requires TLS for non-loopback hosts.
- The bound account is rejected in every peer allowlist; the scanner rejects private pilot files inside the image; CI asserts the image identity equals `GITHUB_SHA`.
- `startPilotRuntime` validates the full manifest (build, consent, purpose, shape, freshness), not just the grant object, and normalizes policy validation failures into the single runtime boundary error.

Local: typecheck/build/build:connector PASS; focused pilot/connector suites 47/47 PASS; full local suite 258 tests, 256 PASS, only the two Windows-only `vault.test.ts` failures. Connector image built locally with a real identity; inventory reports UID 65532, `zca-js@2.2.0`, `crypto-js@4.2.0`, no private files. Hosted PASS at `a37935a`/41379964911: 258/258 units, 2/2 guarded SDK checks, 9 browser cases + 1 skip, four-staff browser flow and 4/10/25/50 load within target (p95 44.7/65.2/145.8/272.9 ms; 500 clients FAIL at 3991.5 ms).

## Working slice — third-pass review remediation (hosted PASS)

A follow-up pass over the same slice raised seven issues; all are fixed and hosted CI passed at `44b677f`/41381303200: **266/266** unit checks, **2/2** guarded SDK checks, **9 browser cases + 1 skip, 0 failed**, pilot dry-run/scan with image identity `e5fb987`, UID 65532, no ports/private files and 0 HIGH/CRITICAL.

- A provided worker scope is validated before any lock or query; empty/duplicate/malformed scopes throw instead of falling back to the account-wide claim.
- A scoped worker's interrupted-dispatch sweep covers only its exact peers, leaving out-of-scope `processing` rows for the next unscoped owner.
- A deferred destination returns `processed:false` so the caller backs off; the row stays pending and is never failed.
- The CLI emits only reviewed halt literals and maps any unknown runner string to `runtime-error`.
- Module loading and pool construction in `startPilotRuntime` are inside the single boundary error.
- QR bootstrap validates the private key/session/view files before acquiring ownership.
- Build identity remains build-derived, not content-hashed; deployment must pin the CI image digest. Dry-run intentionally verifies manifest shape only.

Focused pilot/connector/worker suites 50/50 PASS; full local suite 266 tests, 264 PASS, 2 FAIL (only the Windows-only `vault.test.ts` mode assertions). Load p95 60.9/74.9/228.7/418.0 ms at 4/10/25/50; 200 clients 1791.4 ms; 500 FAIL at 4210.8 ms with zero request errors.

## Follow-up after the third review (hosted PASS)

An independent re-audit of `44b677f` found no P1 or introduced regression, with three residuals and one incomplete fix; all are addressed in the follow-up slice:

- Session and QR view directories are validated (or created 0700) before bootstrap acquires ownership.
- A non-string runner halt is a safety failure instead of an implicit success.
- Publication re-checks the live transport and admission immediately before `COMMIT`; the remaining in-process/database race is documented and cannot dispatch because `provider.connected()` also requires a connected transport and admitted owner.
- Observe mode passes the grant peer scope, and inbound re-checks the guard after the ownership await before persistence.

Focused pilot/connector/worker suites 52/52 PASS; full local suite 268 tests, 266 PASS, 2 FAIL (only the Windows-only `vault.test.ts` mode assertions). Hosted [CI 41382664808](https://github.com/kha997/zalo-shared/actions/runs/41382664808) on `cc6614c` passed both jobs: **268/268** unit checks, **2/2** guarded SDK checks, **9 browser cases + 1 skip, 0 failed**, pilot dry-run/scan with image identity `fee2b21`, UID 65532, no ports/private files and 0 HIGH/CRITICAL. Load p95 42.5/54.4/150.9/273.9 ms at 4/10/25/50, 80.2 ms for 50×50, 657.9/993.4 ms at 100/200; 500 FAIL at 2370.5 ms with zero request errors. The 200-client result varies across runs, so no stable 200-seat or provider capacity is claimed.

## Whole-branch review remediation (hosted PASS)

An independent whole-branch review of `cc6614c` found no P1, two P2 liveness defects, one P2 evidence gap, one P2 CI-gate mismatch and several hardening gaps. All are fixed in `e0e635d`:

- A spent pilot reservation now fails its row terminally instead of returning it to `pending` forever; the reserve check recognizes the worker's own `processing` part as a repeat only, and the next message still dispatches.
- Restore quarantines only `processing` work and preserves never-attempted `pending` work; the CI journal seeds a pending fixture and the drill asserts both outcomes.
- The post-fence inbound guard has a live regression (guard flipped during the deferred ownership check; event rejected with zero database access).
- Both image scans fail on any high/critical finding and the connector scan requires UID 65532; the pilot dry-run runs with `--network none`.
- A wrong key under a recognized key id defers and preserves the locator; a correct-key retry completes the download.
- Private key/manifest reads require a non-writable non-symlink parent and verify the opened inode/owner/mode.
- Conversation search escapes `%`, `_` and `\`; gap acknowledgement admits provably pending work but still blocks `unknown`/`processing`.
- The threat model records that PostgreSQL RLS is not enabled for attachment/media reads; scan docs state the filename/path-only scope.

Local: typecheck, both builds and the connector build PASS; focused suites **77/77**; full local suite **273/273** PASS (the Windows-only `vault.test.ts` mode assertions are now POSIX-guarded; Linux CI still exercises them). Hosted [CI 41385140560](https://github.com/kha997/zalo-shared/actions/runs/41385140560) on `e0e635d` (PR merge `3684f27`) passed both jobs: **273/273** unit checks, **2/2** guarded SDK checks, **9 browser cases + 1 skip, 0 unexpected**, restore/restart/monitoring/image gates, and the pilot job. Image identity matched the PR merge commit; UID 65532, `zca-js` 2.2.0, `crypto-js` 4.2.0, no private files/ports, and 0 HIGH/CRITICAL (0 fixable) for both images. Load p95 65.0/79.6/212.3/441.8 ms at 4/10/25/50, 111.2 ms at 50×50, 701.5/1525.0 ms at 100/200; **500 FAIL** at 3669.4 ms with zero request errors. [Retained measurements](evidence/ci-pilot-whole-branch-results.json).

## Restore re-audit (hosted PASS)

A targeted re-audit of `e0e635d` found no P1 and one P2 evidence gap: the restore drill's "no `processing` row survives" assertions were vacuous because no fixture ever seeded a `processing` row. The slice at `a810087` fixes it and documents two bounds:

- `ops/ci-provider-journal.ts` seeds an interrupted `processing` outbox/message/part fixture; `ops/ci-backup-drill.sh` asserts all three before backup and asserts they become `unknown` after restore, while the never-attempted pending fixture survives as `pending`.
- A wrong-key media deferral preserves the locator only within the remaining 24-hour retention window; the runbook now requires the keyring fix inside it.
- The pilot guide describes the terminal `reservation-already-consumed` failure rather than an `already-reserved` halt.

Hosted [CI 41386800622](https://github.com/kha997/zalo-shared/actions/runs/41386800622) on `a810087` (PR merge `2bd5e7f`) passed both jobs with the drill reporting `Restore quarantine and runtime audit privilege assertions PASS`; the remaining `dispatchable|1` is the preserved pending fixture. 273/273 units, 2/2 guarded SDK checks, 9 browser cases + 1 skip. Load p95 62.9/82.9/222.5/435.6 ms at 4/10/25/50, 119.7 ms at 50×50, 928.7/1661.8 ms at 100/200; **500 FAIL** at 3135.5 ms, zero request errors. [Retained measurements](evidence/ci-pilot-restore-reaudit-results.json).

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
- The restore drill and early grant-freshness check were committed as `f84b777` and passed hosted CI 41378053199: 253/253 units, 2/2 guarded SDK checks, 9 browser cases + 1 skip, plus the pilot job; 200/500-client p95 2272.4/4044.7 ms still FAIL the 2 s target.
- Review: [private pilot runtime review](review/private-pilot-runtime-review.md) (H1, M1–M4, L2–L5/L7 fixed; L1/L6 accepted and documented) and [connector image review](review/private-pilot-connector-image-review.md).

## Historical snapshot

- Encrypted inbound media locator receipts and semantic-conflict evidence, scoped to the owning connector generation.
- A bounded, injected media download worker. It has no real-network test path and cannot send messages.
- A private, account-scoped media status/read API and staff UI that never returns locator URLs or ciphertext.

## Next steps for Qoder

1. Read this file, `docs/READINESS.md`, `docs/plans/private-pilot-activation.md`, and the inbound receipts/worker/private-UI reports. Confirm the exact remote commit and branch before editing.
2. ~~Run hosted CI for the completion patch; inspect full logs.~~ Done: 41370951223. ~~Run hosted CI for the pilot contract.~~ Done: 41372493757. ~~Run hosted CI for QR enrollment/CLI.~~ Done: 41374543813.
3. ~~Independently review inbound and pilot policy changes.~~ Done. ~~Review the pilot runtime/image slice.~~ Done; see the two pilot review documents. The hosted `pilot` job passed at 41379964911.
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
- Second-review hardening (halt precedence, real dispatch path, peer-scoped claims, image build identity, self-peer and TLS rules, boundary error): hosted PASS at `a37935a`/41379964911.
- Third-pass hardening (exact-scope validation, scoped interrupted sweep, deferral backoff, CLI halt allowlist, preflight containment, bootstrap ordering): hosted PASS at `44b677f`/41381303200.
- Whole-branch hardening (reservation liveness, restore pending preservation, post-fence regression, any-severity/UID scan gates, wrong-key media deferral, private-file parent/inode checks, literal search, gap-ack pending rule): hosted PASS at `e0e635d`/41385140560.
- Restore re-audit (non-vacuous interrupted-processing fixture with pre/post assertions; wrong-key retention bound and reservation-failure wording documented): hosted PASS at `a810087`/41386800622.
- Long-lived pilot runtime live drill, media scheduling in the pilot loop, dedicated admin retry, metadata/attachment retention policy and duplicate-egress bounds: open.
- Actual Zalo login, messaging/media, account health, phone coexistence, terms compliance and ban risk: UNPROVEN. Production readiness: NOT ESTABLISHED.
