# G5-A R2 — connector egress boundary

**Date:** 2026-11-03
**Gate:** `R2_EGRESS_ENFORCEMENT_PASS` (see §7)
**Mechanism status:** implemented and verified offline
**Live Zalo action:** none from this boundary work. (An unauthorised diagnostic
probe during the same directive contacted `id.zalo.me` and
`wss://jr.chat.zalo.me/ws`; it is disclosed in
[G5A-BOUNDARY-PROBE-INCIDENT.md](G5A-BOUNDARY-PROBE-INCIDENT.md) and is not
evidence for this gate.)
**Host/network changes:** none

## 1. Verdict

A connector-local default-deny egress control is implemented, tested and built
into the connector image. It admits only exact reviewed provider hostnames/ports
and the private `DATABASE_URL` host/port; every other TCP destination, DNS
resolve, UDP socket, child process and worker is denied before use.

The gate is nevertheless **`R2_BLOCKED`** because a complete, offline-provable
endpoint inventory for the live bootstrap cannot be established, and no
network-level boundary is in place. The live gate must remain blocked until a
narrowly reviewed solution exists.

*Updated 2026-11-03:* both reasons are resolved in §7. The boundary no longer
depends on a complete inventory, because unknown destinations now fail closed at
the kernel and at a separate gateway. The gate is PASS for bootstrap, with the
observe/send-test limitation stated there.

## 2. Mechanism

`ops/pilot-egress-guard.cjs` is preloaded by the connector image through both
`NODE_OPTIONS=--require=/app/egress-guard.cjs` and the image entrypoint
`/nodejs/bin/node --require=/app/egress-guard.cjs`, before any application
module. The entrypoint repeats the preload so an `env_file` or compose override
of `NODE_OPTIONS` cannot silently remove the guard.

| Control | Behaviour |
| --- | --- |
| Provider allowlist | `PILOT_EGRESS_HOSTS` is a comma-separated list of exact DNS names. Wildcards, IP literals, trailing dots and empty names are rejected. Empty/absent means provider egress is denied entirely. |
| Provider ports | `PILOT_EGRESS_PORTS` defaults to 443; only exact listed ports are admitted. |
| Database destination | Parsed from `DATABASE_URL`; only that exact host and port are admitted. Query overrides for host, port, user, password or TLS are rejected. |
| Address validation | Provider targets must resolve to public unicast addresses outside reserved/private/loopback/link-local/documentation/IPv4-compatible ranges, so a DNS answer cannot redirect to an internal address. Database targets must be private, loopback or unique-local. |
| DNS | `dns.lookup` and `dns.promises.lookup` are pinned to the validated address; `dns.resolve*`, `lookupService`, `reverse`, `dns/promises` and `dns.Resolver` instances are denied. |
| Other egress | UDP sockets and `dgram.Socket`, module-level and prototype `child_process` spawns, all public raw binding paths (`process.binding`, `process._linkedBinding`, `process.dlopen`), the exported `net._createServerHandle`/`dgram._createSocketHandle` factories and `worker_threads` are denied. Blocking the whole binding surface closes String-object names and sibling bindings such as `spawn_sync`, `process_wrap`, `stream_wrap` and `cares_wrap`. |
| Socket options | A bare Unix-socket `path` is denied. An HTTP request `path` is dropped while the TCP target is still checked, so `http`/`https` requests reach only an allowlisted host/port. Inherited `fd`/`handle` and caller-supplied lookups cannot redirect a connection. |
| Proxy paths | Proxy environment variables, `NODE_OPTIONS=--use-env-proxy` and `NODE_TLS_REJECT_UNAUTHORIZED=0` fail closed at startup. |
| Preload integrity | The image entrypoint carries `--require=/app/egress-guard.cjs`, so clearing or overriding `NODE_OPTIONS` through an env file does not remove the guard. |
| Activation marker | The guard sets a non-enumerable process marker; `preflight` and live commands refuse when the image contains the guard file but the marker is absent. |
| TLS | `tls.connect` paths that bypass the socket policy are denied. |

The guard is process-local. It is a strong default-deny control in a distroless
image that contains only Node and the connector, but it is not a substitute for
a network-level egress gateway. Defense in depth still requires network
enforcement for a production boundary. The activation marker defeats operator
misconfiguration (for example, an entrypoint or `NODE_OPTIONS` override); it
does not defeat code that executes before the preload, because any module can
forge a `Symbol.for` marker. Code running inside the connector process before
the guard is outside this control's scope, which is why R2 remains blocked on a
network-level boundary rather than on this mechanism alone. The pinned
dependency tree does not call `process.binding`, `process._linkedBinding` or
`process.dlopen`, so denying the whole binding surface does not affect normal
operation.

## 3. Offline verification

Focused test file `tests/backend/pilot-egress-guard.test.ts`: **23/23 PASS**.
`tests/backend/egress-gateway.test.ts`: **16/16 PASS**. The in-image checks below
were re-run against an image built from working-tree commit
`f71ae069b40b0f560aaaebdbb5e612f191197f83` (`zalo-shared-connector:g5-local`);
the earlier artifact was `8d40c0f934aef10f8470cf7cc5bcd7402710f6bd`
(`g5-8d40c0f9`).

| Test | Result |
| --- | --- |
| Exact allowlisted provider host and port admitted | PASS |
| Empty allowlist denies direct IP before connect | PASS |
| Alternate ports and unknown hosts denied before DNS | PASS |
| Public IP literal not admitted as a provider host | PASS |
| IPv6 loopback denied | PASS |
| Provider hostname resolving to loopback denied | PASS |
| UDP, DNS resolve, child processes and raw bindings denied | PASS |
| Internal database reachable on exact host and port | PASS |
| Database connection to any other port denied | PASS |
| `DATABASE_URL` query overrides cannot redirect the connection | PASS |
| HTTP to the exact allowed host/port admitted | PASS |
| A bare Unix socket path is denied | PASS |
| Proxy environment variables fail closed at startup | PASS |
| `NODE_OPTIONS=--use-env-proxy` cannot re-enable proxy handling | PASS |
| `dns.Resolver` instances and `fd`-based sockets cannot bypass | PASS |
| Wildcard provider hosts rejected | PASS |

Additional in-image checks during remediation observed the same fail-closed
behaviour: direct-IP, UDP, child-process, DNS-resolve, wildcard and proxy cases
were denied; `ChildProcess.prototype.spawn`, `process.binding(new
String("tcp_wrap"))`, `process.binding("spawn_sync")`, `process._linkedBinding`,
`process.dlopen` and the exported `net`/`dgram` handle factories were denied;
the configured internal database host/port
was reachable; a wrong database port, a loopback DNS answer and an IPv6 target
were denied. The checks were repeated with `NODE_OPTIONS` cleared: the
entrypoint preload kept the direct-IP, UDP, DNS, child, raw-binding, `fd`,
`Resolver` and proxy controls active, so an env-file override does not remove
the guard. An entrypoint override that removed the preload was refused by the
CLI because the guard marker was absent.

The connector image also preloads the guard before `dry-run` and `preflight`;
with no allowlist configured, preflight still runs because it opens no socket,
while any attempted provider connection would be denied.

## 4. Offline endpoint inventory and the blocker

The pinned `zca-js@2.2.0` code was inspected without live traffic.

Bootstrap path (`loginQR` -> `loginCookie`):

- `https://id.zalo.me/account/...` — QR generate, waiting-scan, waiting-confirm,
  login-info, verify-client and session checks.
- `https://wpa.chat.zalo.me/api/login/getLoginInfo` and
  `.../getServerInfo` — credential exchange and server settings.
- `https://jr.chat.zalo.me/jr/userinfo` — account identity.
- `https://chat.zalo.me/...` and `https://zalo.me/...` appear as Referer,
  cookie-domain or `continue` values in the login code, not as requests observed
  in the bootstrap path.
- `registry.npmjs.org` is used only by the SDK update check, which the connector
  disables with `checkUpdate: false`.
- `catalog.zalo.me` and `developers.zalo.me` are not on the bootstrap path.

The login response also contains `zpw_service_map_v3` and `zpw_ws`, which the
SDK uses to build service URLs and the WebSocket URL for later stages. Their
values are server-provided and were not observed. The SDK's `request()` helper
also follows HTTP `Location` redirects to whatever host the provider returns.

Therefore the exact live bootstrap destination set cannot be proven offline:
redirect targets and later-stage service hosts are unknown, and live provider
traffic for endpoint discovery is prohibited by this directive. The guard is
fail-closed, so an unknown destination aborts the bootstrap rather than leaking
traffic, but availability of a real bootstrap under the guard is unproven.

## 5. Alternatives for a narrowly reviewed solution

1. **Authorized endpoint-observation stage.** Separately authorize one
   time-bounded bootstrap whose only purpose is to record the exact hostnames and
   ports contacted (network-level logging, no message content). Feed the exact
   inventory into `PILOT_EGRESS_HOSTS`, then re-run the security review.
2. **Approved network-level egress gateway.** Owner-approved host or network
   policy that allows only the reviewed provider destinations for the connector
   container, with DNS pinned and all other egress denied. This is a host/network
   change and is not authorized here.
3. **Narrow first-party bootstrap allowlist under a new authorization.** If the
   Owner accepts a bootstrap-only allowlist of `id.zalo.me`,
   `wpa.chat.zalo.me` and `jr.chat.zalo.me`, the guard can enforce it unchanged,
   and any redirect to an unlisted host will abort safely. This still does not
   cover observe/send-test service hosts, which require a later inventory.

None of these options is executed by this remediation.

## 6. Evidence boundary

This record contains no credential, cookie, key, session, QR, real account
identifier or raw connection string. It is offline source and test evidence, not
live provider evidence.

## 7. Resolution — OS-enforced boundary plus admission gateway (2026-11-03)

Option 2 of §5 was implemented without a host-wide change: the egress boundary is
a Docker network topology plus a dedicated allowlist gateway inside the pilot
compose stack. Nothing on the host was reconfigured.

- The connector is attached only to `pilot-db` and `pilot-egress`, both
  `internal=true`. It has no default route and no external resolver, so an
  unknown destination fails at the kernel before any application code runs.
  Because `pilot-db` is operator-supplied and therefore cannot be declared
  internal in the compose file, the precondition is independently checked twice:
  `ops/local/preflight-connector.sh` inspects the named network and refuses
  unless Docker reports `Internal=true`, and the connector image refuses to
  start when its own namespace has a usable IPv4 or IPv6 default route
  (`PILOT_REQUIRE_INTERNAL_NETWORK=1`). The container verifier runs that refusal
  against a deliberately non-internal fixture and watches the image exit with
  `PILOT_EGRESS_DENIED`.
- The only container with an uplink is `egress-gateway`. It admits an exact
  allowlisted TLS SNI on port 443, resolves the name itself, validates that every
  answer is public unicast, and splices opaque bytes. TLS is not intercepted.
- Every decision is a JSON audit line. A denied SNI is recorded by name, which
  makes the gateway the discovery instrument for a future authorized observation
  window: an unknown host is refused, never reached, and named.
- The connector guard remains as defense in depth, now with a
  `PILOT_EGRESS_GATEWAY` pin: a provider name must resolve to the gateway's
  address and to no other answer.

The endpoint inventory is complete for bootstrap and explicitly incomplete for
later stages; see [G5A-PROVIDER-ENDPOINT-POLICY.md](G5A-PROVIDER-ENDPOINT-POLICY.md).
The three admitted names cover QR enrollment, stored-credential login and the
exact-UID check. The service-map, WebSocket and redirect destinations are
provider-selected at runtime and cannot be known offline; they are now denied
rather than depended upon.

Verification, all offline and re-run against the current working tree:
`ops/local/check-pilot-network.sh` (15 assertion groups; rendered topology
matches the reviewed allowlist), `ops/local/verify-egress-allowpath.sh` (21/21,
real TLS spliced to a synthetic provider inside a loopback-only namespace, plus
the guard pin), `ops/local/verify-pilot-network.sh` (25/25 on real containers,
including a probe that runs with the guard provably absent and still cannot
reach the internet, and the default-route refusal), and 39/39 guard and gateway
unit tests.

Consequence for the pilot: bootstrap can proceed under a new authorization.
Observe and send-test cannot run until their runtime-only hosts are observed and
admitted. That is the intended fail-closed behaviour and the only remaining R2
item for an Owner decision, recorded in §7 of the provider endpoint policy.

Verdict: **`R2_EGRESS_ENFORCEMENT_PASS`** for bootstrap and for the enforcement
boundary; observe/send-test remain functionally blocked pending admission.
