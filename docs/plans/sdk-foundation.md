# Pinned SDK foundation implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement this plan task by task. Owner delegated architecture, implementation and review decisions; do not stop for design approval or use a real account.

**Goal:** Select a reproducible SDK artifact and provide an offline-tested, explicitly gated session facade without enabling the application connector.

**Architecture:** Pin npm `zca-js@2.2.0` as a development dependency while validating its actual published artifact, rather than assuming the research snapshot is identical. Add a narrow facade that reads an encrypted session store only after explicit login authorization, constructs fresh SDK instances with safe flags, sanitizes failures and persists refreshed cookies before returning an API. Keep server/worker/provider configuration unchanged.

**Tech stack:** Node24, TypeScript, node:test, zca-js2.2.0; existing CredentialVault and transport.

**Spec:** `docs/DESIGN.md`, `docs/operations/LIVE-PILOT.md`, `docs/review/sdk-contract-review.md`, Owner SDK directive.

## Global constraints

- No real account, credentials, login, QR generation, Zalo network calls, public endpoints or production deployment.
- Existing isolated worktree `/workspace/zalo-shared-dev`, branch `feat/shared-inbox`; main remains unchanged.
- SDK stays development-only; production image and application imports must exclude it.
- Package version is exact2.2.0. Registry gitHead `dadfef18bcac53537741855c99f084152da1fad9` differs from research `0586dc5e4981985c5f16b9b3a5f285a02feb6f9b`; do not equate them.
- Tarball SHA512 must match registry and lockfile integrity. Install with `--ignore-scripts`. Retain license notice and review transitive scripts/advisories.
- Network denial must guard actual-SDK import/model tests; fake login is explicitly labeled injected evidence.

## Review focus

1. Import or constructor unexpectedly attempts network/filesystem writes/process execution: sandboxed subprocess test must fail, not quietly stub success.
2. Denied or malformed session must not invoke loader/login or leak credentials in errors.
3. Login result arriving after timeout/stop must not start or retain a usable listener.
4. Refreshed cookies, mutation of SDK credential input, and vault write failure must preserve isolation and fail closed.
5. Actual SDK model self-origin/direct/group semantics and string IDs must pass source-backed constructor fixtures; these do not prove live delivery.

## Task1: Artifact pin and actual-SDK contracts

Files: package.json/package-lock.json; tests/transport/sdk-artifact.test.ts; tests/fixtures/sdk-offline-probe.mjs; .github/workflows/ci.yml; docs/evidence/sdk-artifact.json; docs/review/sdk-artifact-audit.md; THIRD_PARTY_NOTICES.md.

- [ ] Audit the verified extracted npm artifact before dependency installation. Record published integrity, hash, gitHead, license, scripts and key contract differences.
- [ ] Install exact SDK development dependency using `npm install --save-dev --save-exact zca-js@2.2.0 --ignore-scripts`; audit advisories/signatures and transitive licenses/scripts. Do not execute dependency lifecycle scripts.
- [ ] Add tests of pinned package/version/integrity and actual exported direct/group message constructors, quoted owner normalization and self-origin sentinel. A child probe must deny network/process/filesystem writes and prove guards actually reject attempts.
- [ ] Run the tests against an intentionally wrong expected contract first; restore the source-backed contract, run green, and retain red/green evidence. No login API may execute.
- [ ] CI installs with scripts disabled, runs the new contracts and preserves SDK advisory/signature evidence. Confirm the existing production prune/image remains SDK-free.

## Task2: Gated encrypted-session SDK facade

Files: adapters/zalo/sdk-facade.ts; tests/transport/sdk-facade.test.ts; docs/review/sdk-facade-report.md.

Interfaces: `createSdkFacade(options)` returns `{ createApi(safeOptions), persistSession(), close() }`; it is compatible with transport's `approvedSdk.createApi`. Options include injected `sessionStore.read/write`, an optional fake loader, `allowNetworkLogin` default false, and bounded login timeout. Only explicit true permits loading/login. Default loader lazily imports the development-only SDK. Do not wire this into server/worker.

- [ ] Write failing tests for denied login (zero store/loader calls), bounded validated cloned credentials, forced logging:false/selfListen:true/checkUpdate:false, fresh instances, sanitized synchronous/asynchronous errors, refreshed-cookie persistence, failed persistence shutdown, concurrent create rejection, timeout with safe late-result disposal, close during pending login, and explicit cookie refresh persistence.
- [ ] Implement narrow credential/SDK API validation and facade from those tests. Never return SDK getContext/getCookie/raw errors/credentials through the transport API. Preserve encrypted-store ownership; do not print credential fields.
- [ ] Exercise the facade with real CredentialVault plus fake SDK in an isolated temp directory. Test that raw SDK mutation cannot mutate stored inputs and that output does not contain synthetic secret sentinels.
- [ ] Run focused tests/typecheck/build, independent scoped review and full hosted CI. Update Issue4 and readiness with demonstrated PASS/FAIL/UNPROVEN results; no live-readiness claim.

## Progress ledger

- Baseline: local370c55d / remote259644df, source2dda735c validated39/39 backend/transport +6 browser cases. Existing offline transport/vault13/13 reproduced before changes.
- Ruling: development-only SDK until later connector promotion — keeps the live dependency out of deployed runtime while validating the actual artifact — promotion will require a fresh image/license/security review.
- Ruling: work continues in the existing isolated worktree — no additional worktree or main changes needed.
- Task1: code/artifact inventory and local guards complete; independent scoped review clean; hosted advisory/signature/image gates passed in40751604115 onf8167052.
- Task2: implementation complete; two independently reproduced P1s fixed and re-reviewed;13/13 focused tests,34/34 combined offline cases,2/2 actual-SDK guards and fresh-install build passed; broad review clean; hosted53/53 units+2/2 actualSDK guards+6browser cases, advisory/signatures/recovery/image passed in40751604115. App/worker connector wiring and live tests remain outside this plan.

- Completion: both SDK foundation tasks accepted offline and by hosted CI. See docs/evidence/ci-sdk-foundation-results.json; no live/provider/production approval.
