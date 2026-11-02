# Pilot gate status

**Date:** 2026-11-02
**Branch:** `feat/shared-inbox`; connector artifact source `2b41b340f57dbceea6b5c445b11a4d3a0f5ba62e`
**PR #3:** OPEN, **Draft** (not merged, not deployed)
**Owner decision:** `G5_SCOPE_APPROVED_ACTIVATION_PENDING` — D1–D7 approved in scope; live activation withheld
**Live pilot:** **NOT ACTIVATED** — no Zalo login, QR scan, session, real account or external send performed

## Gates

| Gate | Status | Evidence |
| --- | --- | --- |
| `G1_ENVIRONMENT_ACCEPTED` | PASS | [G1-ENVIRONMENT-RECONNAISSANCE.md](evidence/G1-ENVIRONMENT-RECONNAISSANCE.md) |
| `G2_INFRASTRUCTURE_READY` | PASS | [G2-PRIVATE-INFRASTRUCTURE.md](evidence/G2-PRIVATE-INFRASTRUCTURE.md) |
| `G3_OFFLINE_VERIFIED` | **PASS (scoped)** | [G3-OFFLINE-ACCEPTANCE.md](evidence/G3-OFFLINE-ACCEPTANCE.md); UNPROVEN: capacity above 100 clients (200/500 FAIL), isolated-server browser case, key escrow, live provider |
| `G4_PILOT_ACTIVATION_PACKAGE` | **SUPERSEDED IN SCOPE** | [G4-PILOT-ACTIVATION-PACKAGE.md](evidence/G4-PILOT-ACTIVATION-PACKAGE.md); D1–D7 accepted in scope by the G5 decision |
| `G5_SCOPE_APPROVED_ACTIVATION_PENDING` | **APPROVED IN SCOPE** | [G5-SCOPE-APPROVAL.md](evidence/G5-SCOPE-APPROVAL.md) |
| `G5A_AWAITING_OWNER_START` | **READY, NOT STARTED** | [G5A-ACTIVATION-READINESS.md](evidence/G5A-ACTIVATION-READINESS.md) |
| `G5B_OBSERVE_VERIFIED` | NOT AUTHORIZED | Requires G5-A PASS and separate Owner authorization |
| `G5C_SEND_VERIFIED` | NOT AUTHORIZED | Requires G5-B PASS and separate Owner authorization |
| `G5_LIVE_PILOT_VERIFIED` | NOT AUTHORIZED | Requires all stages and a final Owner review |
| `G6_SOAK` | NOT AUTHORIZED | Out of scope |

## Verified identity and offline status

- Connector image `zalo-shared-connector:g5-2b41b34`, local digest `sha256:e3fa923f1396c10ddcae039b889a6109f6cafcce6b25c2054ed8e43c0835c7b0`, local archive SHA-256 `ce7dbd64bb3d1fde02e4126afbac519df209cfd661f09e037dae2f1761116246`.
- Embedded build identity matches `2b41b34`, `connector/package-lock.json` and the locked SDK integrity; UID 65532; no exposed ports; no `manifest.json`, `session.key`, `session.enc` or `qr.png` in the image.
- Trivy 0.76.1 reported **0 HIGH/CRITICAL** at scan time.
- Full local suite **283/283 PASS**; typecheck and connector build PASS.
- In-image `preflight` under `--network none` admitted the synthetic bootstrap, observe and send-test manifests and denied an out-of-scope manifest.
- A local image digest is not a registry digest or signed attestation; CI does not push an image. This remains a deployment limitation.

## Enforced G5 limits

Exactly one connector account, exactly one allowlisted direct peer, 1–10 outbound parts/account/day, ≥2000 ms interval, 2-hour session cap, text-only, no automatic reconnect, no automatic reauthentication, no resend after unknown, no concurrent connector ownership, and separate Owner authorization per stage.

## Next action

The Owner issues a separate **G5-A start authorization** naming the UTC start and automatic expiry, then follows [G5-LIVE-PILOT-PROCEDURE.md](operations/G5-LIVE-PILOT-PROCEDURE.md). This status does not authorize G5-B or G5-C.

**STOP — `G5A_AWAITING_OWNER_START`. Do not start the live pilot from this status.**
