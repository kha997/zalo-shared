# Pilot gate status

**Date:** 2026-11-03
**Branch:** `feat/shared-inbox`; reviewed connector artifact source `2963e1ad73151059b0c92af9a9a5ddb2e582c799`
**PR #3:** OPEN, **Draft** (not merged, not deployed)
**Owner decision:** `G5_SCOPE_APPROVED_ACTIVATION_PENDING` — D1–D7 approved in scope; live activation withheld
**G5-A authorization:** none current. The earlier `2026-11-03T02:00Z`–`02:30Z` window is invalid and was not reused.
**Live pilot:** **NOT ACTIVATED** — no Zalo login, QR scan, session, real account or external send performed

## Gates

| Gate | Status | Evidence |
| --- | --- | --- |
| `G1_ENVIRONMENT_ACCEPTED` | PASS | [G1-ENVIRONMENT-RECONNAISSANCE.md](docs/evidence/G1-ENVIRONMENT-RECONNAISSANCE.md) |
| `G2_INFRASTRUCTURE_READY` | PASS | [G2-PRIVATE-INFRASTRUCTURE.md](docs/evidence/G2-PRIVATE-INFRASTRUCTURE.md) |
| `G3_OFFLINE_VERIFIED` | **PASS (scoped)** | [G3-OFFLINE-ACCEPTANCE.md](docs/evidence/G3-OFFLINE-ACCEPTANCE.md); UNPROVEN: capacity above 100 clients, isolated-server browser case, key escrow, live provider |
| `G4_PILOT_ACTIVATION_PACKAGE` | **SUPERSEDED IN SCOPE** | [G4-PILOT-ACTIVATION-PACKAGE.md](docs/evidence/G4-PILOT-ACTIVATION-PACKAGE.md); D1–D7 accepted in scope by the G5 decision |
| `G5_SCOPE_APPROVED_ACTIVATION_PENDING` | **APPROVED IN SCOPE** | [G5-SCOPE-APPROVAL.md](docs/evidence/G5-SCOPE-APPROVAL.md) |
| `G5A_AWAITING_OWNER_START` | **SUPERSEDED** | Old authorization window invalidated by `G5A_BLOCKED` |
| `G5A_BOOTSTRAP_VERIFIED` | **BLOCKED** | [G5A-BOOTSTRAP-REPORT.md](docs/evidence/G5A-BOOTSTRAP-REPORT.md); no live action, egress isolation and credential containment failed preflight |
| `R1_CREDENTIAL_CONTAINMENT_PASS` | **PASS** | [G5A-CREDENTIAL-INCIDENT.md](docs/evidence/G5A-CREDENTIAL-INCIDENT.md) |
| `R2_EGRESS_ENFORCEMENT_PASS` | **BLOCKED** | [G5A-R2-EGRESS-BOUNDARY.md](docs/evidence/G5A-R2-EGRESS-BOUNDARY.md); guard implemented and tested, live endpoint inventory unprovable offline |
| `R3_LAN_ISOLATION_PASS` | **UNPROVEN** | [G5A-R3-LAN-ISOLATION.md](docs/evidence/G5A-R3-LAN-ISOLATION.md); no independent LAN device, firewall defaults not an explicit deny |
| `R4_MANIFEST_PREFLIGHT_PASS` | **PASS** | [G5A-R4-MANIFEST-PREFLIGHT.md](docs/evidence/G5A-R4-MANIFEST-PREFLIGHT.md); placeholder template only, no live grant |
| `R5_INDEPENDENT_REVIEW_PASS` | **IN PROGRESS** | [G5A-R5-INDEPENDENT-REVIEW.md](docs/evidence/G5A-R5-INDEPENDENT-REVIEW.md) |
| `G5A_REMEDIATED_AWAITING_NEW_OWNER_START` | **NOT MET** | Blocked by R2 and R3 |
| `G5A_REMEDIATION_BLOCKED` | **ACTIVE** | [G5A-REMEDIATION-REPORT.md](docs/evidence/G5A-REMEDIATION-REPORT.md) |
| `G5B_OBSERVE_VERIFIED` | NOT AUTHORIZED | Requires G5-A PASS and separate Owner authorization |
| `G5C_SEND_VERIFIED` | NOT AUTHORIZED | Requires G5-B PASS and separate Owner authorization |
| `G5_LIVE_PILOT_VERIFIED` | NOT AUTHORIZED | Requires all stages and a final Owner review |
| `G6_SOAK` | NOT AUTHORIZED | Out of scope |

## Verified identity and offline status

- Connector image `zalo-shared-connector:g5-2963e1ad`, local image digest `sha256:a1d6f79a26309494878958d6e9272cc1de1b7f67af4804afb2efffcd29707197`.
- Embedded build identity matches `2963e1ad`, `connector/package-lock.json` (`17dcd254…030c9b`) and the locked SDK integrity; UID 65532; no exposed ports; no `manifest.json`, `session.key`, `session.enc` or `qr.png` in the image.
- The egress guard is preloaded by the image entrypoint and by `NODE_OPTIONS`, so clearing `NODE_OPTIONS` through an env file does not remove it.
- Full local suite **302/302 PASS**; typecheck and connector build PASS; guard suite 14/14 PASS.
- In-image `preflight` under `--network none` admitted the synthetic bootstrap, observe and send-test manifests and denied expired, out-of-scope, extra-field, missing-build, wrong-identity, placeholder and stage-mismatch cases.
- A local image digest is not a registry digest or signed attestation; CI does not push an image. This remains a deployment limitation.

## Enforced G5 limits

Exactly one connector account, exactly one allowlisted direct peer, 1–10 outbound parts/account/day and at most 10 per grant, ≥2000 ms interval, 2-hour runtime cap bounded absolutely by grant expiry, text-only by default, no automatic reconnect (a fault exits non-zero as `connection-lost`), no automatic resend after unknown, no concurrent connector ownership, and separate Owner authorization per stage. One stored-credential login per process is performed; no QR/password re-enrollment or retry loop exists.

## Next action

Resolve the two open blockers before requesting a new G5-A window:

1. **R2:** authorize a time-bounded endpoint-observation stage, an Owner-approved network egress gateway, or a narrow first-party bootstrap allowlist. The exact redirect and later-stage service hosts cannot be proven offline, and live discovery is currently prohibited.
2. **R3:** run the LAN probes from an independent device, or obtain Owner approval for an explicit inbound-deny firewall policy.

No activation time has been chosen. This status does not authorize G5-B or G5-C.

**STOP — `G5A_REMEDIATION_BLOCKED`. A new G5-A authorization is required; G5-B is not authorized.**
