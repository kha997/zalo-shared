# G5-A redirect policy — blocked before the 2026-11-07 01:02–01:32Z window

**Date:** 2026-11-07
**Authorization:** `G5A_SINGLE_BOOTSTRAP_CONDITIONAL_START`, window
`2026-11-07T01:02:00Z`–`01:32:00Z`
**Verdict:** **`G5A_BLOCKED_REDIRECT_POLICY`**
**Live action:** none — no grant was created, no QR was generated, no provider
contact occurred, no deployed artifact changed.

## 1. Requirement being evaluated

The authorization makes the live attempt conditional on first determining, with
sanitized evidence from the 2026-11-07 `redirect-denied` failure, the minimum
necessary redirect-policy change, reproducing it offline, independently reviewing
the URL, host, redirect sequence and TLS implications, verifying with the pinned
SDK and synthetic tests, and deploying only a reviewed, narrowly scoped change.
If that cannot be completed before expiry, the instructed outcome is
`G5A_BLOCKED_REDIRECT_POLICY` without a real QR.

## 2. What the evidence establishes

- Report §12: `qr-shown` `00:04:15.547Z`, `scanned` `00:05:05.668Z`,
  `failed reason:"redirect-denied"` `00:05:07.348Z`, exit 1.
- The gateway admitted exactly one tunnel, `id.zalo.me` at `00:04:15.381Z`, and
  logged no tunnel, deny or other SNI after the scan. The refusal therefore
  happened inside the process, before a socket was opened.
- The diagnostic sink and console use a closed vocabulary; they record the reason
  code only and deliberately never echo the refused URL, host or payload.

## 3. Policy and SDK as deployed

`adapters/zalo/redirect-policy.ts` in image `zalo-shared-connector:g5-ready-6d9c0e9`
enforces:

1. only reviewed provider hosts, `https:`, port 443, no userinfo, no IP literal;
2. every request forced to `redirect: "manual"`;
3. a `Location` is followable only when the request is the exact
   `checkSession` URL (`https://id.zalo.me/account/checksession?continue=https%3A%2F%2Fchat.zalo.me%2Findex.html`)
   and the target is an absolute `https:` URL on exactly `chat.zalo.me`,
   followed once with exact `href` equality;
4. `chat.zalo.me` is never a direct request target;
5. anything else fails closed as `redirect-denied`.

The pinned `zca-js@2.2.0` artifact read offline from the same image issues exactly
that `checkSession` request and, on success, calls
`https://jr.chat.zalo.me/jr/userinfo`, which is already admitted.

## 4. Why the exact target cannot be established offline

Three refusal paths remain consistent with the sanitized evidence, and they imply
different minimal changes:

| Candidate | Refusal reason | Implied change |
| --- | --- | --- |
| A. `checkSession` returned a 3xx whose `Location` is not `https://chat.zalo.me/…` | unvalidatable hop | admit one new destination (unknown which) |
| B. the followed `chat.zalo.me` response itself returned a 3xx | only the exact checkSession response may yield a hop | allow a bounded same-host hop, with new review |
| C. a post-scan request targeted `chat.zalo.me` directly | redirect host is never a direct target | admit specific paths as direct requests |

The refused URL/host is not in any retained evidence, and the gateway never saw a
second connection. Offline fixtures can only replay an assumed provider
response, so they cannot distinguish A, B and C; a synthetic test would encode
whichever assumption was chosen and prove nothing about the provider. Selecting
one of these three without the observed chain would be exactly the unreviewed,
speculative broadening the authorization forbids.

## 5. Why nothing was deployed

Completing the required sequence needs: the exact chain (unavailable), the
minimal rule derived from it, independent review, pinned-SDK synthetic
verification, a rebuilt image with a new build identity, and deployed
re-verification. With roughly thirty minutes left and the first input missing,
any change would be guesswork; no security condition may be waived to meet the
deadline. No image, policy, allowlist, compose file, gateway or firewall change
was made, and no new grant or QR was produced.

## 6. Verified state at the stop

Read-only verification after the window opened: ownership `idle`, owner null,
epoch 6, `fault_code` null, `last_fenced_*` = `7cc878cf-…`/5; `provider_state`
`disconnected`, `reconciliation_required=false`, gap 6; `sessions=0`, no
`session.enc`, no connector container, private view empty; gateway still ends at
`2026-11-07T00:04:15.381Z` `sni_allow id.zalo.me`; audit unchanged at 20 rows;
all message, delivery and provider tables zero.

## 7. What would unblock the next attempt

Either of these, under a new explicit Owner authorization naming a fresh UTC
window:

1. a reviewed diagnostic classification that records the denied **hostname** and
   redirect-hop count (never the URL, query, cookie or payload) in the existing
   `0600` sink, deployed first and exercised by one authorized live attempt; or
2. an independently sourced statement of the post-scan redirect chain, from
   provider documentation or the pinned SDK's own contract.

With the chain known, the minimum policy change can be specified, reviewed,
tested against the pinned SDK and synthetic fixtures, deployed with a new
identity, and only then used for a bootstrap.

**STOP — `G5A_BLOCKED_REDIRECT_POLICY`.** This window cannot be reused; no retry
exists. G5-B, G5-C, production deployment and PR merge remain unauthorized.
