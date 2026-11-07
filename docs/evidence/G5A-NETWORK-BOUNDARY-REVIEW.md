# G5-A network boundary: independent review and dispositions

**Date:** 2026-11-03
**Scope:** the uncommitted network-boundary change set on `feat/shared-inbox`
**Live Zalo action:** none for these reviews. The earlier unauthorised probe is
disclosed separately in
[G5A-BOUNDARY-PROBE-INCIDENT.md](G5A-BOUNDARY-PROBE-INCIDENT.md).

## 1. How the review was done

Two independent reviews were run in parallel against the working tree: one from
a delegated reviewer agent and one directly by the Engineering Lead acting as a
second reviewer. Both returned **BLOCKED** with the same P1, which is why the
finding was treated as real rather than stylistic. After the fix, a third,
focused closure review re-audited the P1 and every claim in the evidence
documents. That reviewer did not run the container verifier; it inspected the
scripts and ran the focused unit tests (39/39).

## 2. Blocking finding and closure

### P1 — operator-named database network could be non-internal

`pilot-db` is `external: true`, so the pilot compose file cannot declare it
`internal=true`. If the operator named a non-internal network (for example the
application's `edge` network), the connector would receive a default route, and
every static check in `check-pilot-network.sh` would still pass because it only
asserts the names and the `pilot-egress` network.

Disposition: **fixed with two independent controls.**

1. `ops/local/preflight-connector.sh` now requires `PILOT_DB_NETWORK`, inspects
   that exact network, and exits non-zero unless Docker reports `Internal=true`.
   Requiring the variable also closes the reviewer's P2: the check can no longer
   be skipped silently when the variable is absent.
2. `ops/pilot-egress-guard.cjs` refuses to start when
   `PILOT_REQUIRE_INTERNAL_NETWORK=1` and the namespace has a usable IPv4 or
   IPv6 default route. The image sets that variable in its `ENV`, and the
   compose file sets it again. An unreadable `/proc/net/route` or
   `/proc/net/ipv6_route` is now denied too, instead of being treated as an
   empty table.
3. `ops/local/verify-pilot-network.sh` exercises the refusal on a deliberately
   non-internal fixture and asserts the process exits with
   `PILOT_EGRESS_DENIED`.

Closure review: the P1 is closed. The route parser was checked against the real
`/proc` formats (IPv4 flags parsed as hex; IPv6 flags at index 8; the kernel
reject default `0x00200200` is not usable), and `docker network inspect`
returns `true`/`false` as expected for `zalo-shared-g2_private` and
`zalo-shared-g2_edge`.

## 3. Other findings

| ID | Finding | Disposition |
| --- | --- | --- |
| P2-1 | Mixed DNS answers were described as denied but no test proved it | Fixed: `answersAdmissible` requires every answer to equal the pin; unit test added |
| P2-2 | A malformed configured `DATABASE_URL` was ignored instead of failing at startup | Fixed: `parseDatabase` throws `PILOT_EGRESS_DENIED`; unit test added |
| P2-3 | SNI parsing bounded against the whole record and accepted high-bit bytes | Fixed: bounds use the ClientHello length; bytes `>= 0x80` are rejected; unit test added |
| P2-4 | Gateway listened on `0.0.0.0` inside its namespace | Fixed: `GATEWAY_BIND_ADDRESS` is the static egress address; static check asserts it |
| P2-5 | Connector could start before the gateway was healthy | Fixed: gateway healthcheck plus `depends_on: service_healthy` |
| P2-6 | CI `tee` masked failures and exit 2 conflated "skipped" with "failed" | Fixed: `set -o pipefail`; exit 77 means SKIP and is the only accepted skip |
| P2-7 | Gateway scan overwrote connector vulnerability evidence | Fixed: `scan-image.sh` takes an output prefix; CI writes `gateway-*` |
| P2-8 | LAN check did not prove the host listener scope and overstated membership | Fixed: `ss` listener assertion and Docker-pool exclusion; membership label is now conditional on the connector actually running |
| P2-9 | Two evidence claims were written before the tests existed | Fixed: both tests were added and the counts re-measured |
| P3-1 | `PILOT_REQUIRE_INTERNAL_NETWORK` is strict `"1"`, so an explicit empty override disables it | Accepted. The image `ENV`, the compose `environment` and `check-pilot-network.sh` all require `"1"`. Removing it is equivalent to overriding the entrypoint, which the marker already treats as an operator action. Recorded in §6 of [G5A-NETWORK-BOUNDARY.md](G5A-NETWORK-BOUNDARY.md). |
| P3-2 | A container connected to a non-internal network after start is not rechecked | Accepted. That requires Docker-daemon access, which is residual 3 (daemon trust). The check is a start-time misconfiguration stop. |
| P3-3 | The route parser detects `0.0.0.0/0` but not a `0.0.0.0/1` + `128.0.0.0/1` pair | Accepted. The connector has `cap_drop: ALL` and no `NET_ADMIN`, so it cannot create such a pair; Docker's internal networks do not. |
| P3-4 | `PILOT_EGRESS_GATEWAY` is optional in the guard | Accepted as defense in depth: the compose file sets it, and `check-pilot-network.sh` fails if it differs from the gateway's static address. Stated in the evidence, not silently assumed. |
| P3-5 | `scan-image.sh` lost its executable bit in the working tree | Fixed: mode restored to `100755`. |
| P3-6 | The bypass matrix said host services were "bound elsewhere", which is false on this host | Fixed: the row now says the negative result is specific to Docker Desktop and points at residual 8. |
| P3-7 | The R3 table listed ten rows but one was not an assertion | Fixed: the guard-cleared note is prose, not a table row; the ten assertions match the script. |
| P3-8 | R2 and R3 said "Live Zalo action: none" without incident context | Fixed: both headers link the incident record. |

## 4. Claims re-measured after the fixes

| Claim | Measurement |
| --- | --- |
| Static topology | `check-pilot-network.sh`: 15 assertion groups PASS |
| Guard and gateway unit tests | 39/39 PASS (guard 23, gateway 16) |
| Allow-path harness | 21/21 PASS |
| Container boundary | 25/25 PASS against images built from the working tree |
| LAN exposure | 10/10 PASS |
| Full local suite | 327/327 PASS on Node v24.19.0 |

The container and LAN runs used images rebuilt from the committed change set
`2dff06e063b87d6abf5e25e4a1ca9c369ba7236e`:
`zalo-shared-connector:g5-local` (`sha256:9bced3eb…c8427998`, embedded
`sourceCommit` `2dff06e…`) and `zalo-shared-egress-gateway:g5-local`
(`sha256:bfde5c7a…85ad4e75`). All counts above were re-measured against those
images after the commit, not only against the earlier working tree.

## 5. Gate impact

No finding remains open at P1 or P2. The P3 items are either fixed or accepted
with a stated reason, and none of them weakens the kernel boundary. The
reviewer's conclusion was that nothing found blocks
`G5A_NETWORK_BOUNDARY_VERIFIED`.
