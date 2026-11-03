# G5-A remediation report

**Date:** 2026-11-03
**Directive:** G5-A remediation and reactivation readiness
**Final verdict:** `G5A_REMEDIATION_BLOCKED`
**Live Zalo action:** none
**New activation window:** none chosen

## 1. Scope

This remediation followed `G5A_BLOCKED` at commit `0fd81ec`. The previous
authorization window `2026-11-03T02:00:00Z`–`02:30:00Z` is invalid and was not
reused. No Zalo login, QR enrollment, SDK authentication, `run-observe`,
`run-send-test`, provider traffic or production deployment was performed.

## 2. Gate summary

| Gate | Result | Evidence |
| --- | --- | --- |
| R1 credential containment | `R1_CREDENTIAL_CONTAINMENT_PASS` | [G5A-CREDENTIAL-INCIDENT.md](G5A-CREDENTIAL-INCIDENT.md) |
| R2 egress boundary | `R2_BLOCKED` | [G5A-R2-EGRESS-BOUNDARY.md](G5A-R2-EGRESS-BOUNDARY.md) |
| R3 LAN isolation | `R3_UNPROVEN` | [G5A-R3-LAN-ISOLATION.md](G5A-R3-LAN-ISOLATION.md) |
| R4 manifest and preflight | `R4_MANIFEST_PREFLIGHT_PASS` | [G5A-R4-MANIFEST-PREFLIGHT.md](G5A-R4-MANIFEST-PREFLIGHT.md) |
| R5 independent review | `R5_REVIEW_COMPLETE_WITH_FINDINGS` | [G5A-R5-INDEPENDENT-REVIEW.md](G5A-R5-INDEPENDENT-REVIEW.md) |

## 3. What changed

- Connector-local default-deny egress guard (`ops/pilot-egress-guard.cjs`),
  preloaded by both the image entrypoint and `NODE_OPTIONS`, with exact provider
  host/port and database host/port admission, address validation, DNS pinning
  and denial of UDP, `dns.resolve*`, `dns.Resolver`, child processes, workers,
  proxy environment paths, `fd`-based sockets and every public raw binding path
  (`process.binding`, `process._linkedBinding`, `process.dlopen`). Closing the
  whole binding surface followed an independent finding that a blocklist could
  be bypassed with a String object or the `spawn_sync`/`process_wrap`/
  `stream_wrap`/`cares_wrap` siblings.
- Preflight now verifies the manifest build block against the running image
  identity before scope validation; live commands repeat the check.
- A names-only private-env inspection helper and test prevent future diagnostic
  value disclosure.
- Operations docs and the private enrollment template were updated.

Commits: `66af5ef` (guard, preflight hardening, R1–R4 evidence), `2963e1a`
(entrypoint preload enforcement), `e6fbad1` (R4 evidence rebound), `244ef7f`
(unguarded-preflight refusal and HTTP path handling), `6f28836`
(direct-spawn denial), `3d5adcb` (whole-surface binding denial), `fdb0704`
(evidence alignment).

## 4. Final artifact

| Item | Value |
| --- | --- |
| Connector source commit | `fdb0704ba9384c4fad45df0c9910fa369b059efa` |
| Image | `zalo-shared-connector:g5-fdb0704b` |
| Local image digest | `sha256:2cc1af75d3ac5d8fbaca79d8af8c37db1053ef9507375af13a8ebd2f359d0966` |
| Embedded `lockSha256` | `17dcd25426639f7112b80764bc8aa27f9be2af3acf0aaf0f2cd490c434030c9b` |
| Embedded `sdkIntegrity` | `sha512-pBU0T0/uadH3Neq7yMssUmE769VVuqKhL8YD1HqQQG8e6lkwueAopNu0vhJdqiJRHZdPIEomT2FxRzauOx4pgA==` |
| Runtime UID / Node | `65532` / `v24.22.1` |
| Exposed ports | none |

Full local suite: **304/304 PASS** on Node `v24.19.0`; typecheck and connector
build PASS; guard suite 16/16 PASS. In-image preflight admitted the synthetic
bootstrap, observe and send-test manifests and denied expired, out-of-scope,
extra-field, missing-build, wrong-identity, placeholder and stage-mismatch
cases. In-image guard probes denied direct IP, UDP, DNS, child spawn, every raw
binding, bare Unix sockets and proxy paths, while admitting the exact
`DATABASE_URL` host/port over HTTP.

## 5. Blockers

### 5.1 R2 — live endpoint inventory cannot be proven offline

The pinned SDK contacts `id.zalo.me`, `wpa.chat.zalo.me` and `jr.chat.zalo.me`
on the bootstrap path, but the login response carries server-provided
`zpw_service_map_v3` and `zpw_ws` values and the SDK follows redirects to
provider-chosen hosts. Those later destinations were not observed, and live
traffic for endpoint discovery is prohibited by this directive. The guard is
fail-closed, so an unknown destination aborts rather than leaks, but a real
bootstrap under the guard is unproven.

Closure options: an authorized endpoint-observation stage; an Owner-approved
network egress gateway; or a narrow first-party bootstrap-only allowlist under
a new authorization, accepting that observe/send-test hosts still need a later
inventory.

### 5.2 R3 — LAN isolation is unproven

Pilot services are loopback-only or internal-network-only, but no independent
LAN device was available and the Windows firewall defaults are
`NotConfigured`, not an explicit deny. Host-wide firewall changes were not
authorized. Closure requires probes from a separate LAN device, or an
Owner-approved explicit inbound-deny policy.

## 6. Stop state

No activation window is chosen. No live grant remains; only the placeholder
enrollment template and non-admissible negative fixtures are in the private
directory. The connector must not be started against Zalo until the Owner issues
a new instruction containing the new UTC start and expiry and the R2/R3
blockers are resolved.

**Verdict: `G5A_REMEDIATION_BLOCKED`. STOP — no real Zalo authentication. G5-B remains unauthorized.**
