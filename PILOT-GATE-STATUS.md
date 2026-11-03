# Pilot gate status

**Date:** 2026-11-03
**Branch:** `feat/shared-inbox`; connector artifact source `6d199162e8b00d7b4968b6b1fd82450b4387f4df`
**PR #3:** OPEN, **Draft** (not merged, not deployed)
**Owner decision:** `G5_SCOPE_APPROVED_ACTIVATION_PENDING` — D1–D7 approved in scope; live activation withheld
**G5-A authorization:** 2026-11-03, `02:00Z`–`02:30Z`; preflight blocked before the window
**Live pilot:** **NOT ACTIVATED** — no Zalo login, QR scan, session, real account or external send performed

## Gates

| Gate | Status | Evidence |
| --- | --- | --- |
| `G1_ENVIRONMENT_ACCEPTED` | PASS | [G1-ENVIRONMENT-RECONNAISSANCE.md](evidence/G1-ENVIRONMENT-RECONNAISSANCE.md) |
| `G2_INFRASTRUCTURE_READY` | PASS | [G2-PRIVATE-INFRASTRUCTURE.md](evidence/G2-PRIVATE-INFRASTRUCTURE.md) |
| `G3_OFFLINE_VERIFIED` | **PASS (scoped)** | [G3-OFFLINE-ACCEPTANCE.md](evidence/G3-OFFLINE-ACCEPTANCE.md); UNPROVEN: capacity above 100 clients (200/500 FAIL), isolated-server browser case, key escrow, live provider |
| `G4_PILOT_ACTIVATION_PACKAGE` | **SUPERSEDED IN SCOPE** | [G4-PILOT-ACTIVATION-PACKAGE.md](evidence/G4-PILOT-ACTIVATION-PACKAGE.md); D1–D7 accepted in scope by the G5 decision |
| `G5_SCOPE_APPROVED_ACTIVATION_PENDING` | **APPROVED IN SCOPE** | [G5-SCOPE-APPROVAL.md](evidence/G5-SCOPE-APPROVAL.md) |
| `G5A_AWAITING_OWNER_START` | **SUPERSEDED** | Owner authorization issued for 2026-11-03 `02:00Z`–`02:30Z` |
| `G5A_BOOTSTRAP_VERIFIED` | **BLOCKED** | [G5A-BOOTSTRAP-REPORT.md](evidence/G5A-BOOTSTRAP-REPORT.md); no live action, egress isolation and credential containment failed preflight |
| `G5B_OBSERVE_VERIFIED` | NOT AUTHORIZED | Requires G5-A PASS and separate Owner authorization |
| `G5C_SEND_VERIFIED` | NOT AUTHORIZED | Requires G5-B PASS and separate Owner authorization |
| `G5_LIVE_PILOT_VERIFIED` | NOT AUTHORIZED | Requires all stages and a final Owner review |
| `G6_SOAK` | NOT AUTHORIZED | Out of scope |

## Verified identity and offline status

- Connector image `zalo-shared-connector:g5-6d199162`, local digest `sha256:6b1f0100017d067f24d18eee53ffbfcffe7562ac3f79fd98283097ef1938d781`, local archive SHA-256 `149890e070a387e501c00d5f8dff5ccb3db15b19fced38e8ed859e992436420c` (57,530,880 bytes).
- Embedded build identity matches `6d19916`, `connector/package-lock.json` and the locked SDK integrity; UID 65532; no exposed ports; no `manifest.json`, `session.key`, `session.enc` or `qr.png` in the image.
- Trivy 0.76.1 reported **0 HIGH/CRITICAL** at scan time.
- Full local suite **286/286 PASS**; typecheck and connector build PASS.
- In-image `preflight` under `--network none` admitted the synthetic bootstrap, observe and send-test manifests and denied an out-of-scope manifest.
- A local image digest is not a registry digest or signed attestation; CI does not push an image. This remains a deployment limitation.

## Enforced G5 limits

Exactly one connector account, exactly one allowlisted direct peer, 1–10 outbound parts/account/day and at most 10 per grant, ≥2000 ms interval, 2-hour runtime cap bounded absolutely by grant expiry, text-only by default, no automatic reconnect (a fault exits non-zero as `connection-lost`), no automatic resend after unknown, no concurrent connector ownership, and separate Owner authorization per stage. One stored-credential login per process is performed; no QR/password re-enrollment or retry loop exists.

## Next action

G5-A was authorized for 2026-11-03 `02:00Z`–`02:30Z` and returned **`G5A_BLOCKED`** during preflight. No live action occurred. Before a new authorization: rotate the exposed local `zs_app` database credential, establish and verify scoped host egress, verify LAN inbound isolation, create the live enrollment manifest/consent binding and run the offline bootstrap preflight. Then request a fresh G5-A window. This status does not authorize G5-B or G5-C.

**STOP — `G5A_BLOCKED`. A new G5-A authorization is required; G5-B is not authorized.**
