# G5-A R2 — connector egress boundary

**Date:** 2026-11-03
**Gate:** `R2_BLOCKED`
**Mechanism status:** implemented and verified offline
**Live Zalo action:** none
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
| Address validation | Provider targets must resolve to public unicast addresses outside reserved/private/loopback/link-local/documentation ranges, so a DNS answer cannot redirect to an internal address. Database targets must be private, loopback or unique-local. |
| DNS | `dns.lookup` and `dns.promises.lookup` are pinned to the validated address; `dns.resolve*`, `lookupService`, `reverse`, `dns/promises` and `dns.Resolver` instances are denied. |
| Other egress | UDP sockets and `dgram.Socket`, `child_process` methods and `worker_threads` are denied. |
| Socket options | A bare Unix-socket `path` is denied. An HTTP request `path` is dropped while the TCP target is still checked, so `http`/`https` requests reach only an allowlisted host/port. Inherited `fd`/`handle` and caller-supplied lookups cannot redirect a connection. |
| Proxy paths | Proxy environment variables, `NODE_OPTIONS=--use-env-proxy` and `NODE_TLS_REJECT_UNAUTHORIZED=0` fail closed at startup. |
| Preload integrity | The image entrypoint carries `--require=/app/egress-guard.cjs`, so clearing or overriding `NODE_OPTIONS` through an env file does not remove the guard. |
| Activation marker | The guard sets a non-enumerable process marker; `preflight` and live commands refuse when the image contains the guard file but the marker is absent. |
| TLS | `tls.connect` paths that bypass the socket policy are denied. |

The guard is process-local. It is a strong default-deny control in a distroless
image that contains only Node and the connector, but it is not a substitute for
a network-level egress gateway. Defense in depth still requires network
enforcement for a production boundary. Arbitrary in-process code can reach
native bindings (`process.binding`) or native constructors through a prototype
chain; the pinned SDK does not use those paths, and stopping hostile code
inside the process is outside this control's scope.

## 3. Offline verification

Focused test file `tests/backend/pilot-egress-guard.test.ts`: **16/16 PASS**.

| Test | Result |
| --- | --- |
| Exact allowlisted provider host and port admitted | PASS |
| Empty allowlist denies direct IP before connect | PASS |
| Alternate ports and unknown hosts denied before DNS | PASS |
| Public IP literal not admitted as a provider host | PASS |
| IPv6 loopback denied | PASS |
| Provider hostname resolving to loopback denied | PASS |
| UDP, DNS resolve and child processes denied | PASS |
| Internal database reachable on exact host and port | PASS |
| Database connection to any other port denied | PASS |
| `DATABASE_URL` query overrides cannot redirect the connection | PASS |
| HTTP to the exact allowed host/port admitted, bare Unix path denied | PASS |
| Proxy environment variables fail closed at startup | PASS |
| `NODE_OPTIONS=--use-env-proxy` cannot re-enable proxy handling | PASS |
| `dns.Resolver` instances and `fd`-based sockets cannot bypass | PASS |
| Wildcard provider hosts rejected | PASS |

Additional in-image checks during remediation observed the same fail-closed
behaviour: direct-IP, UDP, child-process, DNS-resolve, wildcard and proxy cases
were denied; the configured internal database host/port was reachable; a wrong
database port, a loopback DNS answer and an IPv6 target were denied. The checks
were repeated with `NODE_OPTIONS` cleared: the entrypoint preload kept the
direct-IP, UDP, DNS, child, `fd`, `Resolver` and proxy controls active, so an
env-file override does not remove the guard.

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
