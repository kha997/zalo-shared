# Owner pilot consent record — TEMPLATE ONLY

> **This is not a grant and records no approval.** It contains only nonsecret placeholders. Real account IDs, peer IDs, phone numbers, cookies, QR images and keys must never appear in this file, the repository, chat or evidence. Keep the completed record in the private pilot host and reference it by `consentRef`.

## Record

| Field | Value |
| --- | --- |
| Consent reference (`consentRef`) | `<CONSENT_REF>` (nonsecret, e.g. `owner-2026-11-XX-a`) |
| Owner | `<OWNER_NAME>` |
| Recorded at (UTC) | `<YYYY-MM-DDTHH:MM:SS.sssZ>` |
| Dedicated test account alias | `<ACCOUNT_A_ALIAS>` |
| Account A is a dedicated, legitimate blank test account | `<yes/no>` |
| Official-phone coexistence acknowledged | `<yes/no>` |
| Consenting peer alias (exact direct-message contact) | `<PEER_B_ALIAS>` |
| Peer B is the second dedicated test account or a consenting human | `<second-test-account/consenting-human>` |
| Pilot window start (UTC) | `<YYYY-MM-DDTHH:MM:SS.sssZ>` |
| Pilot window end (UTC, proposed start + 2 hours) | `<YYYY-MM-DDTHH:MM:SS.sssZ>` |
| Allowed purposes | `enroll-session` (separate ≤1 h grant), `observe`, `send-test` (staged) |
| Allowed peers | exactly `<PEER_B_ALIAS>`; no groups, no contact discovery |
| Maximum parts per day | `10` (schema hard maximum 30) |
| Minimum part interval | `2000` ms |
| Content scope | text only; no media, links, marketing or bulk messaging |
| Media scope | excluded from the initial pilot; a separate Owner decision is required |
| Evidence retention | `<RETENTION_DAYS_AND_LOCATION>` |
| Post-pilot deletion date (UTC) | `<YYYY-MM-DD>` |

## Risk acceptance (initial each line)

- `<initials/date>` I accept that this uses an unofficial client and may violate platform terms.
- `<initials/date>` I accept the risk of account restriction, suspension or permanent loss for account `<ACCOUNT_A_ALIAS>`.
- `<initials/date>` I understand phone coexistence and session-renewal behaviour are unproven until the pilot observes them.
- `<initials/date>` I accept that the pilot runs on a private host with no public ports and that QR/session material stays local.
- `<initials/date>` I accept the text-only, 10 parts/day, ≥2 s, 2-hour limits and the staged observe-before-send order.
- `<initials/date>` I approve the evidence and retention plan above and forbid credentials, QR images, phone numbers or real message bodies in GitHub.

## Owner signature / approval reference

`<SIGNED_NAME_OR_APPROVAL_REFERENCE>` at `<YYYY-MM-DDTHH:MM:SS.sssZ>`

## Notes

- A `consentRef` is a nonsecret label; it is not proof of identity or cryptographic consent.
- The consent window is absolute. A technical grant may expire earlier but never later.
- Broadening the account, peers, purposes, budget, interval, media scope, risks or window requires a new Owner decision.
- This template deliberately does not authorize any live action until the Owner records the values and gives separate explicit approval.
