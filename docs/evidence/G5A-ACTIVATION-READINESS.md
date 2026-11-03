# G5-A activation readiness report

**Date:** 2026-11-02
**Status:** `G5A_BLOCKED` (readiness record superseded by the authorized attempt)
**Decision:** `G5_SCOPE_APPROVED_ACTIVATION_PENDING` ([record](G5-SCOPE-APPROVAL.md))
**Live action:** none. No QR enrollment, Zalo authentication, session write, observation or external send has occurred.

**Post-authorization outcome (2026-11-03):** the Owner authorized G5-A for `02:00Z`–`02:30Z`. Mandatory preflight returned `G5A_BLOCKED` before the window opened; no QR, SDK authentication or session write occurred. See [G5A-BOOTSTRAP-REPORT.md](G5A-BOOTSTRAP-REPORT.md).

This report covers the Owner's required pre-G5-A items. It contains aliases and synthetic values only. Live evidence is identified separately from offline/CI evidence.

## 1. Host and repository

- Private host: Owner-controlled WSL2 Ubuntu 24.04 environment; Docker Engine with local-only images.
- Repository: `/home/zen/Projects/zalo-shared`, branch `feat/shared-inbox`.
- Connector artifact source commit: `6d199162e8b00d7b4968b6b1fd82450b4387f4df`.
- PR #3 remains OPEN and **Draft**; nothing is deployed.

## 2. Reviewed connector artifact

| Item | Value |
| --- | --- |
| Image tag | `zalo-shared-connector:g5-6d199162` |
| Local image digest (`RepoDigest`) | `sha256:6b1f0100017d067f24d18eee53ffbfcffe7562ac3f79fd98283097ef1938d781` |
| Local archive SHA-256 | `149890e070a387e501c00d5f8dff5ccb3db15b19fced38e8ed859e992436420c` |
| Local archive size | 57,530,880 bytes |
| Embedded source commit | `6d199162e8b00d7b4968b6b1fd82450b4387f4df` |
| Embedded connector lock SHA-256 | `17dcd25426639f7112b80764bc8aa27f9be2af3acf0aaf0f2cd490c434030c9b` |
| Embedded SDK integrity | `sha512-pBU0T0/uadH3Neq7yMssUmE769VVuqKhL8YD1HqQQG8e6lkwueAopNu0vhJdqiJRHZdPIEomT2FxRzauOx4pgA==` |
| Runtime | UID 65532, no exposed ports, `zca-js@2.2.0`, `crypto-js@4.2.0`, no private files |

The image was built locally from the reviewed source with `SOURCE_COMMIT` set to that commit. The local digest is **not** a pushed registry digest and there is no signed attestation; CI builds the same source but does not publish an image. Deployment must use the exact local artifact above or a separately re-verified rebuild of the same commit. This limitation is recorded as residual risk.

## 3. Offline test and security status

| Check | Result |
| --- | --- |
| Full local suite (Node 24.19, disposable PostgreSQL) | **286/286 PASS**, 0 fail, 0 skip |
| TypeScript typecheck | PASS |
| Connector compile (`build:connector`) | PASS |
| G5 policy/preflight/session/text-only/reconnect tests | PASS (focused suites) |
| Trivy 0.76.1 connector scan | **0 HIGH/CRITICAL**, 0 fixable |
| Image ports/UID/private-file/identity assertions | PASS |
| In-image G5 preflight, `--network none` | bootstrap/observe/send-test **admitted**; out-of-scope **denied** |

Evidence: [g5-offline-preflight-summary.json](g5-offline-preflight-summary.json), [connector-image-inventory.json](connector-image-inventory.json), [connector-image-scan-summary.json](connector-image-scan-summary.json), and the four `g5-preflight-*.json` files. These are **synthetic/offline** evidence, not live provider evidence.

`preflight` validates the manifest's scope and shape only; it does not read `/app/build-identity.json`. Live `bootstrap` and the observe/send-test runtime separately verify that the embedded build identity matches the manifest before touching a key, session, database or SDK.

Hosted CI status for this evidence head is recorded in the final Owner report and PR #3 checks. Hosted CI is corroboration only; it does not authenticate Zalo, use a real account or prove delivery.

## 4. Private account and peer configuration

- The repository contains only `<ACCOUNT_A_ALIAS>`, `<PEER_B_ALIAS>` and placeholder UIDs. No real account UID, peer UID, phone number, cookie, token, QR image or session is present in the repository or evidence.
- Private pilot material is designed to live outside the repository at `$HOME/pilot-private/zalo-shared` with 0700 directories and 0600 files owned by UID 65532. The private consent record, session key and encrypted session are not populated for activation yet.
- The enrollment manifest must use a null account and zero peers; observe/send-test manifests must bind the exact account and exactly one peer. `preflight` rejects any other shape before a live command.
- The real values are populated only after the Owner issues the G5-A start authorization and are never sent through chat or committed.

## 5. Recipients and media

- Exactly one allowlisted direct peer; groups and unlisted peers are refused before reservation.
- No additional recipients, group conversations or contact discovery.
- Text only: an outbound attachment is refused before budget reservation or provider egress; media scheduling is `false`; inbound media is recorded only as unsupported metadata with no download.
- No media, CDN, file, image, voice/video, bulk or marketing path is authorized.

## 6. Proposed live start and automatic expiry

- The Owner names the exact UTC start in the G5-A start authorization. No start time is assumed by this report.
- Enrollment grant: ≤1 hour, purpose `enroll-session`, null account, zero peers.
- Observe/send-test: each requires a new Owner authorization and a fresh grant whose `expiresAt` is the Owner's automatic expiry (≤2 hours after the named start). The connector stops at grant expiry, at the 2-hour runtime wall-clock cap (`session-limit`), or earlier on a fault/abort.
- The runtime cap starts when the pilot loop begins, before connector login/startup. A process restart resets that loop timer, so the absolute bound is the grant expiry: the grant is issued for the activation window and a restarted process cannot send after it. G5-A bootstrap is a short enrollment interaction, not a 2-hour observation session.
- The durable part budget is 10 per UTC day **and** 10 per grant. The per-grant cap prevents a session that crosses UTC midnight from obtaining a second daily allowance.

## 7. QR interaction and Owner presence

- The connector writes a bounded PNG only to the private `state/view/` directory (0700) as `qr.png` 0600; it never prints the QR, exposes an HTTP endpoint, starts a viewer or retries after expiry.
- The Owner must be physically present with the official phone. The Owner opens the PNG locally, scans it, and confirms the final account UID/display name at the TTY prompt. The QR is cleared after use.
- No screenshots, screen sharing, chat upload or cloud sync of the QR is permitted.

## 8. Emergency stop and session revocation

1. Send one `SIGTERM` to the connector and confirm exit; do not restart or start a second connector.
2. Verify ownership is released/quarantined and the process is gone. Treat an in-flight provider call with unverified termination as unknown.
3. Revoke the pilot session from the official phone. This build performs one stored-credential login per process and has no QR/password re-enrollment, retry loop or automatic replacement login.
4. Stop the application worker if it could claim pilot work; preserve the database and sanitized logs only.
5. If ending the pilot, follow [PILOT-TEARDOWN.md](../operations/PILOT-TEARDOWN.md) for D7 deletion, inventory, backup disclosure and verification.

## Enforced controls

| G5 limit | Enforcement |
| --- | --- |
| One account / one peer | `assertG5Scope` in bootstrap, runtime and preflight; runtime peer-scoped claims |
| 1–10 parts/day / ≥2 s | G5 preflight/runtime plus durable budget reservation and interval |
| ≤10 parts per grant | Durable `pilot_part_ledger` count by `grant_id` before each reservation |
| 2-hour session | `sessionLimitMs` in `runPilotLoop`, `session-limit` halt; grant `expiresAt` is the absolute bound across restarts |
| Text only | `textOnly` dispatch policy rejects attachments before reservation/egress; omission defaults to text-only |
| No auto-reconnect | `maxReconnectAttempts: 0`; the session aborts and the CLI exits non-zero with `connection-lost` |
| Durable fault | Fault write is awaited (up to 3 s) before ownership is released; a dead pool can still prevent persistence |
| No auto-reauth/resend | One stored-credential login per process; no QR/password re-enrollment, no retry loop, no resend after unknown. SDK-internal session refresh is not established offline |
| Stage order | Separate purpose gates and Owner authorization per stage |

## Test IDs

- `tests/backend/g5-policy.test.ts` — bounds, stage mapping, bootstrap exception, no identifier leakage.
- `tests/backend/pilot-cli.test.ts` — preflight admission/denial; `connection-lost` exits non-zero; live command acknowledgement/purpose/runner gates.
- `tests/backend/private-pilot-flow.test.ts` — real `G5_SESSION_LIMIT_MS` `session-limit`, invalid cap rejection, text-only refusal before reservation/egress, omitted-`textOnly` fail-closed, per-grant budget across a UTC day rollover, and a `startPilotRuntime` refusal for a policy-valid 8-hour grant.
- `tests/transport/transport.test.ts` — zero reconnect stops the listener with one durable fault; reconnect bounds.
- `tests/transport/connector-runtime.test.ts` — teardown waits for a pre-stop fault write before releasing ownership.
- In-image evidence: `g5-preflight-bootstrap.json`, `g5-preflight-observe.json`, `g5-preflight-send-test.json`, `g5-preflight-denied.json`.

## Independent review

Two read-only reviews covered commits `8886f94` and the corrected slice `6d19916`; neither found a P1 bypass of the live send path. Their material findings and dispositions:

| Finding | Disposition |
| --- | --- |
| `textOnly` defaulted to `false` when omitted (P2) | Fixed in `6d19916`: omission now defaults to text-only; regression test added |
| 10-part budget was per UTC day only; a midnight-crossing session could emit 20 (P2) | Fixed: durable per-grant cap in addition to the daily cap; rollover test added |
| A zero-reconnect transport fault exited 0 as `aborted` (P2) | Fixed: the runtime reports `connection-lost`, which exits non-zero; CLI test added |
| A fault arriving during teardown could miss the durable write (P2) | Fixed: teardown awaits pending fault writes for up to 3 s before releasing ownership; runtime test added |
| Teardown SQL used the Zalo UID for a UUID column, omitted `pilot_part_ledger`, and ignored `provider_events` FK order (P2, documentation) | Corrected in `PILOT-TEARDOWN.md`; SQL not executed against a populated pilot DB (UNPROVEN) |
| The 2-hour test used a 1-hour configured cap; restart resets the loop timer (P3) | Test now uses the real `G5_SESSION_LIMIT_MS`; documents that grant expiry is the absolute bound |
| "No automated reauthentication" overstated the one stored-credential `login()` per process (P2) | Wording narrowed; SDK-internal refresh remains unverified |
| 8-hour observe grant was accepted by the live runner test (P2) | `startPilotRuntime` G5 refusal now has an explicit regression test |
| Host preflight ignored the requested stage (P3) | Host wrapper now rejects a manifest whose purpose does not match the stage; build identity is still checked only by the live command |
| The G5 artifact was still at `2b41b34`, whose CI invocation could not run the distroless CLI (P2) | New artifact `6d19916` rebuilt and re-scanned; CI run `41431903557` exercises the corrected command |

Hosted CI `41430051691` on `8886f94` and `41431903557` on the artifact commit `6d19916` both passed the `test` and `pilot` jobs, including the G5 preflight admission/denial step. The earlier G4 reviews cover the pre-existing pilot runtime, connector image and gate logic, not live provider behaviour.

## Residual risks and UNPROVEN items

- Provider authentication, QR interoperability, phone coexistence, session renewal, delivery and account health: **UNPROVEN** until G5-A/B/C live evidence exists.
- Local image digest is not a registry digest or signed attestation; no image-push pipeline exists.
- Host-level restricted egress is an Owner operating condition; Docker network isolation is implemented, but the host firewall is not proven here.
- Platform terms and account-restriction/ban risk cannot be removed by tests; D5 acceptance remains with the Owner.
- The skipped isolated-server browser case and monitoring deployment remain open G4 residuals.
- The 2-hour runtime cap is enforced between ticks, not by an OS-level kill timer. A restart resets the loop timer, so the grant `expiresAt` (set at activation) is the absolute bound. A hung startup performs no provider activity; the Owner can terminate the container immediately. Grant expiry and connector/send timeouts provide additional bounds.
- Fault persistence is best-effort under a dead database: teardown waits up to 3 seconds, then releases ownership. The session still stops and the local dispatch fence stays closed.
- Teardown SQL is corrected but was not executed against a populated pilot database; treat deletion verification as UNPROVEN until it runs after the pilot.
- The `connection-lost` halt, per-grant cap and omission-default paths are unit/integration tested; they have not been exercised against the real provider.
- Capacity is not claimed; the pilot is one account, one peer and 10 parts/UTC-day (and per grant).

## Stop point

**STOP — `G5A_AWAITING_OWNER_START`.** No live login, QR scan, session write, observation or send may occur until the Owner explicitly authorizes G5-A with a UTC start and expiry. Technical readiness does not authorize activation.
