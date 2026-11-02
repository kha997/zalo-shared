# G5-A activation readiness report

**Date:** 2026-11-02
**Status:** `G5A_AWAITING_OWNER_START`
**Decision:** `G5_SCOPE_APPROVED_ACTIVATION_PENDING` ([record](G5-SCOPE-APPROVAL.md))
**Live action:** none. No QR enrollment, Zalo authentication, session write, observation or external send has occurred.

This report covers the Owner's required pre-G5-A items. It contains aliases and synthetic values only. Live evidence is identified separately from offline/CI evidence.

## 1. Host and repository

- Private host: Owner-controlled WSL2 Ubuntu 24.04 environment; Docker Engine with local-only images.
- Repository: `/home/zen/Projects/zalo-shared`, branch `feat/shared-inbox`.
- Connector artifact source commit: `2b41b340f57dbceea6b5c445b11a4d3a0f5ba62e`.
- PR #3 remains OPEN and **Draft**; nothing is deployed.

## 2. Reviewed connector artifact

| Item | Value |
| --- | --- |
| Image tag | `zalo-shared-connector:g5-2b41b34` |
| Local image digest (`RepoDigest`) | `sha256:e3fa923f1396c10ddcae039b889a6109f6cafcce6b25c2054ed8e43c0835c7b0` |
| Local archive SHA-256 | `ce7dbd64bb3d1fde02e4126afbac519df209cfd661f09e037dae2f1761116246` |
| Embedded source commit | `2b41b340f57dbceea6b5c445b11a4d3a0f5ba62e` |
| Embedded connector lock SHA-256 | `17dcd25426639f7112b80764bc8aa27f9be2af3acf0aaf0f2cd490c434030c9b` |
| Embedded SDK integrity | `sha512-pBU0T0/uadH3Neq7yMssUmE769VVuqKhL8YD1HqQQG8e6lkwueAopNu0vhJdqiJRHZdPIEomT2FxRzauOx4pgA==` |
| Runtime | UID 65532, no exposed ports, `zca-js@2.2.0`, `crypto-js@4.2.0`, no private files |

The image was built locally from the reviewed source with `SOURCE_COMMIT` set to that commit. The local digest is **not** a pushed registry digest and there is no signed attestation; CI builds the same source but does not publish an image. Deployment must use the exact local artifact above or a separately re-verified rebuild of the same commit. This limitation is recorded as residual risk.

## 3. Offline test and security status

| Check | Result |
| --- | --- |
| Full local suite (Node 24.19, disposable PostgreSQL) | **283/283 PASS**, 0 fail, 0 skip |
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
- Observe/send-test: each requires a new Owner authorization; the connector stops automatically at the 2-hour wall-clock cap (`session-limit`), at grant expiry, or earlier on a fault/abort.
- The 2-hour cap starts when the pilot runtime loop begins, before connector login/startup; the Owner activation time is recorded and must fall within the same 2-hour window. G5-A bootstrap is a short enrollment interaction, not a 2-hour observation session.

## 7. QR interaction and Owner presence

- The connector writes a bounded PNG only to the private `state/view/` directory (0700) as `qr.png` 0600; it never prints the QR, exposes an HTTP endpoint, starts a viewer or retries after expiry.
- The Owner must be physically present with the official phone. The Owner opens the PNG locally, scans it, and confirms the final account UID/display name at the TTY prompt. The QR is cleared after use.
- No screenshots, screen sharing, chat upload or cloud sync of the QR is permitted.

## 8. Emergency stop and session revocation

1. Send one `SIGTERM` to the connector and confirm exit; do not restart or start a second connector.
2. Verify ownership is released/quarantined and the process is gone. Treat an in-flight provider call with unverified termination as unknown.
3. Revoke the pilot session from the official phone. This build has no automatic reauthentication or QR retry.
4. Stop the application worker if it could claim pilot work; preserve the database and sanitized logs only.
5. If ending the pilot, follow [PILOT-TEARDOWN.md](../operations/PILOT-TEARDOWN.md) for D7 deletion, inventory, backup disclosure and verification.

## Enforced controls

| G5 limit | Enforcement |
| --- | --- |
| One account / one peer | `assertG5Scope` in bootstrap, runtime and preflight; runtime peer-scoped claims |
| 1–10 parts/day / ≥2 s | G5 preflight/runtime plus durable budget reservation and interval |
| 2-hour session | `sessionLimitMs` in `runPilotLoop`, `session-limit` halt |
| Text only | `textOnly` dispatch policy rejects attachments before reservation/egress |
| No auto-reconnect | `maxReconnectAttempts: 0`, durable `connection-lost` fault, controller abort |
| No auto-reauth/resend | Stored session only; unknown results stop; no retry path |
| Stage order | Separate purpose gates and Owner authorization per stage |

## Test IDs

- `tests/backend/g5-policy.test.ts` — bounds, stage mapping, bootstrap exception, no identifier leakage.
- `tests/backend/pilot-cli.test.ts` — preflight admission and denial; live command acknowledgement/purpose/runner gates.
- `tests/backend/private-pilot-flow.test.ts` — two-hour `session-limit`, invalid cap rejection, text-only refusal before reservation/egress.
- `tests/transport/transport.test.ts` — zero reconnect stops the listener with one durable fault; reconnect bounds.
- In-image evidence: `g5-preflight-bootstrap.json`, `g5-preflight-observe.json`, `g5-preflight-send-test.json`, `g5-preflight-denied.json`.

## Independent review

A read-only independent review of this slice is recorded in the final Owner report. It found no P1 bypass in the G5 scope enforcement; any P2/P3 findings and dispositions are listed there. The earlier G4 independent reviews cover the pre-existing pilot runtime, connector image and gate logic, not live provider behaviour.

## Residual risks and UNPROVEN items

- Provider authentication, QR interoperability, phone coexistence, session renewal, delivery and account health: **UNPROVEN** until G5-A/B/C live evidence exists.
- Local image digest is not a registry digest or signed attestation; no image-push pipeline exists.
- Host-level restricted egress is an Owner operating condition; Docker network isolation is implemented, but the host firewall is not proven here.
- Platform terms and account-restriction/ban risk cannot be removed by tests; D5 acceptance remains with the Owner.
- The skipped isolated-server browser case and monitoring deployment remain open G4 residuals.
- The 2-hour cap is enforced by the runtime loop between ticks, not by an OS-level kill timer. A hung startup performs no provider activity; the Owner can terminate the container immediately. The grant expiry and connector/send timeouts provide additional bounds.
- Capacity is not claimed; the pilot is one account, one peer and 10 parts/day.

## Stop point

**STOP — `G5A_AWAITING_OWNER_START`.** No live login, QR scan, session write, observation or send may occur until the Owner explicitly authorizes G5-A with a UTC start and expiry. Technical readiness does not authorize activation.
