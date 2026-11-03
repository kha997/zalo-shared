# G5-A R3 — LAN isolation assessment

**Date:** 2026-11-03
**Gate:** `R3_LAN_ISOLATION_PASS` (pilot resources; see §8)
**Scope:** pilot app, pilot PostgreSQL, pilot connector and private resources
**Live Zalo action:** none from this LAN assessment. (An unrelated unauthorised
provider probe earlier in the G5-A session is disclosed in
[G5A-BOUNDARY-PROBE-INCIDENT.md](G5A-BOUNDARY-PROBE-INCIDENT.md).)
**Host changes:** none

## 1. Verdict

Pilot-specific exposure is loopback-only and the pilot database is reachable only
on its internal Docker network. LAN isolation as a whole is **UNPROVEN** because
no independent LAN device was available and the Windows/WSL defaults observed
here are not an explicit deny boundary. No global firewall or network setting
was changed.

*Updated 2026-11-03:* the pilot-resource conclusion is now PASS because it rests
on bind scope and network attachment, which are OS state, rather than on the
host firewall. The host-wide limitation remains and is recorded in §8.

## 2. Pilot resources

| Resource | Binding | Exposure | Result |
| --- | --- | --- | --- |
| Pilot app `zalo-shared-g2-app-1` | `127.0.0.1:3100` on the host only | loopback | PASS |
| Pilot PostgreSQL `zalo-shared-g2-postgres-1` | container `5432/tcp`, no host port | private Docker network only | PASS |
| Pilot connector | not running; image publishes no ports | none | PASS (static) |
| Pilot private files | `~/pilot-private/...`, `0700` dirs and `0600` files, UID 65532 | local only | PASS (permissions) |

Docker evidence:

- `docker ps` showed the app as `127.0.0.1:3100->3100/tcp` and PostgreSQL as
  `5432/tcp` with no host mapping.
- The app joined `zalo-shared-g2_edge` and `zalo-shared-g2_private`.
- PostgreSQL joined only `zalo-shared-g2_private`.
- `zalo-shared-g2_private` is an internal bridge network (`172.19.0.0/16`).
- A container on the edge network could not reach PostgreSQL; a container on the
  private network could. The pilot database is not reachable from the edge.
- The connector compose example publishes no ports and sets no restart policy.

## 3. Host and WSL network state

- WSL uses mirrored networking and has one LAN-facing IPv4 address on
  `192.168.1.0/24` (recorded as `<LAN_IP>` here).
- The only pilot listener in WSL was `127.0.0.1:3100`.
- `ss -ltn` also showed pre-existing, unrelated listeners:
  `0.0.0.0:5432` and `[::]:5432` (host PostgreSQL), `*:2026`
  (deer-flow-nginx), and loopback-only services on 5435, 6379, 3306, 20128,
  11435 and 46245. They are outside this pilot and were not changed.

## 4. Windows firewall and probes

- Domain, Private and Public firewall profiles were enabled, but both default
  inbound and outbound actions were `NotConfigured`. That is not an explicit
  deny rule.
- The Hyper-V firewall setting `{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}` was also
  `NotConfigured`.
- No enabled inbound allow rule was found for ports 3100, 5432 or 2026.
- Probes from the Windows host:

| Target | Result |
| --- | --- |
| `127.0.0.1:3100` | reachable (`HTTP 200` on `/health/ready`) |
| `127.0.0.1:5432` | reachable (pre-existing host PostgreSQL, not the pilot) |
| `127.0.0.1:2026` | reachable (pre-existing nginx, not the pilot) |
| `<LAN_IP>:3100` | refused |
| `<LAN_IP>:5432` | refused |
| `<LAN_IP>:2026` | refused |
| `[::1]:3100` | refused |

The LAN-IP probes were run from the same Windows host, not from an independent
device. They do not prove that another LAN device cannot reach the pilot, and
they do not prove that the unrelated `0.0.0.0` listeners are unreachable from a
real peer.

## 5. Why this is UNPROVEN

1. No independent LAN device was available, so no external reachability test was
   performed.
2. Windows default inbound is `NotConfigured`, not an explicit block. The
   effective behaviour depends on profile state and any future rule changes.
3. WSL mirrored networking exposes a LAN-facing interface. Loopback-only Docker
   publication protects the pilot, but the host's unrelated `0.0.0.0` listeners
   remain governed by host firewall policy, which was not changed.
4. IPv6 was checked only on loopback. The pilot does not bind IPv6, but host and
   container IPv6 exposure was not independently tested.

## 6. Recommended closure options

- Perform the same probes from a separate LAN device once one is available
  (preferred, no host change).
- Or have the Owner approve an explicit inbound-deny policy for the WSL/Hyper-V
  firewall. That is a host-wide change and is not authorized here.
- Do not change or stop the unrelated host PostgreSQL or nginx listeners as part
  of this pilot.

## 7. Evidence boundary

This record contains no Zalo account identifier, peer identifier, password,
cookie, key, session, QR or raw connection string. The LAN address is redacted.
These are local/offline observations, not live provider evidence.

## 8. Resolution — bind-scope isolation (2026-11-03)

`ops/local/check-lan-exposure.sh` re-measured the running stack and now asserts
the property the earlier assessment left implicit: the pilot does not depend on
the host firewall at all. Latest run: **10/10 assertions PASS**.

| Assertion | Observed |
| --- | --- |
| The app publishes exactly one port, on loopback only | `3100/tcp -> 127.0.0.1:3100` |
| PostgreSQL publishes no host port | no mapping |
| Neither workload uses host networking | bridge networks only |
| The private network is `internal=true` | true |
| The private network holds only the app and its database | both, nothing else (the connector is not running; when started it is the only additional admitted member) |
| The host listener table shows the app only on `127.0.0.1:3100` | `ss -ltnH` reports no other `:3100` bind |
| The database has an address on the private network | `172.19.0.2` |
| The app is not reachable at the LAN address | `192.168.1.246:3100` not connected from a non-loopback source |
| The database is not reachable from another bridge network | not connected |

The script runs its probe with `NODE_OPTIONS=` and a plain entrypoint
(`check-lan-exposure.sh:55-56`), so the connector guard is provably not part of
these results.

The LAN IP is selected by excluding loopback and Docker's default pools
(`172.16.0.0/12`), so a container bridge address can never be mistaken for the
host's LAN address. The negative probes ran from a container on the default
bridge, so the source address was not loopback. That is the closest
approximation to an independent device available on this host, and it is
recorded as an approximation, not as an independent-device result.

Why the bind scope is sufficient for the pilot: a socket bound to `127.0.0.1`
cannot accept a packet addressed to the LAN IP, whatever the firewall does, and
an `internal=true` Docker network has no route off the host. The pilot connector,
the egress gateway and PostgreSQL publish nothing at all. Authorized host-local
access is unchanged: `Test-NetConnection 127.0.0.1 -Port 3100` from Windows still
succeeds.

Remaining host-wide limitation, unchanged and out of scope:

- Windows firewall profiles are enabled with `DefaultInboundAction
  NotConfigured`, and the WSL Hyper-V firewall setting is also `NotConfigured`.
  That is the effective default-deny, but it is not an explicit rule and no host
  change was authorized.
- Pre-existing, unrelated `0.0.0.0` listeners remain on this host (host
  PostgreSQL 16 on 5432, nginx on 2026, an application on 8080). They were not
  started, stopped or reconfigured by this work.
- Only a second physical device can exercise the mirrored-WSL interface path and
  the firewall end to end. That test has not been run.

Verdict for the pilot resources: **PASS**. Verdict for the host as a whole:
**UNPROVEN**, with the four items above stated as the exact reason.
