# G5-A network boundary: architecture and verification

**Date:** 2026-11-03
**Directive:** resolve the R2 egress-enforcement and R3 LAN-isolation blockers
with an enforcement boundary independent of the connector process.
**Live Zalo action:** none.

## 1. Decision

Pilot egress is enforced by **Docker network topology plus a separate,
allowlist-only TLS SNI gateway**. The connector is attached only to networks
declared `internal=true`, so its namespace has no default route and no external
resolver; the gateway is the only workload with an uplink, and it admits an
exact allowlisted SNI or nothing.

Options considered:

| Option | Verdict |
| --- | --- |
| Dedicated internal Docker network + controlled egress gateway | **Selected.** Kernel-enforced, no host-wide change, no new host, reversible with `docker compose down`. |
| CONNECT/HTTP proxy | Rejected. The pinned SDK's WebSocket path calls `tls.connect` through its own `createConnection` and forwards no proxy agent, so covering it would mean patching an integrity-pinned dependency. |
| Dedicated isolated VM | Rejected as the primary control. It adds a host to maintain and still needs an egress rule; the same gateway design would live inside it. |
| Host firewall / Hyper-V rules | Rejected as the primary control. Host-wide changes are not authorized, the current defaults are `NotConfigured`, and a firewall rule does not stop the connector from opening a socket. It remains a valid future outer layer. |
| Process-local Node guard only | Rejected. It is not OS-enforced isolation; it stays as defense in depth. |

The selected design is the smallest solution where the enforcement point is a
kernel routing decision and a separate process boundary, not connector code.

## 2. Topology

```
                        Windows / WSL host (mirrored networking)
                        ┌───────────────────────────────────────┐
   127.0.0.1:3100 ◄─────┤ zalo-shared-compose app (loopback-only)│
                        │ postgres  (private network, no ports)  │
                        └───────────────────────────────────────┘

  pilot-db (external, internal=true)
  ┌─────────────────────────────────────────────────────────────┐
  │  pilot-connector  ── TCP ──►  database host:5432             │
  │        │                                                     │
  │        └── pilot-egress (internal=true, 172.16.29.0/24)      │
  │                 │  extra_hosts pins each admitted name       │
  │                 ▼  to the gateway's static 172.16.29.10      │
  │            egress-gateway                                    │
  └─────────────────┼───────────────────────────────────────────┘
                    │ pilot-uplink (internal=false) — gateway is the only member
                    ▼
              internet, TLS passthrough, SNI allowlist
```

The connector resolves an admitted provider name to the gateway because compose
pins that name in `/etc/hosts`. The TLS ClientHello still carries the real
provider SNI, so the gateway can decide on the name while the connector keeps
end-to-end certificate validation. TLS is never intercepted: the gateway holds
no certificate, key or session material and splices opaque bytes.

## 3. Enforcement layers

| Layer | Enforced by | What it proves | What it does not |
| --- | --- | --- | --- |
| Network topology | Linux network namespaces and Docker's iptables rules | The connector has no route to the internet and no external DNS, whatever the process does | Does not restrict traffic between containers on the same network |
| Egress gateway | A separate distroless process with an exact name allowlist | Only reviewed provider names are reachable, and every decision is logged | Does not protect against a compromised Docker daemon |
| Connector guard | A preloaded Node module | Fails closed earlier, on misconfiguration and on direct-IP or UDP attempts | Process-local: a marker can be forged and `--require` can be omitted |
| LAN exposure | Bind scope plus `internal=true` | Pilot resources are not bound to any LAN interface | Does not prove the host firewall blocks unrelated services |

The guard is explicitly **not** the boundary. That is why the container-level
test removes it before probing: everything it asserts still holds with the guard
absent.

## 4. Bypass matrix

Every row below was exercised unless it is explicitly labelled *reasoned*.
"Kernel-only" means the probe ran with `NODE_OPTIONS` cleared and a plain
entrypoint, so the guard was provably not loaded. The redirect row is the only
one reasoned rather than run; it is reasoned from the SDK and the gateway's
resolve-from-SNI design.

| Attempt | Stopped by | Observed result |
| --- | --- | --- |
| Direct TCP to a public IP | no default route | kernel-only: not connected |
| Direct TCP to a provider name | no resolver, then guard | kernel-only: name unresolved; guarded: `PILOT_EGRESS_DENIED` |
| IPv6 egress | no usable IPv6 default, no global address | kernel-only: only the kernel's reject default exists |
| UDP to a public address | no default route, then guard | kernel-only: not accepted; guarded: `PILOT_EGRESS_DENIED` |
| Alternate port | gateway listens on 443 only; guard pins port 443 | unit tests: wrong port denied before DNS |
| Non-allowlisted SNI to the gateway | exact allowlist | gateway logs `sni_deny host-not-allowlisted` with the name |
| Allowlisted SNI the gateway cannot resolve | resolve-then-validate, fail closed | gateway logs `sni_deny unresolvable`; no tunnel opened |
| Plaintext HTTP to the gateway | TLS ClientHello parser | non-TLS bytes refused |
| Oversized or malformed ClientHello | one-record bound, strict parse | refused with no unbounded buffering |
| High-bit bytes in the server name | ASCII-only SNI decode | unit test rejects `malformed-server-name` |
| Use the gateway as a router | `ip_forward=0`, no `NET_ADMIN` in the connector | gateway reads `0`; the connector cannot add a route |
| Provider redirect to a new host | no route/resolver, then gateway allowlist | *reasoned, not exercised*: fails closed because the new name is not pinned; the name is logged, not followed |
| Resolver smuggling a second address | guard requires every answer to equal the pin | unit test denies a mixed answer set |
| Connector attached to a non-internal network | preflight refuses the named network; the image refuses a namespace with a default route | unit test on route parsing; container test on a non-internal fixture aborts with `PILOT_EGRESS_DENIED` |
| Reaching host services through the bridge gateway | no published pilot port; host listeners bound elsewhere | container probe to the bridge address on 2026/5432/8080: not connected *on this Docker Desktop host*. A native-Linux host service bound to `0.0.0.0` would be reachable; see residual 8 |
| Removing the guard | kernel topology remains | kernel-only probe denies without the guard |
| Reaching the app or database from the LAN | loopback-only publish, `internal=true` | LAN check: app not reachable at the LAN address; database unreachable from another bridge |

## 5. Verification results

All commands are offline. No provider, DNS or internet destination is contacted;
the only destinations are reserved `.test` names, private addresses and public IP
literals dialled from a network that has no route to them.

| Verification | Command | Result |
| --- | --- | --- |
| Rendered topology agrees with the reviewed allowlist | `ops/local/check-pilot-network.sh` | 15 assertion groups PASS |
| Guard and gateway unit behaviour | `node --import tsx --test tests/backend/egress-gateway.test.ts tests/backend/pilot-egress-guard.test.ts` | 39/39 PASS |
| Real TLS admitted through the gateway in a loopback-only namespace, and the guard pin | `ops/local/verify-egress-allowpath.sh` | 21/21 PASS |
| Kernel boundary and gateway decisions on real containers | `ops/local/verify-pilot-network.sh` | 25/25 PASS |
| LAN exposure of the running stack | `ops/local/check-lan-exposure.sh` | 10/10 PASS |
| Full local suite with the disposable test database | `npm test` | 327/327 PASS on Node v24.19.0 |

The container and LAN results were re-run after the implementation was
committed at `2dff06e063b87d6abf5e25e4a1ca9c369ba7236e`, against
`zalo-shared-connector:g5-local` (`sha256:9bced3eb…c8427998`, whose embedded
build identity records that commit) and
`zalo-shared-egress-gateway:g5-local` (`sha256:bfde5c7a…85ad4e75`).

The allow-path harness runs inside an unprivileged user+mount+network namespace
that contains only loopback. It proves the positive case end to end: a real TLS
handshake is spliced to a synthetic provider, the peer certificate fingerprint
matches the one generated for the run, and the provider answers. The container
verifier cannot prove the positive case because the gateway requires a public
upstream address, and spoofing one on a Docker network would modify host routing;
that is why the two scripts are separate.

The harness stages the code it executes — `ops/egress-gateway.cjs`,
`ops/egress-address-policy.cjs`, `ops/pilot-egress-guard.cjs`, both harness
scripts and the installed `ipaddr.js` — into its fixture directory before it
enters the namespaces, prints a sha256 manifest of the staged files and refuses
to run if any digest differs. This is required, not cosmetic: inside an
unprivileged user namespace one uid is mapped, so a checkout under another
account's home is not traversable there. The hosted `pilot` job reaches the
script through `sudo`, and the first hosted attempt of this step failed for
exactly that reason (run `41649094828`, `Cannot find module
.../ops/local/harness/provider.cjs`). The staged harness was then re-verified
locally through the same `sudo -E` invocation: 21/21 PASS, with the manifest
`ipaddr.js 546ee2e65468439b8b2ea39bb3ac2ebf52ee7858367040401f876d0037aff205`.

## 6. Residual risks

1. **The guard's activation marker is process-local and forgeable.** It is a
   diagnostic signal, not an enforcement control. The boundary does not rely on
   it; the kernel-only probe demonstrates that.
2. **Images are local and unsigned.** `zalo-shared-connector` and the gateway are
   built locally; a digest from `docker image inspect` is not a registry digest
   or a signed attestation. CI does not push images. Deployment must pin digests
   from a trusted builder.
3. **Docker daemon trust.** Any process that can talk to the Docker socket can
   attach a container to the uplink network. This design does not raise the
   privilege of the daemon; it reduces what the workload can do without it.
4. **Host-level exposure is outside this boundary.** In mirrored WSL networking
   the host shares interfaces with WSL, and unrelated workloads publish
   `0.0.0.0` ports on this machine. The pilot resources do not, but their
   presence means the host as a whole is not isolated. It is not in scope and
   was not changed.
5. **LAN isolation is proven by bind scope, not by an independent device.** A
   packet addressed to the LAN IP cannot reach a `127.0.0.1`-bound socket or an
   `internal=true` network. Only a second physical device can additionally
   exercise the Windows firewall and the mirrored-interface path; that test has
   not been run.
6. **The connector shares the application's private network.** `pilot-db` is
   the app's `private` network, which holds the app and PostgreSQL. A
   compromised connector can therefore open TCP to the app's HTTP port. That is
   lateral reachability, not internet egress: the app is not a router, the
   connector has no default route, and the app's only outbound client is the
   media downloader, whose approved-host set is empty in the pilot
   (`server/media-worker.ts` stops the job with `policy` before any request).
   A DB-only network for the connector would remove the app from its peer set,
   but it would require changing the application stack's network membership and
   was not done. The app's existing authentication boundary still applies.
7. **The application keeps its own non-internal `edge` network** so Docker can
   publish `127.0.0.1:3100`. The app therefore has an internet route even
   though it has no general outbound client. This is outside the connector
   boundary and unchanged.
8. **Host services on the bridge gateway are reachable on native Linux.** The
   container probe to the Docker bridge address (`172.16.29.1`) on ports
   2026/5432/8080 did not connect under Docker Desktop, but the host bridge
   address is local to the host. On a native Linux deployment, a host service
   listening on `0.0.0.0` or on the bridge interface would be reachable from
   the connector's internal network. That is not internet egress and it is not a
   provider path, but it is lateral reachability that the topology alone does
   not remove. It is not exercised here because this host runs Docker Desktop,
   and it requires an Owner decision (Section 7) before a native-Linux
   deployment.

## 7. Owner action required

Nothing in this design needs a host-wide change for this host. The remaining
Owner decisions are:

1. Whether observe/send-test may ever run, given that their runtime-only hosts
   must first be observed and admitted (Section 6 of
   [G5A-PROVIDER-ENDPOINT-POLICY.md](G5A-PROVIDER-ENDPOINT-POLICY.md)).
2. Whether to run one LAN probe from a second physical device, or to accept
   bind-scope evidence and an explicit note that the host firewall is
   `NotConfigured`.
3. Whether to publish images to a trusted registry so a deployed digest can be
   verified externally.
4. If this ever deploys on native Linux: whether to add host-side
   `DOCKER-USER` rules so host services listening on `0.0.0.0` cannot be
   reached through the bridge gateway (residual 8). Not required on this host;
   not authorized as a host-wide change.

None of these is a blocker for a bootstrap-only, loopback-only pilot under a new
authorization.

## 8. Invariants observed

During the enforcement work recorded here: no live login, QR enrollment,
listener, send, provider DNS lookup or provider connection. This section covers
only the boundary implementation and its tests. It does **not** claim that no
provider contact occurred earlier in the G5-A session: one unauthorised
diagnostic probe is disclosed in
[G5A-BOUNDARY-PROBE-INCIDENT.md](G5A-BOUNDARY-PROBE-INCIDENT.md) and is not
covered by this statement. No host-wide firewall, routing or network
configuration was changed. Every container, network and image created for
verification is either the existing project's or was removed; the verification
scripts create uniquely named resources and clean them up on exit.
