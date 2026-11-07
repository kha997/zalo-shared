# G5-A R5 — independent security reassessment

**Date:** 2026-11-03
**Gate:** `R5_PASS_WITH_FINDINGS`
**Reviewed artifact:** `8d40c0f934aef10f8470cf7cc5bcd7402710f6bd`
**Image:** `zalo-shared-connector:g5-8d40c0f9`, digest
`sha256:2dec14e3d732b6f4a2686bb3220fe9f3e39678997d054a9cf51a5e5758ffd2a1`
**Live Zalo action:** none
**Host/network changes:** none

## 1. Verdict

`R5_PASS_WITH_FINDINGS`. Three independent review passes were performed. Every
P1 and P2 raised against an earlier remediation artifact is closed and verified
against the final image under `--network none`. The remaining findings are
documented P3 residuals that do not change the gate verdicts: R2 stays
`R2_BLOCKED` on the offline-unprovable live endpoint inventory, R3 stays
`R3_UNPROVEN`, and the final result is `G5A_REMEDIATION_BLOCKED`.

No unresolved P1 or mandatory condition remains in the connector egress
mechanism. The gate is still blocked because the live provider destination set
and LAN isolation cannot be proven offline, not because of an open code defect.

## 2. Review passes

### 2.1 First pass — pre-remediation artifact `6d199162`

Findings: `NODE_OPTIONS` cleared through an env file removed the guard; an HTTP
request `options.path` was falsely treated as a Unix socket; preflight validated
only manifest shape; a compose comment contradicted the remote-database rule.
Closures: entrypoint `--require` preload plus an activation marker and CLI
refusal; path handling distinguishes a bare Unix path from an HTTP path;
preflight verifies the build identity before scope; the compose comment matches
`parseDatabase`.

### 2.2 Second pass — artifact `6f28836`

Findings: `ChildProcess.prototype.spawn` escaped the module-level child-process
denial; `process.binding("tcp_wrap")` reached a raw socket; `::7f00:1` was
classified as public; the invalid-manifest harness accepted any non-zero exit.
Closures: prototype spawn/spawnSync denied; an initial binding blocklist added;
`::/96` added to the denied CIDRs; the helper now requires both a non-zero exit
and a `"gate":"denied"` payload.

### 2.3 Third pass — artifact `6f28836`

Findings: the binding blocklist checked `typeof name === "string"`, so
`process.binding(new String("tcp_wrap"))` reached the native binding;
`process.binding("spawn_sync")` spawned an unguarded child because
`envPairs: []` dropped `NODE_OPTIONS`; `process_wrap`, `stream_wrap` and
`cares_wrap` were reachable.
Closures: all public raw-binding paths (`process.binding`,
`process._linkedBinding`, `process.dlopen`) now throw `PILOT_EGRESS_DENIED`
unconditionally, with no captured original to restore. The reviewed dependency
tree does not call them.

### 2.4 Final pass — artifact `8d40c0f9`

Result: `R5_PASS_WITH_FINDINGS`.

- P1-1 (String-object binding) — **closed**. `process.binding`,
  `process._linkedBinding` and `process.dlopen` are replaced by a throwing
  stub; `delete`/`defineProperty` cannot restore a reference; `binding.call`
  and `binding.apply` are denied; `node:internal/...` is not loadable.
- P1-2 (raw `spawn_sync`) — **closed**. `spawn_sync` through `process.binding`
  and `_linkedBinding`, `dlopen`, all `child_process` helpers and
  `ChildProcess.prototype.spawn` are denied, including with `NODE_OPTIONS`
  cleared.
- New P3 — `net._createServerHandle` and `dgram._createSocketHandle` returned
  native handles, although outbound use aborted without the unexported
  `ConnectWrap`/`SendWrap`. **Closed** in `8d40c0f` by removing both factories
  and adding a test assertion.
- New P3 — two docs did not yet name the final artifact, and the R5 document
  did not exist. **Closed** by this update.
- Marker caveat — the activation marker is a forgeable `Symbol.for` value, so
  it protects against operator misconfiguration, not against code that runs
  before the preload. Documented in
  [G5A-R2-EGRESS-BOUNDARY.md](G5A-R2-EGRESS-BOUNDARY.md); the residual is the
  reason R2 requires a network-level boundary rather than this mechanism alone.

## 3. Final artifact verification

All probes used the default image entrypoint, `--network none`, UID 65532.

| Probe | Result |
| --- | --- |
| `process.binding("tcp_wrap")` and String-object form | denied |
| `process.binding("spawn_sync" / "process_wrap" / "stream_wrap" / "cares_wrap")` | denied |
| `process._linkedBinding("spawn_sync")`, `process.dlopen` | denied |
| `net._createServerHandle`, `dgram._createSocketHandle` | denied |
| `ChildProcess.prototype.spawn`, module helpers, Worker | denied |
| Direct-IP TCP, `tls.connect`, UDP, `dgram.Socket` | denied |
| `dns.*`, `dns/promises`, `dns.Resolver`, `lookupService`, `reverse` | denied |
| Bare Unix socket path, inherited `fd` | denied |
| `http`, `fetch`, `http2` to non-allowlisted destinations | denied |
| Proxy environment variables and `--use-env-proxy` | fail closed at startup |
| `::7f00:1` address classification | non-public |
| HTTP to the exact `DATABASE_URL` loopback host/port | admitted (`200 OK`) |
| Same host, other port, `localhost` alias, provider target | denied |
| Guard marker with `NODE_OPTIONS` cleared | active |
| Entrypoint override with the preload removed | CLI refused, `{"ok":false,"gate":"denied"}` |
| Synthetic bootstrap/observe/send-test preflight | admitted |
| Expired, wrong-commit, extra-field, missing-build, malformed, placeholder | denied |
| Guard suite on the final artifact | 16/16 PASS |
| Runtime dependencies `ipaddr.js`, `pg`, `zca-js` imported under the guard | loaded |

The image's `/app/build-identity.json` matches `8d40c0f`, the connector lock
hash and the locked SDK integrity. The guard file in the image matches the
reviewed commit.

## 4. Test-stability finding

The intermittent `private-pilot-flow.test.ts` failure (`processing` where
`unknown` was expected) was reproduced deliberately: while a second process
held advisory lock `73001` on the same test database, `runWorkerOnce` correctly
declined ownership and returned `processed:false` before quarantine. `npm test`
runs one process with `--test-concurrency=1`. Concurrent suite runs against the
same database are unsupported; this is a harness constraint, not a product
defect.

## 5. Residual findings

- **Marker forgeability (P3).** Documented. The guard is process-local and
  cannot stop code that runs before the preload; a network-level boundary is
  still required for production. This is one reason R2 remains blocked.
- **Local image identity (limitation).** The digest is a local image digest,
  not a registry digest or signed attestation. CI does not push an image.
- **R2 live endpoint inventory.** The later bootstrap destinations, redirects
  and dynamic service-map hosts cannot be proven offline, and live discovery is
  prohibited. R2 stays `R2_BLOCKED`.
- **R3 LAN isolation.** No independent LAN device was available and the Windows
  firewall defaults are not an explicit deny. R3 stays `R3_UNPROVEN`.

## 6. Evidence boundary

This record contains no credential, cookie, key, session, QR, real account
identifier or raw connection string. All checks were offline. This is not live
provider evidence.
