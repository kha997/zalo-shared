# G5-A boundary probe incident: unintended provider contact

**Date:** 2026-11-03
**Severity:** process failure, no credential or session exposure
**Self-reported by:** Engineering Lead (Qoder), during the G5-A network
boundary resolution directive
**Live Zalo action authorized by this directive:** none

## 1. What happened

While determining which Node.js connection hooks `fetch` and `ws` traverse — a
question that decides where a CONNECT tunnel must be installed — a diagnostic
script was written with two **real** provider hostnames instead of reserved
test names. Both produced outbound connections from the WSL workstation:

| # | Request | Transport | Observed result |
| --- | --- | --- | --- |
| 1 | `GET https://id.zalo.me/probe` | undici `fetch` over TLS/443 | No exception raised; a response was received. Status not recorded. |
| 2 | WebSocket upgrade to `wss://jr.chat.zalo.me/ws` | `ws@8.22.0` over TLS/443 | Server answered `404`; the WebSocket was never established. |

Both requests originated from the workstation's Node.js v24.19.0 in
`/home/zen/Projects/zalo-shared`, **not** from the connector image, **not**
from any container, and **not** with the egress guard loaded.

## 2. What was not transmitted

The two probes were bare connectivity traces. They carried no:

- session key, session record, cookie or `imei`;
- QR code content or enrollment material;
- real account identifier, peer identifier or customer data;
- credential, `DATABASE_URL`, manifest or grant;
- Zalo authentication attempt, login call, `run-observe` or `run-send-test`.

Request 1 sent the default undici header set for a plain `GET`. Request 2 sent
the default `ws` upgrade headers (`Host`, `Upgrade`, `Connection`,
`Sec-WebSocket-Key`, `Sec-WebSocket-Version`) with no `cookie`, no
`user-agent` override and no `origin` — the headers `zca-js` would normally
attach were absent because the probe bypassed the SDK entirely. No session was
created and no account state was changed.

Other outbound contacts during the same investigation were connectivity
canaries to `1.1.1.1:443`, `8.8.8.8:53` and `8.8.8.8:53/udp` from throwaway
`alpine:3.20` containers. Those are infrastructure reachability probes, not
provider endpoints, and were used as the positive control that distinguishes
the `internal=true` network (all denied) from the `edge` network (all allowed).

A separate earlier probe sent `CONNECT id.zalo.me:443` and
`CONNECT wpa.chat.zalo.me:443` to a **loopback** logging proxy that answered
`502` and never forwarded. That probe did not reach the provider and is
recorded here only to make the boundary between the two cases explicit.

## 3. Why it happened

The invariant "no provider communication" was treated as a constraint on the
*connector* rather than on every diagnostic process run during the
investigation. The hook-tracing script needed a hostname that would actually
resolve so the code path would be entered; a reserved name (`.invalid`) fails
at DNS before `tls.connect` is reached, so a real name was substituted without
re-checking the invariant. That substitution was the error.

## 4. Containment and prevention

- The script was deleted with its temporary directory; it was never added to
  the repository, never committed and is not part of any artifact.
- Hook-tracing conclusions are retained because they were also confirmed by a
  loopback-only experiment that reached no provider.
- All subsequent connectivity probes in this directive use reserved names
  (`*.invalid`), TEST-NET addresses, loopback, or local synthetic servers.
  Where a resolvable public destination is genuinely required, it is a
  non-provider canary and is labelled as such in the evidence.
- Any future diagnostic that must enter a resolve-then-connect path does so
  against a local synthetic target, never against a provider host.

## 5. Gate impact

This incident does not create, extend or imply any activation window, and it
does not change the authorization state: no G5-A grant exists, the
`2026-11-03T02:00:00Z`–`02:30:00Z` window remains invalid and unusable, and
G5-B remains unauthorized. It is disclosed because the project's evidence
discipline requires separating what was proven from what was merely asserted,
and an undocumented outbound provider contact would make the network boundary
evidence untrustworthy.

**STOP — no real Zalo authentication. No activation window selected.**
