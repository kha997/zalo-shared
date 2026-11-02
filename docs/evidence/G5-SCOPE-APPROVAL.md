# G5 Owner scope decision — activation pending

**Decision date:** 2026-11-02
**Decision status:** `G5_SCOPE_APPROVED_ACTIVATION_PENDING`
**Live activation:** **NOT AUTHORIZED** by this record. No QR enrollment, Zalo authentication, live observation or external send has occurred.

This record captures the Owner decision that approved D1–D7 **in scope** while withholding live activation. The Owner's original decision document remains the authoritative source; this is the repository-side summary without identifiers or secrets.

## Approved scope

| # | Decision | Approved scope |
| --- | --- | --- |
| D1 | Dedicated account and phone | One dedicated, legitimate test account `ACCOUNT_A_ALIAS` and its official phone; never a production or customer account |
| D2 | Consenting peer and window | Exactly one consenting direct-message peer `PEER_B_ALIAS`; a single explicit UTC window; no groups or contact discovery |
| D3 | Private host and QR | Owner-controlled private host, local QR display only, no public connector ports, internal database network, restricted outbound access, private credential/session storage |
| D4 | Stage order and limits | `bootstrap` → `run-observe` → `run-send-test`, each with separate Owner authorization; 10 outbound parts/account/day, ≥2 s between parts, 2 hours per activated session, text only |
| D5 | Platform and account risk | Owner accepts unofficial-client, platform-terms and account-restriction/ban risk for the two dedicated test accounts only; no evasion, stealth, replacement accounts or production operation |
| D6 | Media | Text only. Images, files, voice/video, groups, bulk messaging, contact discovery and media CDN access are excluded and must fail closed |
| D7 | Retention and deletion | Stop and revoke after the pilot; remove session material, QR, pilot messages/media and temporary grants; retain only sanitized reports, security evidence, aggregate metrics and defect records; disclose retained encrypted backups |

The Owner also accepted the G4 security and isolation assumptions on the condition that any change to them stops the pilot and requires renewed approval.

## Enforced technical limits

The repository enforces the following independently of the generic pilot policy, which is broader:

- exactly one connector account and exactly one allowlisted direct peer for observe/send-test;
- a null account and zero peers only for the ≤1-hour enrollment grant;
- 1–10 outbound parts per account per UTC day, at most 10 per grant, and a minimum 2000 ms interval;
- a 2-hour wall-clock runtime cap measured by the connector process, with a terminal `session-limit` stop; the grant `expiresAt` set at activation is the absolute bound across restarts;
- text-only dispatch by default: an attachment request is refused before reservation or egress;
- zero automatic reconnects; a lost connection aborts the session and exits non-zero as `connection-lost`, and teardown waits up to 3 seconds to persist the fault before releasing ownership;
- no automatic resend after an unknown result and no concurrent connector ownership; one stored-credential login per process, with no QR/password re-enrollment or retry loop (SDK-internal refresh is unverified);
- offline `preflight` denies a manifest outside this scope; live commands independently re-assert the scope and verify the embedded build identity before touching keys, session, database or SDK.

## Staged gates

Each stage requires a separate explicit Owner authorization before live entry. A technical PASS does not authorize progression.

| Stage | Status | Gate token on technical PASS |
| --- | --- | --- |
| G5-A bootstrap (QR enrollment only) | PREPARED, AWAITING OWNER START | `G5A_BOOTSTRAP_VERIFIED` |
| G5-B observe | NOT AUTHORIZED | `G5B_OBSERVE_VERIFIED` |
| G5-C send-test | NOT AUTHORIZED | `G5C_SEND_VERIFIED` |

## Not authorized

This decision does not authorize production deployment, HANU or customer accounts, additional recipients, higher limits, media, public exposure, PR #3 merge, G6 soak or automatic production transition. It does not authorize evasion of platform restrictions or automated replacement accounts.

## Stop conditions

Stop immediately on any account warning, restriction or suspicious login; phone logout or loss; UID mismatch; an unexpected recipient or inbound event; credential, cookie, session or QR leakage; duplicate or unexplained outbound work; loss of exclusive ownership; an uncertain send result; uncontrolled network/session state; or expired consent, grant or window. Preserve only sanitized diagnostics, do not auto-restart, switch accounts or retry, and follow [PILOT-TEARDOWN.md](../operations/PILOT-TEARDOWN.md) when the Owner ends the pilot.

## Evidence boundary

Offline preflight, unit/integration tests and CI are **synthetic** evidence. Provider authentication, phone coexistence, delivery, session renewal and platform behaviour remain **UNPROVEN** until each live stage produces its own report.
