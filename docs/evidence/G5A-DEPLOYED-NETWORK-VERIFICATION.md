# G5-A deployed network verification

**Gate:** `D2_DEPLOYED_NETWORK_BOUNDARY_VERIFIED`
**Date:** 2026-11-03 (UTC)
**Scope:** the reviewed topology actually deployed on the Owner workstation, not a fixture
**Branch:** `feat/shared-inbox`; reviewed source commit `2dff06e063b87d6abf5e25e4a1ca9c369ba7236e`
**Host:** WSL2 Ubuntu 24.04.4, kernel `6.6.87.2-microsoft-standard-WSL2`, Docker `29.6.2`

## What was deployed

[ops/local/deploy-pilot-topology.sh](../../ops/local/deploy-pilot-topology.sh) renders the reviewed compose file with the private interpolation values, starts the dedicated gateway, and asserts the resulting state. It changes only five dedicated resources:

| Resource | Value |
| --- | --- |
| Network `zalo-shared-pilot-db` | `internal=true`, `172.16.30.0/24` (D1) |
| Network `zalo-shared-pilot_pilot-egress` | `internal=true`, `172.16.29.0/24` |
| Network `zalo-shared-pilot_pilot-uplink` | non-internal, sole member the gateway |
| Container `zalo-shared-pilot-egress-gateway-1` | gateway at `172.16.29.10`, `cap_drop: ALL`, read-only root, no published ports, `ip_forward=0` |
| Connector service `pilot-connector` | UID 65532, read-only root, `cap_drop: ALL`, internal networks only |

No Windows Firewall rule, Docker daemon setting, host-wide route, or unrelated container/network was created or modified. There is no `-p` publish, no host network, and no additional member on the uplink.

## Rendered configuration (asserted, not assumed)

From the rendered document the deployed gateway was started from:

- Connector networks are exactly `pilot-db` and `pilot-egress`; gateway networks are exactly `pilot-egress` and `pilot-uplink`.
- Neither service publishes a port. `docker port` reports zero mappings.
- `PILOT_EGRESS_HOSTS=id.zalo.me,wpa.chat.zalo.me,jr.chat.zalo.me` and `PILOT_EGRESS_PORTS=443`.
- All three names are pinned in `extra_hosts` to `172.16.29.10`; the connector has no resolver path off the internal network.
- `PILOT_REQUIRE_INTERNAL_NETWORK=1`, so a namespace with a default route is refused at startup.
- The pilot CA is mounted read-only at `/run/pilot/db-ca.crt` and trusted through `NODE_EXTRA_CA_CERTS` (D1).
- The manifest mount is the synthetic bootstrap fixture and the session key/state mounts are the private pilot paths; no live grant or provider material is present.
- The connector and gateway are configured to run as UID 65532 with `cap_drop: ALL` and a read-only root; `/tmp` is a 16 MB `nosuid` tmpfs. The connector service is not started for the pilot until an Owner authorization; the negative tests run it from the reviewed image with the same settings.

## Verification matrix (live deployment)

[ops/local/verify-deployed-pilot.sh](../../ops/local/verify-deployed-pilot.sh) ran against the deployed topology and reported **48/48 assertions PASS**. Every probe uses a reserved `.test` name, a documentation address, a public literal with no route, or the gateway's private address — never a provider hostname.

| Area | Negative test | Result |
| --- | --- | --- |
| Kernel, guard absent | probe runs with `NODE_OPTIONS=` cleared | PASS |
| Kernel, guard absent | no IPv4 default route in the connector namespace | PASS |
| Kernel, guard absent | no usable IPv6 default route | PASS |
| Kernel, guard absent | direct public IPv4 connection fails at the network layer | PASS |
| Kernel, guard absent | direct public IPv6 connection fails at the network layer | PASS |
| Kernel, guard absent | host bridge ports `2026`, `5432`, `8080` unreachable | PASS |
| Kernel, guard absent | UDP to a public address not accepted | PASS |
| Kernel, guard absent | unpinned name does not resolve | PASS |
| Kernel, guard absent | the gateway's private address is reachable (positive control) | PASS |
| Gateway | unapproved SNI (`denied-target.test`) refused | PASS |
| Image guard | the deployed image loads its guard | PASS |
| Image guard | pinned name resolves to the gateway | PASS |
| Image guard | direct public IPv4 denied before any connect | PASS |
| Image guard | direct public IPv6 denied before any connect | PASS |
| Image guard | unpinned name denied before DNS | PASS |
| Image guard | UDP denied | PASS |
| Image guard | pinned name reaches the gateway and is not forwarded blindly | PASS |
| Empty policy | guard starts with an empty allowlist | PASS |
| Empty policy | allowlisted name denied at DNS | PASS |
| Empty policy | direct public IPv4 denied | PASS |
| Empty policy | UDP denied | PASS |
| Empty policy | pinned TLS target denied | PASS |
| Missing gateway | pinned gateway address refuses the connection | PASS |
| Missing gateway | guarded allowlisted path closed | PASS |
| Wrong attachment | connector on the non-internal uplink network refuses to start | PASS |
| Audit | the deployed gateway admitted no tunnel during verification | PASS |
| Audit | the gateway recorded the unapproved SNI refusal | PASS |
| Recovery | the gateway returns to `healthy` after the stop test | PASS |

The gateway was stopped and restarted only inside this script. It is the sole member of the uplink, so the test proves a missing gateway is a closed path rather than a reroute.

Before deployment, the same negative cases were run on disposable networks by [ops/local/verify-pilot-network.sh](../../ops/local/verify-pilot-network.sh) (**25/25 PASS** on `172.16.28.0/24`). That suite isolates topology from the host's live state; the deployed suite above repeats it on the real resources.

## Deployed-state assertions outside the probe

The 48 assertions also include these rendered/deployed checks:

- The deployed egress network reports `internal=true`, and the uplink network reports `internal=false`.
- The uplink network reports exactly one member, the gateway.
- The gateway has zero published ports and `ip_forward=0`.
- The gateway health check returns `healthy` after restart.
- The rendered gateway keeps the reviewed SNI allowlist and binds only the connector-facing address.
- The rendered egress subnet is `172.16.29.0/24`; the database network is the deployed `pilot-db`.
- The compose copy used for rendering lives in the private directory and is the same document the gateway was started from.

## Residual risks

- WSL2 uses a NAT boundary; this is not a hardware-segmented network proof. Host-wide LAN isolation remains `UNPROVEN` as recorded in [G5A-R3-LAN-ISOLATION.md](G5A-R3-LAN-ISOLATION.md).
- A host-root or Docker-daemon compromise defeats any container-level boundary. This is a private single-host pilot, not a hardened perimeter.
- The uplink is intentionally non-internal so the gateway can reach the provider; every other pilot container is internal-only and has no route to it.
- The gateway allowlist admits the three reviewed provider hosts on 443. The service-map and WebSocket hosts used by observe/send-test are still not admitted, so those stages remain functionally blocked as recorded in the pilot status.
- These are local, live results. They are not a production capacity, availability or compliance proof.

## Status

`D2_DEPLOYED_NETWORK_BOUNDARY_VERIFIED` — PASS on the actual host. No live Zalo action was involved or implied.
