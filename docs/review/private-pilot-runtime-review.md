# Private pilot runtime and dispatch review

Reviewed 2026-11-02 against `ad036f6` plus the uncommitted pilot runtime slice. Scope: `tools/pilot-runtime.ts`, `tools/pilot-connector.ts` outcome propagation, `adapters/zalo/provider.ts` dispatch halts, `adapters/zalo/connector-runtime.ts` inbound gate, `server/private-pilot-files.ts` key identifier, and the separate connector image/CI job.

This review is synthetic and offline. It does not establish real provider behavior, phone coexistence, account health or production readiness.

## Findings and dispositions

| ID | Finding | Disposition |
| --- | --- | --- |
| H1 | A provider policy halt stopped the loop but the CLI still exited 0 with `gate:"completed"`. An operator or supervisor could treat an ambiguous/duplicate send as success. | **Fixed.** `liveCommand` returns the loop outcome; `runPilotCli` maps `runtime-error`, `already-reserved`, `reservation-denied` and `dispatch-uncertain` to exit 1. Covered by four halt cases plus a benign `grant-expired` case in `tests/backend/pilot-cli.test.ts`. |
| M1 | A pre-aborted signal could start the connector or attach an abort listener that was never removed. | **Fixed.** `runPilotLoop` stops the connector and returns `{halt:"aborted",ticks:0}` before `start()`; `startPilotRuntime` forwards a pre-aborted signal to its own controller and always removes the listener in `finally`. |
| M2 | The send-test tick interval ignored the grant's minimum interval, so the loop could attempt dispatch faster than the grant allows. | **Fixed.** Send-test uses `Math.max(2000, grant.minIntervalMs)`; observe uses 1000 ms. The durable reservation still enforces the exact interval server-side. |
| M3 | Database tests called `database.pool.end()` directly, leaving the schema-owner pool and disposable schema behind. | **Fixed.** All eight `private-pilot-flow` cases now call `database.close()`, which ends both pools and drops the schema. |
| M4 | `startPilotRuntime` was untested and accepted an unknown command by falling back to observe. | **Fixed.** Unknown or malformed commands, non-Linux hosts, non-postgres URLs, relative key/session paths, purpose mismatches and out-of-shape grants now reject before any pool or file work. Added an entry-validation test (Linux branch exercised by hosted CI; non-Linux branch locally). The real host path still requires a live-environment drill. |
| L1 | Ownership could be lost between the final fence check and the SDK call. | **Accepted, documented.** Revocation cannot cancel a call already entered. The provider re-checks ownership after reservation and after egress; a late confirmation is classified `dispatch-uncertain` and never resent. The remaining window is inherent and recorded in code. |
| L2 | The loop's catch block could overwrite a specific policy halt with `runtime-error`. | **Fixed.** The catch reads `haltReason()` after the exception and reports the policy halt when present. |
| L3 | An unknown command would silently run observe mode. | **Fixed.** `startPilotRuntime` accepts only `run-observe` or `run-send-test`; `runPilotCli` already restricts parsed commands. |
| L4 | `runPilotLoop` validated only the purpose, not grant lifetime, budget, interval or peer bounds. | **Fixed.** `grantShape` enforces version, safe identifiers, non-null account, 1–4 unique peers, 1–30 parts/day, 2–60 s interval, ordered timestamps, lifetime ≤ 8 h and both attestations. Six invalid-shape cases added. |
| L5 | The pilot inbound gate admitted any event in an allowlisted direct thread, regardless of sender. | **Fixed.** Non-self events must have `senderId === threadId`; self events must have `senderId === boundAccountId`. The bound account is passed from the grant. Group and unexpected-peer events are still dropped before persistence with only a count. |
| L6 | The caller-supplied database client's transaction contract was implicit. | **Accepted, documented.** The reservation commits before egress and the provider explicitly documents that a caller-supplied client must be in autocommit; the worker supplies a pooled client, not an open transaction. |
| L7 | `bindPilotSession` accepted extra session keys and empty identity values. | **Fixed.** The session object must have exactly `cookie`, `imei`, `userAgent`; `imei` is 1–512 characters, `userAgent` 1–1024 and `cookie` an array. Extra-key and empty-value cases added. |

## Additional hardening in the same slice

- Session envelopes now carry an explicit `keyId` bound into both the envelope and AES-GCM AAD. A record written under `v1` cannot be silently read as `v2`; rotation is explicit and verified by a new write. Cross-id and tampered-envelope regressions pass.
- The observe provider is now constructed explicitly and cannot dispatch even if a worker path is misused.
- The CI dry-run mount is chowned to UID 65532 and mode 0600 because the connector enforces owner-only files; this is what a Linux bind mount needs.
- The connector scan inventory runs with `--network none`, read-only root and all capabilities dropped.

## Residual risks and unproven claims

- Hosted CI for this slice is pending. Local full suite: **251 tests, 249 PASS, 2 FAIL**, both the known Windows-only `vault.test.ts` POSIX mode assertions that pass on Linux.
- No real SDK login, QR scan, session interoperability, provider delivery, phone coexistence or account-health behavior has been exercised.
- `crypto-js@4.2.0` remains a deprecated transitive dependency of `zca-js@2.2.0`; the connector image is intentionally SDK-bearing and is not the application image.
- Media scheduling is not enabled in the pilot loop (`media:false`); real media/download behavior is UNPROVEN.
- The pilot peer allowlist is capped at 1–4 by policy. This is a pilot safety scope, not a product seat limit: the application itself has no seat cap and has passed four-staff acceptance.
