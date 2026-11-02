# Pilot gate status

**Date:** 2026-11-02
**Branch:** `feat/shared-inbox`; connector artifact source `ea66d8b94dde26e67bcb438e114fdd2454401a2d`; G1–G3 evidence at `adf8cec`
**PR #3:** OPEN, **Draft** (not merged, not deployed)
**Live pilot:** **NOT AUTHORIZED** — no Zalo login, QR scan, session, real account or external send performed.

## Gates

| Gate | Status | Evidence |
| --- | --- | --- |
| `G1_ENVIRONMENT_ACCEPTED` | PASS | [G1-ENVIRONMENT-RECONNAISSANCE.md](evidence/G1-ENVIRONMENT-RECONNAISSANCE.md) |
| `G2_INFRASTRUCTURE_READY` | PASS | [G2-PRIVATE-INFRASTRUCTURE.md](evidence/G2-PRIVATE-INFRASTRUCTURE.md) |
| `G3_OFFLINE_VERIFIED` | **PASS (scoped)** | [G3-OFFLINE-ACCEPTANCE.md](evidence/G3-OFFLINE-ACCEPTANCE.md); UNPROVEN: capacity above 100 clients (200/500 FAIL), isolated-server browser case, key escrow, live provider |
| `G4_AWAITING_OWNER_LIVE_APPROVAL` | **AWAITING OWNER** | [G4-PILOT-ACTIVATION-PACKAGE.md](evidence/G4-PILOT-ACTIVATION-PACKAGE.md) |
| `G5_LIVE_PILOT_VERIFIED` | NOT AUTHORIZED | Requires separate explicit Owner approval |

## Verified identity

- Connector image `zalo-shared-connector:g4-ea66d8b`, image ID `sha256:e8a002abbd5ac4…`, UID 65532, `zca-js@2.2.0`, 0 HIGH/CRITICAL.
- Embedded build identity matches `ea66d8b`, `connector/package-lock.json` and the locked SDK integrity; app image ID is unchanged from the G3 baseline.
- `check-connector-identity.sh` accepts the reviewed artifact commit, so later docs/ops commits do not invalidate the image check.
- Offline dry-run admitted with a synthetic manifest under `--network none`; five invalid-manifest variants, missing acknowledgement, wrong-purpose commands and unknown commands were denied.
- Synthetic QR view wrote 0600 UID 65532, rejected non-PNG and cleared the file.
- App/DB stay loopback/internal; connector publishes no ports and defaults to dry-run.

A local image ID is not a registry digest or a signed attestation. Deployment must use the CI-recorded immutable digest.

## Open Owner decisions (all unaccepted)

1. **D1** Dedicated account A and official phone.
2. **D2** Exactly one consenting peer B and the exact UTC 2-hour window.
3. **D3** Owner-controlled private host with local QR display, no public ports, restricted Docker/egress.
4. **D4** Staged bootstrap → observe → send-test with 10 parts/day, ≥2 s interval, text-only, 2 hours.
5. **D5** Explicit unofficial-client/platform-terms/account-restriction risk acceptance.
6. **D6** Media excluded from the initial pilot, or a separately approved media scope.
7. **D7** Evidence retention location/duration and post-pilot deletion date.

Owner must also confirm the CI image digest and private key/session paths before activation.

## Next action

The Owner returns decisions D1–D7 by [consent reference](operations/OWNER-CONSENT-TEMPLATE.md), confirms the CI digest, and grants separate explicit G5 authorization. Until then the environment remains offline and PR #3 remains Draft.

**STOP — do not start the live pilot from this status.**
