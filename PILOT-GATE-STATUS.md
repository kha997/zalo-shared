# Pilot gate status

**Date:** 2026-11-04
**Branch:** `feat/shared-inbox`; reviewed source commit `2dff06e063b87d6abf5e25e4a1ca9c369ba7236e`; connector source unchanged at the live attempt (`3ceac2b`, `ops/` and evidence only after `2dff06e`); deployment remediation `9d94a26`
**PR #3:** OPEN, **Draft** (not merged, not deployed)
**Owner decision:** `G5_SCOPE_APPROVED_ACTIVATION_PENDING` — D1–D7 approved in scope; live activation withheld
**G5-A authorization:** the `G5A_LIVE_BOOTSTRAP_ONLY` window
`2026-11-04T00:46:00Z`–`01:16:00Z` was entered, one bootstrap was started, and
the authorization is **consumed** (`G5A_BOOTSTRAP_FAIL`). The earlier
`2026-11-03T14:56Z`–`15:26Z` window was blocked before live action and the
`2026-11-03T02:00Z`–`02:30Z` window is invalid; neither is reusable.
**Live pilot:** **NOT ACTIVATED** — one provider contact and one QR emission on
2026-11-04, no completed login, no session, no real account operation, no send
**Deployment remediation:** `G5A_DEPLOYMENT_READY_AWAITING_OWNER_START` was met
before the 2026-11-04 attempt; the deployment remained healthy, the enrollment
itself did not complete

## Gates

| Gate | Status | Evidence |
| --- | --- | --- |
| `G1_ENVIRONMENT_ACCEPTED` | PASS | [G1-ENVIRONMENT-RECONNAISSANCE.md](docs/evidence/G1-ENVIRONMENT-RECONNAISSANCE.md) |
| `G2_INFRASTRUCTURE_READY` | PASS | [G2-PRIVATE-INFRASTRUCTURE.md](docs/evidence/G2-PRIVATE-INFRASTRUCTURE.md) |
| `G3_OFFLINE_VERIFIED` | **PASS (scoped)** | [G3-OFFLINE-ACCEPTANCE.md](docs/evidence/G3-OFFLINE-ACCEPTANCE.md); UNPROVEN: capacity above 100 clients, isolated-server browser case, key escrow, live provider |
| `G4_PILOT_ACTIVATION_PACKAGE` | **SUPERSEDED IN SCOPE** | [G4-PILOT-ACTIVATION-PACKAGE.md](docs/evidence/G4-PILOT-ACTIVATION-PACKAGE.md); D1–D7 accepted in scope by the G5 decision |
| `G5_SCOPE_APPROVED_ACTIVATION_PENDING` | **APPROVED IN SCOPE** | [G5-SCOPE-APPROVAL.md](docs/evidence/G5-SCOPE-APPROVAL.md) |
| `G5A_AWAITING_OWNER_START` | **SUPERSEDED** | Old authorization window invalidated by `G5A_BLOCKED` |
| `G5A_BOOTSTRAP_VERIFIED` | **FAIL (2026-11-04 attempt)** | [G5A-BOOTSTRAP-REPORT.md](docs/evidence/G5A-BOOTSTRAP-REPORT.md) §9; the single authorized bootstrap emitted a QR and contacted only `id.zalo.me`, then exited 1 without a session or UID binding; abort cause UNPROVEN. The 02:00Z and 14:56Z attempts were `G5A_BLOCKED` before live action |
| `R1_CREDENTIAL_CONTAINMENT_PASS` | **PASS** | [G5A-CREDENTIAL-INCIDENT.md](docs/evidence/G5A-CREDENTIAL-INCIDENT.md) |
| `R2_EGRESS_ENFORCEMENT_PASS` | **PASS (bootstrap)** | [G5A-R2-EGRESS-BOUNDARY.md](docs/evidence/G5A-R2-EGRESS-BOUNDARY.md); kernel boundary plus SNI gateway verified; observe/send-test remain functionally blocked until their runtime-only hosts are admitted |
| `R3_LAN_ISOLATION_PASS` | **PASS (pilot resources)** | [G5A-R3-LAN-ISOLATION.md](docs/evidence/G5A-R3-LAN-ISOLATION.md); host-wide isolation remains UNPROVEN (no independent LAN device, firewall defaults not an explicit deny) |
| `R4_MANIFEST_PREFLIGHT_PASS` | **PASS** | [G5A-R4-MANIFEST-PREFLIGHT.md](docs/evidence/G5A-R4-MANIFEST-PREFLIGHT.md); placeholder template only, no live grant |
| `R5_INDEPENDENT_REVIEW_PASS` | **PASS WITH FINDINGS** | [G5A-R5-INDEPENDENT-REVIEW.md](docs/evidence/G5A-R5-INDEPENDENT-REVIEW.md); boundary-specific closure in [G5A-NETWORK-BOUNDARY-REVIEW.md](docs/evidence/G5A-NETWORK-BOUNDARY-REVIEW.md) |
| `G5A_NETWORK_BOUNDARY_VERIFIED` | **PASS** | [G5A-NETWORK-BOUNDARY.md](docs/evidence/G5A-NETWORK-BOUNDARY.md); [review and dispositions](docs/evidence/G5A-NETWORK-BOUNDARY-REVIEW.md) |
| `G5A_REMEDIATED_AWAITING_NEW_OWNER_START` | **SUPERSEDED** | R1–R5 and the network boundary are closed; superseded by the deployment remediation rows below |
| `D1_DATABASE_TLS_VERIFIED` | **PASS** | [G5A-DB-TLS-VERIFICATION.md](docs/evidence/G5A-DB-TLS-VERIFICATION.md); dedicated TLS-only Postgres, `verify-full` admitted, previous no-`sslmode` blocker reproduced and refused |
| `D2_DEPLOYED_NETWORK_BOUNDARY_VERIFIED` | **PASS** | [G5A-DEPLOYED-NETWORK-VERIFICATION.md](docs/evidence/G5A-DEPLOYED-NETWORK-VERIFICATION.md); reviewed topology deployed in place, 48/48 deployed assertions |
| `D3_ENROLLMENT_PREFLIGHT_READY` | **PASS** | [G5A-ENROLLMENT-PREFLIGHT.md](docs/evidence/G5A-ENROLLMENT-PREFLIGHT.md); 46 assertions, 11 denials, inert grant template, no live grant |
| `D4_DEPLOYED_PREFLIGHT_PASS` | **PASS** | [G5A-LOCAL-END-TO-END-DRYRUN.md](docs/evidence/G5A-LOCAL-END-TO-END-DRYRUN.md); all 10 required items, synthetic inputs only |
| `D5_DEPLOYMENT_REVIEW_PASS` | **PASS WITH RESIDUALS** | [G5A-DEPLOYMENT-INDEPENDENT-REVIEW.md](docs/evidence/G5A-DEPLOYMENT-INDEPENDENT-REVIEW.md); High DB-privilege finding closed and re-verified, residuals listed |
| `G5A_DEPLOYMENT_READY_AWAITING_OWNER_START` | **MET** | D1–D5 PASS on the actual host; no G5-A authorization is current and none was used |
| `G5A_REMEDIATION_BLOCKED` | **CLEARED** | Superseded by `G5A_NETWORK_BOUNDARY_VERIFIED`; the earlier state is retained in [G5A-REMEDIATION-REPORT.md](docs/evidence/G5A-REMEDIATION-REPORT.md) |
| `G5B_OBSERVE_VERIFIED` | NOT AUTHORIZED | Requires G5-A PASS and separate Owner authorization; also requires service-map/WebSocket host admission |
| `G5C_SEND_VERIFIED` | NOT AUTHORIZED | Requires G5-B PASS and separate Owner authorization |
| `G5_LIVE_PILOT_VERIFIED` | NOT AUTHORIZED | Requires all stages and a final Owner review |
| `G6_SOAK` | NOT AUTHORIZED | Out of scope |

## Verified identity and offline status

- Reviewed source commit `2dff06e063b87d6abf5e25e4a1ca9c369ba7236e`. The connector image records that commit in its embedded build identity, together with `connector/package-lock.json` (`17dcd254…030c9b`) and SDK integrity `sha512-pBU0T0/…Ox4pgA==`.
- Connector image `zalo-shared-connector:g5-local`, local image digest `sha256:9bced3eba32ae900d427542a03c06275a39acd91e8caa284e433d0ebc8427998`.
- Gateway image `zalo-shared-egress-gateway:g5-local`, local image digest `sha256:bfde5c7a96ca7155473ee305a96b51b05eb3d7ac680c27ba37250fdc85ad4e75`.
- Both images are local and unsigned. A `docker image inspect` digest is not a registry digest or a signed attestation; CI does not push images. This remains a deployment limitation.
- Connector: UID 65532, `cap_drop: ALL`, no exposed ports, `PILOT_REQUIRE_INTERNAL_NETWORK=1`, and no `manifest.json`, `session.key`, `session.enc` or `qr.png` in the image. The guard is preloaded by both the entrypoint and `NODE_OPTIONS`.
- Enforcement is the Docker `internal=true` topology plus the separate TLS-SNI gateway, not the process-local guard. The container verifier proves the denials with the guard provably absent, and proves that a non-internal namespace is refused at startup.
- Full local suite **327/327 PASS** on Node `v24.19.0`; typecheck and connector build PASS; guard tests 23/23 and gateway tests 16/16; allow-path harness 21/21; container boundary 25/25; LAN exposure 10/10; static topology 15 assertion groups.
- Hosted [CI 41650617518](https://github.com/kha997/zalo-shared/actions/runs/41650617518) on `b52bc33` passed both jobs: **327/327** unit checks, **2/2** guarded offline SDK checks, **9 browser cases + 1 explicit skip, 0 unexpected**, restore/restart/monitoring/image gates, and the pilot job including the staged allow-path harness at 21/21. The harness executes a digest-verified staged copy because the namespace it creates under `sudo` cannot traverse another account's home; the first attempt (run `41649094828`) failed there and is recorded, not hidden.
- In-image `preflight` under `--network none` admitted the synthetic bootstrap, observe and send-test manifests and denied expired, out-of-scope, extra-field, missing-build, wrong-identity, placeholder and stage-mismatch cases. An entrypoint override that removed the guard was refused.

## Bootstrap attempt — 2026-11-03 14:56–15:26Z

The Owner authorized `G5A_LIVE_BOOTSTRAP_ONLY` for that window. The mandatory
preflight was run at `14:57:07Z`–`14:59:52Z` and returned **`G5A_BLOCKED`** before
any provider contact: the pilot Postgres has `ssl=off` while the reviewed
connector requires `sslmode=require|verify-*` for a non-loopback URL, the
reviewed internal-network and gateway topology was not deployed, and the only
private manifest is a placeholder template bound to `8d40c0f` rather than the
reviewed `2dff06e` image. No QR, session, ownership or database write occurred;
`session.key` and the view directory are unchanged. Details, evidence and the
added remediation are in [G5A-BOOTSTRAP-REPORT.md](docs/evidence/G5A-BOOTSTRAP-REPORT.md)
§8. The boundary itself remains `G5A_NETWORK_BOUNDARY_VERIFIED`; what failed is
the live-host provisioning, not the offline boundary.

## Deployment remediation — 2026-11-03

Each of the three bootstrap blockers was reproduced first, then closed on the
Owner's actual machine (WSL2 Ubuntu 24.04, Docker 29.6.2). No live Zalo action
was taken.

- **Database TLS (D1).** A dedicated Postgres 17 container `pilot-postgres` runs
  on the internal `zalo-shared-pilot-db` network with a private ECDSA CA, a
  `pilot-db` SAN, `hostssl` + `scram-sha-256` and an explicit `hostnossl reject`
  rule. The connector connects with `sslmode=verify-full` over TLSv1.3. The CA is
  supplied through `NODE_EXTRA_CA_CERTS`, because `requireTlsDatabaseUrl` refuses
  an `sslrootcert` query parameter; the gate was not relaxed. The previous
  blocker — a URL without `sslmode` — is reproduced and refused. The runtime role
  is `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION`, cannot create in
  `public`, cannot modify `audit`, cannot delete ownership, provider-state,
  budget or ledger rows, and cannot roll the send budget back.
- **Deployed topology (D2).** The reviewed topology is deployed: the connector
  joins `pilot-db` and the internal `pilot-egress` network; `egress-gateway` is
  the sole member of the non-internal `pilot-uplink`, has `ip_forward=0`, no
  published ports, UID 65532 and `cap_drop: ALL`. Negative tests cover direct
  IP, IPv6, UDP, DNS, missing/stopped gateway, wrong network attachment,
  unapproved SNI and an empty egress policy. No Windows Firewall, Docker daemon
  or unrelated host networking was changed.
- **Enrollment readiness (D3).** The private template is bound to the reviewed
  image identity (`2dff06e…`, lock `17dcd254…`, SDK integrity `sha512-pBU0T0…`)
  and is inert: no live grant exists, no QR was generated. Synthetic grants prove
  the observe and send-test stages are denied, and the QR path is private to the
  connector UID and cleaned up.
- **End-to-end dry run (D4).** All ten required items passed with synthetic
  inputs: image identity, DB TLS, ownership admission on a disposable clone,
  network enforcement, bootstrap host allowlist, grant scope and expiry, local
  synthetic QR handling, encrypted session store, safe shutdown and no external
  traffic or residual processes. The live ownership row was untouched.
- **Independent review (D5).** The review's High finding — the runtime role could
  erase control state and reset the send budget — was fixed and re-verified on
  the deployed database. Medium and Low findings are recorded with dispositions
  in [G5A-DEPLOYMENT-INDEPENDENT-REVIEW.md](docs/evidence/G5A-DEPLOYMENT-INDEPENDENT-REVIEW.md).
- **Reproducibility.** The scripts and evidence are committed in `9d94a26` and
  cited in `ecc0600`. Hosted [CI 41669199182](https://github.com/kha997/zalo-shared/actions/runs/41669199182)
  on `ecc0600` passed both jobs.

Residual and UNPROVEN items are listed in the review: local unsigned images,
Docker daemon trust, host-wide LAN isolation, runtime-only provider hosts, and
the fact that no real grant, QR scan or session exchange has been exercised.

## Live bootstrap attempt — 2026-11-04 00:46–01:16Z

The Owner authorized `G5A_LIVE_BOOTSTRAP_ONLY` for that window. This was the
first attempt with a valid live grant and a deployed boundary.

- **Preflight:** `00:46:58Z`–`00:47:18Z`, **22/22 PASS** — window, three network
  `Internal` flags, gateway runtime/ports/forwarding/attachment/sole-uplink,
  exact three-host allowlist, no connector process or container, ownership
  `idle`, no reconciliation required, private modes, no pre-existing session,
  enrollment-only consent scope. One checker query was corrected before the
  final pass; no host control failed.
- **Grant:** issued `00:48:43Z`, expires `01:14:00Z`, consent `notAfter`
  `01:16:00Z`, `enroll-session` only, null account, zero peers, 10 parts/day,
  2 s interval; admitted by the in-image preflight with no network namespace.
- **One bootstrap:** started `00:54:29Z`. Ownership `reserved` `00:54:31Z`; one
  gateway `sni_allow` for `id.zalo.me:443` at `00:54:32Z`; `qr.png` written in
  the `0700` view directory at `00:54:33Z` and copied to the Owner's
  Windows-visible private path. The Owner scanned the QR and completed the
  confirmation on the official phone. The connector exited **1** at `00:56:02Z`,
  fencing ownership to `uncertain` (fault `shutdown`) and clearing the QR.
  **No session was written and no UID binding was established.** No retry was
  run, as the authorization forbids automatic QR retries.
- **Containment:** no residual container or connector process; the only provider
  destination was the reviewed `id.zalo.me`; no denials; the local QR copy and
  all temporary QR helpers were deleted; `pilot_send_budget` and
  `pilot_part_ledger` are empty.
- **Unproven:** the exact local gate that aborted. Because the phone scan and
  confirmation succeeded, the provider login resolved; the failure is confined
  to the post-login local gates (type-4 `imei`/`userAgent` capture, the console
  `confirm` answer, cookie snapshot, freshness/ownership, session write), all of
  which fail closed to exit 1. The exit at `00:56:01.670Z` is 27 s before the
  120 s deadline, so a prompt left waiting for input is excluded. The console
  output was not retained. The earlier `stdout=no` reading is withdrawn — it
  measured that diagnostic's own redirection — and a fresh offline check on the
  same launch path (`05:35:04Z`: host and container stdin/stdout/stderr all TTY,
  zero provider traffic) removes TTY as a leading candidate.
- **Confirmed by the Owner:** the QR was scanned and confirmed on the official
  phone; the phone remains logged in and operational. A provider-side session
  may therefore exist and must be revoked from the phone; no local credential
  was read or written.
- **Control state:** `connector_ownership` is `uncertain` and `provider_state`
  has `reconciliation_required=true`. Both are the fail-closed result of the
  close path and were not reset; a further G5-A preflight will refuse until the
  Owner authorizes a reviewed reconciliation.

Details and the required changes are in
[G5A-BOOTSTRAP-REPORT.md](docs/evidence/G5A-BOOTSTRAP-REPORT.md) §9.

## Incident disclosure

An unauthorised diagnostic probe during this directive contacted `id.zalo.me`
(`GET /probe`) and `wss://jr.chat.zalo.me/ws` from the workstation, without the
SDK, credentials or a session. No account state or session was created. It is
disclosed in [G5A-BOUNDARY-PROBE-INCIDENT.md](docs/evidence/G5A-BOUNDARY-PROBE-INCIDENT.md)
and is not treated as evidence for any gate. The "no provider communication"
statements inside the boundary evidence are scoped to the work they describe
and link that record.

## Enforced G5 limits

Exactly one connector account, exactly one allowlisted direct peer, 1–10 outbound parts/account/day and at most 10 per grant, ≥2000 ms interval, 2-hour runtime cap bounded absolutely by grant expiry, text-only by default, no automatic reconnect (a fault exits non-zero as `connection-lost`), no automatic resend after unknown, no concurrent connector ownership, and separate Owner authorization per stage. One stored-credential login per process is performed; no QR/password re-enrollment or retry loop exists.

## Next action

The 2026-11-04 authorization is consumed, not extended. The immediate blockers
are now the un-attributable abort and the fenced control state, not deployment:

1. **Attribute the abort.** Capture the connector console to a `0600` private
   log (never committed) and add reviewed, non-secret abort reason codes for the
   post-login gates: the CLI currently collapses every bootstrap failure into
   `"gate":"unavailable"` (`tools/pilot-connector.ts:374-383`).
2. **Prove the confirmation path offline.** `tests/transport/qr-bootstrap.test.ts`
   injects a fake view, so the real `defaultConfirm` TTY gate is untested. Add a
   non-TTY refusal test and run the synthetic QR fixture end to end in a
   disposable topology: a `confirm` answer writes the session, a refused answer
   writes nothing.
3. **Owner decision on control state.** Authorize and review the reconciliation
   of `connector_ownership` (`uncertain`) and `provider_state`
   (`reconciliation_required=true`). This record does not reset either.
4. **Revoke the provider session.** The phone confirmation completed a provider
   login; the Owner logs out that session from the phone's logged-in device list
   and confirms the phone remains normal. No local session exists to reuse.
5. **QR handoff rehearsal.** Pre-open the local viewer and rehearse reaching the
   terminal `confirm` prompt (and typing `confirm`) within the QR lifetime.
6. **New G5-A authorization.** Provide a fresh explicit UTC start and expiry for
   bootstrap only. The previous window cannot be reused.
7. **Unchanged Owner decisions.** Observe/send-test window (their runtime-only
   hosts still fail closed), an optional second-device LAN probe, optional
   registry publication for the unsigned local images, and optional
   `DOCKER-USER` rules on native Linux.

G5-B is not authorized. No retry, login, QR generation, observe, send or media
action is permitted until a new authorization exists.

**STOP — `G5A_BOOTSTRAP_FAIL`. The 2026-11-04 authorization is consumed; a new G5-A authorization is required and G5-B is not authorized.**
