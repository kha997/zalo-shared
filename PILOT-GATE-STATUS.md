# Pilot gate status

**Date:** 2026-11-09
**Branch:** `feat/shared-inbox`; staged connector artifact source commit `8d9e39d671202b9588748ef6122b3d2992b1185f` (CI run 42635857403); previously reviewed source `2dff06e063b87d6abf5e25e4a1ca9c369ba7236e`; deployment remediation `9d94a26`
**PR #3:** OPEN, **Draft** (not merged, not deployed)
**Owner decision:** `G5_SCOPE_APPROVED_ACTIVATION_PENDING` — D1–D7 approved in scope; live activation withheld
**G5-A authorization:** four live bootstrap authorizations have been consumed —
`2026-11-04T00:46Z–01:16Z` (failed before login), `2026-11-06T23:40Z–00:10Z`
(`qr-expired`), `2026-11-07T00:00Z–00:20Z` (post-scan `redirect-denied`) and
`2026-11-09T13:12Z–13:42Z` (post-scan redirect to the unreviewed
`jr.zaloapp.com`, refused; `G5A_BOOTSTRAP_FAIL`). A fifth window,
`2026-11-07T01:02Z–01:32Z`, was blocked before any QR
(`G5A_BLOCKED_REDIRECT_POLICY`). None may be extended, rescheduled or reused.
**Live pilot:** **NOT ACTIVATED** — four live attempts emitted a QR and contacted
only `id.zalo.me`; no completed handshake, no UID, no session, no encrypted store
and no real account operation. On 2026-11-09 the phone scan succeeded and the
connector refused the provider's `checkSession` redirect to `jr.zaloapp.com`.
**Owner reconciliation gate:** the 2026-11-07 incident was reconciled once in the
Owner window `00:54–01:14Z` (epoch 5→6, gap 5→6). The 2026-11-09 incident is
fenced `uncertain` at epoch 7 with gap 7 and `reconciliation_required=true`; the
read-only preflight passes and the single transition is prepared but **not
executed** (`G5A_RECONCILIATION_REQUIRED_AWAITING_OWNER`). No control state was
reset by hand.
**Pilot admin provisioning (2026-11-04):** `G5A_PILOT_ADMIN_READY_AWAITING_OWNER_RECONCILIATION`
— exactly one active pilot admin was created through the reviewed identity model
and verified through the reviewed login/CSRF/authorization path; the credential
stays in a `0600` file outside the repository. No reconciliation was executed;
the pilot control rows are unchanged
**Reconciliation implementation (2026-11-04):** `G5A_RECONCILIATION_IMPLEMENTED_AWAITING_OWNER_EXECUTION`
— a reviewed, single-use operation is implemented and offline-verified; it has
**not** been executed, the pilot rows are unchanged, and the live allowlist is
unchanged
**Reconciliation preflight (2026-11-04):** `G5A_RECONCILIATION_BLOCKED` — the
`G5A_RECONCILIATION_ONLY` authorization was preflighted read-only; nine of ten
preconditions passed, but the pilot database has no admin identity (`users=0`,
`sessions=0`), so admin authentication, CSRF and single-use request identity
cannot be verified. No mutation, no execution; the pilot rows are unchanged
**Deployment remediation:** `G5A_DEPLOYMENT_READY_AWAITING_OWNER_START` was met
before the 2026-11-04 attempt; the deployment remained healthy, the enrollment
itself did not complete
**Redirect diagnostic remediation (2026-11-07):** `G5A_DIAGNOSTIC_DEPLOYMENT_BLOCKED`
— the diagnostic-only change (`8a71644`) and the QR viewer (`3f8703b`,
`1ab90bb`, `c2f6a05`) are implemented, offline-verified and independently
reviewed (PASS WITH FINDINGS: admission unchanged, no secret reaches the sink,
three viewer defects fixed). The candidate image
`zalo-shared-connector:g5-diag-8a71644` was **not deployed**. The project's own
connector scan fails on two unfixed HIGH `zlib1g` findings that equally affect
the deployed baseline and the current distroless head; CI inherits the failure.
The allowlist, TLS, compose copy, image pointer and ownership state are
unchanged, no connector was started and no provider contact occurred. An Owner
decision is required: explicitly assess the two CVEs or approve a separately
reviewed base-image refresh; deployment then also needs the image rebuilt at the
reviewed HEAD or the manifest pinned to `8a71644`
**zlib CVE adjudication (2026-11-07):** `G5A_ZLIB_CVE_ADJUDICATED_AWAITING_OWNER_DECISION`
— `CVE-2026-76844` applies to the deployed `zlib1g 1:1.3.dfsg+really1.3.1-1+b1`
(the tracker qualifies it: before 1.3.1.2 the failed write must be followed by
`gzclearerr()`); `CVE-2026-85091` is real but its applicability to 1.3.1 is
**UNPROVEN** and must not be recorded as a false positive (the `gz_vacate` code
is absent from 1.3.1, while Debian tracks trixie as vulnerable). Debian 13
publishes no fixed `zlib1g` in `trixie`, `-updates`, `-security`,
`-proposed-updates` or `-backports`; `forky`/`sid` carry
`1:1.3.dfsg+really1.3.2-4`. Six throwaway probes establish that Trivy keys the
Debian advisory by `/etc/debian_version` and that the trixie bucket carries no
fixed version for either CVE, so **every** installed `zlib1g` on a Debian 13
image is reported — the fixed 1.3.2-4 overlay and a fabricated `1.4.0` probe
included. Relabelling the release was measured and rejected: it is metadata
forgery and surfaces 10 `libssl3t64` findings instead. Nothing in the connector,
app or gateway image maps `libz.so.1` (Node bundles its own zlib
`1.3.2.1-motley`, there are no `.node` addons, and the runtime has no `libz`
`NEEDED` entry). A dpkg-authored `1.3.2-4` overlay was built and functionally
verified but **not committed and not deployed**; it is gate-neutral, forks the
signed base and would mask a future trixie DSA. The first draft of the evidence
carried two recipe defects and a wrong scanner mechanism; both independent
reviews' corrections are applied. No scanner suppression, ignore file, VEX,
metadata rewrite or library deletion was used. Options: A overlay (evidence
only), B vendor base (Chainguard Wolfi measured 0 HIGH/CRITICAL, but Node 26, a
new registry and 16 files with an explicit `/nodejs/bin/node` path), C wait for
the Debian 13 fix, D time-boxed, ID-keyed disposition in the two scan scripts
(recommended). The live egress gateway image carries the same two findings. See
[G5A-ZLIB-CVE-REMEDIATION.md](docs/evidence/G5A-ZLIB-CVE-REMEDIATION.md).

## Gates

| Gate | Status | Evidence |
| --- | --- | --- |
| `G1_ENVIRONMENT_ACCEPTED` | PASS | [G1-ENVIRONMENT-RECONNAISSANCE.md](docs/evidence/G1-ENVIRONMENT-RECONNAISSANCE.md) |
| `G2_INFRASTRUCTURE_READY` | PASS | [G2-PRIVATE-INFRASTRUCTURE.md](docs/evidence/G2-PRIVATE-INFRASTRUCTURE.md) |
| `G3_OFFLINE_VERIFIED` | **PASS (scoped)** | [G3-OFFLINE-ACCEPTANCE.md](docs/evidence/G3-OFFLINE-ACCEPTANCE.md); UNPROVEN: capacity above 100 clients, isolated-server browser case, key escrow, live provider |
| `G4_PILOT_ACTIVATION_PACKAGE` | **SUPERSEDED IN SCOPE** | [G4-PILOT-ACTIVATION-PACKAGE.md](docs/evidence/G4-PILOT-ACTIVATION-PACKAGE.md); D1–D7 accepted in scope by the G5 decision |
| `G5_SCOPE_APPROVED_ACTIVATION_PENDING` | **APPROVED IN SCOPE** | [G5-SCOPE-APPROVAL.md](docs/evidence/G5-SCOPE-APPROVAL.md) |
| `G5A_AWAITING_OWNER_START` | **SUPERSEDED** | Old authorization window invalidated by `G5A_BLOCKED` |
| `G5A_BOOTSTRAP_VERIFIED` | **FAIL (2026-11-04 attempt)** | [G5A-BOOTSTRAP-REPORT.md](docs/evidence/G5A-BOOTSTRAP-REPORT.md) §9–§10; the single authorized bootstrap emitted a QR and contacted only `id.zalo.me`, then exited 1 without a session or UID binding. Post-window analysis narrows the abort to the SDK's `checkSession` handshake (redirect to the excluded `chat.zalo.me` refused locally) but does not prove it; the exact gate remains UNPROVEN. The 02:00Z and 14:56Z attempts were `G5A_BLOCKED` before live action |
| `G5A_AWAITING_OWNER_RECONCILIATION` | **CLEARED (reconciled 2026-11-05)** | Fenced `uncertain` incident reconciled through the reviewed route; see the execution row below |
| `G5A_RECONCILIATION_IMPLEMENTED_AWAITING_OWNER_EXECUTION` | **SUPERSEDED — EXECUTED** | Implementation and offline verification remained valid; execution followed the Owner's one-shot schedule authorization. See the execution row below |
| `G5A_RECONCILIATION_BLOCKED` | **CLEARED (admin provisioned)** | [G5A-RECONCILIATION-PREFLIGHT-BLOCKED.md](docs/evidence/G5A-RECONCILIATION-PREFLIGHT-BLOCKED.md); read-only preflight at the time, 9/10 PASS, `users=0`. The blocker was the missing admin identity, resolved by the row below; execution is still not authorized |
| `G5A_RECONCILIATION_PASS_AWAITING_BOOTSTRAP_DECISION` | **PASS (reconciliation)** | [G5A-RECONCILIATION-EXECUTION.md](docs/evidence/G5A-RECONCILIATION-EXECUTION.md); one authenticated request at `2026-11-05T02:01:09.653Z`, HTTP 200, `uncertain → idle`, epoch 1→2, gap 1→2, one `connector.reconciled` audit row (id 9), 20/20 checks, post-state re-read on a separate read-only connection. No retry, replay, SQL override or provider contact |
| `G5A_REDIRECT_DEPLOYED_AWAITING_OWNER_START` | **PASS (deployed, offline)** | [G5A-REDIRECT-DEPLOYMENT.md](docs/evidence/G5A-REDIRECT-DEPLOYMENT.md); the Owner's deployment authorization was executed on 2026-11-06T23:10Z: reviewed image `zalo-shared-connector:g5-ready-6d9c0e9` (`sha256:97513c22ac74…`, embedded sourceCommit `6d9c0e9`) and the exact four-host allowlist (`chat.zalo.me` as redirect-target) are deployed, the private compose copy is byte-identical to the reviewed example, and the gateway recreated healthy. 48/48 deployed-network, 21/21 allow-path, 33/33 in-image redirect, all static checker assertions and 377/377 suite PASS; control state stayed `idle`, epoch 2, gap 2, `reconciliation_required=false` with zero unresolved work; the gateway admitted no tunnel, so no provider contact occurred. Independent read-only verification returned PASS on all eight reviewed claims, with residual risks recorded. The live redirect remains UNPROVEN until an authorized bootstrap |
| `G5A_BOOTSTRAP_VERIFIED_20261106` | **FAIL (`qr-expired`)** | [G5A-BOOTSTRAP-REPORT.md](docs/evidence/G5A-BOOTSTRAP-REPORT.md) §11; one authorized attempt in `23:40–00:10Z`: preflight fully PASS, ownership acquired at epoch 3, QR emitted at `23:42:54.537Z` and expired at `23:44:34.560Z` before the terminal confirmation, connector exited 1. No UID, no `session.enc`, no post-login handshake and no `chat.zalo.me` contact; the gateway allowed only `id.zalo.me` twice with zero denials. The Owner reports the phone scan succeeded; its provider-side outcome is UNPROVEN |
| `G5A_RECONCILED_20261106` | **PASS (reconciliation)** | [G5A-RECONCILIATION-EXECUTION-2026-11-06.md](docs/evidence/G5A-RECONCILIATION-EXECUTION-2026-11-06.md); executed once in the Owner window `23:52–00:12Z` by the incident-bound reviewed driver (commit `ae8a77f`): 13/13 preflight checks, one authenticated request HTTP 200, epoch 3→4, gap 3→4, `uncertain → idle`, audit id 14, 21/21 post-checks, no retry or replay. Provider state `disconnected`, `reconciliation_required=false`, zero unresolved work |
| `G5A_BOOTSTRAP_VERIFIED_20261107` | **FAIL (`redirect-denied`)** | [G5A-BOOTSTRAP-REPORT.md](docs/evidence/G5A-BOOTSTRAP-REPORT.md) §12; one authorized attempt in `00:00–00:20Z`: preflight PASS, ownership epoch 5, QR shown `00:04:15.547Z`, phone scan reported successful `00:05:05.668Z`, connector refused a post-scan redirect at `00:05:07.348Z` and exited 1. No UID, no `session.enc`, no `chat.zalo.me` contact; the gateway admitted only `id.zalo.me` with zero denials. Ownership fenced `uncertain` epoch 5, `reconciliation_required=true` (gap 5), QR deleted |
| `G5A_RECONCILED_20261107` | **PASS (reconciliation)** | [G5A-RECONCILIATION-EXECUTION-2026-11-07.md](docs/evidence/G5A-RECONCILIATION-EXECUTION-2026-11-07.md); executed once in the Owner window `00:54–01:14Z` by the incident-bound reviewed driver (commit `353bf02`): 13/13 preflight checks, one authenticated request HTTP 200 (`alreadyApplied=false`), epoch 5→6, gap 5→6, `uncertain → idle`, audit id 19 (`a646b408-…`), 21/21 post-checks, gateway unchanged, no retry or replay. Provider `disconnected`, `reconciliation_required=false`, zero unresolved work |
| `G5A_BLOCKED_REDIRECT_POLICY_20261107` | **BLOCKED** | [G5A-REDIRECT-POLICY-BLOCKED-2026-11-07.md](docs/evidence/G5A-REDIRECT-POLICY-BLOCKED-2026-11-07.md); window `01:02–01:32Z` opened with no grant, no QR and no provider contact. The sanitized evidence fixes the failure to an in-process redirect refusal (gateway: one admitted tunnel, nothing after the scan) but not the refused host; three policy-consistent candidates imply different minimal changes, and offline fixtures cannot distinguish them. State verified unchanged: `idle`, epoch 6, gap 6, `reconciliation_required=false`, zero sessions and zero work |
| `G5A_DIAGNOSTIC_DEPLOYMENT_BLOCKED` | **BLOCKED (image scan)** | [G5A-REDIRECT-DIAGNOSTIC-DEPLOYMENT.md](docs/evidence/G5A-REDIRECT-DIAGNOSTIC-DEPLOYMENT.md); diagnostic-only `8a71644` and viewer `3f8703b`/`1ab90bb`/`c2f6a05`; 16 new A/B/C/adversarial tests plus the unchanged 53 redirect/bootstrap tests PASS, full suite 393/393 twice, `tsc` clean and 50 redirect tests PASS after the viewer commits; independent review PASS WITH FINDINGS (admission unchanged, one tightening; no URL, `Location`, credential or identifier can reach the sink; three viewer defects found and fixed). The candidate admits a synthetic manifest bound to `8a71644` and refuses the old commit in-image; the in-image sink probe writes only the closed shape (0600, 245 bytes, one `cid`, invalid value rejected); the viewer was rehearsed in fixture, WSL-source and corrupt-PNG modes, including shell-injection refusal with no command run. The candidate `zalo-shared-connector:g5-diag-8a71644` (`sha256:ab20e296…`, UID 65532, no ports/files) was built and identity-verified but **not deployed**: the scan fails on two unfixed HIGH `zlib1g` findings (`CVE-2026-76844`, `CVE-2026-85091`) that equally affect the deployed baseline `g5-ready-6d9c0e9` and the current distroless head. Image pointer, allowlist, TLS, compose and ownership (`idle`, epoch 6, fenced `7cc878cf-…`/5) are unchanged; no connector was started and no provider contact occurred. Owner decision required: accept the two CVEs or approve a base refresh; deployment then needs a rebuild at the reviewed HEAD or a manifest pinned to `8a71644` |
| `G5A_ZLIB_CVE_ADJUDICATED_AWAITING_OWNER_DECISION` | **BLOCKED (Owner decision)** | [G5A-ZLIB-CVE-REMEDIATION.md](docs/evidence/G5A-ZLIB-CVE-REMEDIATION.md); `CVE-2026-76844` applies to the deployed 1.3.1 (with the tracker's `gzclearerr` qualifier), `CVE-2026-85091` applicability UNPROVEN (not a false positive); no fixed `zlib1g` in any Debian 13 suite, `forky`/`sid` have `1:1.3.dfsg+really1.3.2-4`. Trivy keys the Debian advisory by `/etc/debian_version`; the trixie bucket has no fixed version for either CVE, so every installed `zlib1g` on Debian 13 is reported (six probes: the fixed 1.3.2-4 overlay and a fabricated 1.4.0 probe both still flagged). Relabelling the release is forgery and still yields 10 `libssl3t64` findings. No image maps `libz.so.1` (Node bundles zlib `1.3.2.1-motley`, zero `.node` addons, no `libz` NEEDED). A dpkg-authored 1.3.2-4 overlay was built and functionally verified but not committed or deployed; it is gate-neutral, forks the signed base and would mask a future trixie DSA. No suppression, ignore file, VEX, metadata rewrite or library removal was used. Options: A overlay (evidence only), B vendor base (Chainguard Wolfi 0 HIGH/CRITICAL; Node 26, new registry, 16 files with an explicit `/nodejs/bin/node` path), C wait, D time-boxed ID-keyed disposition in `ops/pilot-scan.sh:96`/`ops/scan-image.sh:30` (recommended). The running gateway image shares both findings. State unchanged: `idle`, epoch 6, gap 6, `reconciliation_required=false`, gateway healthy, no connector, pointer `zalo-shared-connector:g5-ready-6d9c0e9` |
| `G5A_NEXT_BOOTSTRAP_READY_AWAITING_OWNER_START` | **SUPERSEDED — DEPLOYED** | [G5A-REDIRECT-READINESS.md](docs/evidence/G5A-REDIRECT-READINESS.md); preparation and independent review completed before deployment. The admission is no longer undeployed; see the row above |
| `G5A_BOOTSTRAP_FAIL_20261109` | **FAIL (`redirect-denied`)** | [G5A-BOOTSTRAP-ATTEMPT-2026-11-09.md](docs/evidence/G5A-BOOTSTRAP-ATTEMPT-2026-11-09.md); one authorized attempt at 13:25:05Z: preflight admitted, QR shown and scanned, `checkSession` returned a `Location` for `jr.zaloapp.com`, refused as `unexpected-location` (hops 0). No session, no UID, QR cleared; ownership fenced `uncertain` epoch 7, gap 7, `reconciliation_required=true`. No retry or policy loosening |
| `G5A_REDIRECT_REMEDIATION_STAGED` | **PASS (offline, staged)** | [G5A-REDIRECT-REMEDIATION-2026-11-09.md](docs/evidence/G5A-REDIRECT-REMEDIATION-2026-11-09.md); `REDIRECT_HOST`, the admitted redirect-target and the compose values replace `chat.zalo.me` with the observed `jr.zaloapp.com` (443, one hop, host-level), still four hosts; independent review APPROVE WITH CONDITIONS and all conditions closed; typecheck clean, 78/78 redirect suites, 407/407 full suite, network checker all assertions PASS; CI run 42635857403 at `8d9e39d` published the artifact, verified locally and staged as `zalo-shared-connector:g5-ci-8d9e39d` (archive `d416e76f…`, embedded `sourceCommit 8d9e39d…`); **not deployed**, the live gateway still admits `chat.zalo.me` |
| `G5A_RECONCILIATION_REQUIRED_AWAITING_OWNER` | **BLOCKED (Owner authorization)** | The 2026-11-09 fence is confirmed read-only: ownership `uncertain` epoch 7 (`af5048a8-…`, `shutdown`), provider `disconnected` gap 7 `reconciliation_required=true`, zero unresolved work, audit 28 rows with the incident prefix intact, preflight `ok:true` with zero advisory locks and zero other sessions. The prepared single transition (`uncertain→idle`, epoch 7→8, gap 7→8) is in the remediation record; no request was sent and nothing was mutated |
| `G5A_PILOT_ADMIN_READY_AWAITING_OWNER_RECONCILIATION` | **PASS** | [G5A-PILOT-ADMIN-PROVISIONING.md](docs/evidence/G5A-PILOT-ADMIN-PROVISIONING.md); exactly one active admin (`4fd6c034d5e7`), 22/22 pilot auth/CSRF/route checks, 19/19 disposable success-path checks, ownership/provider/delivery rows unchanged. No reconciliation executed |
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
- **Owner device history:** one entry for the attempt, QR method, login, last
  activity and logout all in the same minute (`07:56` Vietnam, `00:56Z`), the
  phone unaffected. The provider therefore recorded a login that ended at once.
  That proves acceptance, not that the SDK received or saved a session. No IP,
  UID, phone number or device identifier is recorded in this repository.
- **Post-window analysis (offline):** the abort is now narrowed to the SDK's
  own `checkSession` handshake between the phone confirmation and event type 4 —
  it follows a provider `Location` to the excluded `chat.zalo.me`, which the
  local guard refuses before the gateway, so no denial is logged and only one
  tunnel appears. This is a hypothesis, not proof; the diagnostic sink below
  will attribute the next attempt. See
  [G5A-BOOTSTRAP-REPORT.md](docs/evidence/G5A-BOOTSTRAP-REPORT.md) §10.2.
- **Connector shutdown did not end the provider session:** zca-js 2.2.0 exposes
  no logout API, the SDK instance is never resolved when `loginQR` rejects, and
  the adapter's cleanup only aborts a local controller and clears a local
  timeout.
- **Attribution work completed offline:** closed 26-code/15-stage vocabulary
  (`server/pilot-reasons.ts`), `PilotBootstrapError` per gate, a `reason` field
  on the CLI outcome, an opt-in `PILOT_DIAGNOSTIC_FILE` sink
  (`0600`, `O_NOFOLLOW`, closed vocabularies), the real prompt made testable,
  and synthetic end-to-end coverage with the real private view and encrypted
  store. Typecheck and connector build clean; both changed suites pass; the full
  suite passes except one pre-existing environmental flake in
  `tests/backend/pilot-egress-guard.test.ts` that also fails on unmodified
  `HEAD`. None of it is live evidence.
- **Control state:** `connector_ownership` is `uncertain` and `provider_state`
  has `reconciliation_required=true`. Both are the fail-closed result of the
  close path and were not reset; a further G5-A preflight will refuse until the
  Owner authorizes a reviewed reconciliation. No reviewed path can currently
  clear `uncertain`: re-acquisition requires `idle` and gap acknowledgement
  requires `idle`/`active`.

Details and the required changes are in
[G5A-BOOTSTRAP-REPORT.md](docs/evidence/G5A-BOOTSTRAP-REPORT.md) §9–§10.

## Reconciliation implementation — 2026-11-04 (offline, not executed)

The Owner approved implementation and offline verification only.

- **Operation.** `reconcileUncertainOwnership`
  (`server/connector-operations.ts`) and
  `POST /api/provider/operations/reconcile` perform one transactional
  `uncertain → idle` transition, gated on the exact owner, epoch, gap, provider
  status, an active admin + CSRF session, absence of a live connector
  (`73002`) or worker (`73001`), absence of unresolved provider/media work and
  absence of pending/unknown outbound or part state. Both control rows move
  together, the gap increments, the previous owner is retained in
  `last_fenced_*`, one secret-free audit row is written, and a duplicate
  `requestId` returns the original result without a second write.
- **Delivery state is never written.** No message, outbox, part, event or media
  row is touched; nothing is reset, replayed or resent.
- **Redirect investigation.** Static inspection of the pinned `zca-js@2.2.0`
  plus synthetic fixtures show the SDK follows any `Location`, the local guard
  refuses `chat.zalo.me` synchronously before the gateway, and the SDK then
  reports exactly `Cannot get session, login failed`. This supports the
  hypothesis but the provider redirect itself remains **UNPROVEN**. A
  conditional `chat.zalo.me:443` proposal and a no-new-host alternative are
  documented; **the allowlist is unchanged**.
- **Diagnostics.** The reason vocabulary now holds 31 codes, including four
  precise login-failure codes and `redirect-denied`; nine failure modes are
  asserted to stop at a named stage with a closed reason; the private diagnostic
  is shown to survive process exit without secrets.
- **Verification.** Typecheck and connector build PASS; the main full run was
  **353/353 PASS** on Node 24.19.0 with a disposable database. The final tree
  (354 tests) reports one failure: the known pre-existing load-sensitive
  loopback test in `pilot-egress-guard`, which passes **23/23** in isolation and
  passed in the main run; reconciliation 8/8, HTTP 4/4, redirect 5/5, bootstrap
  31/31. Independent review (**PASS WITH FINDINGS**) is recorded in
  [G5A-INDEPENDENT-RECOVERY-REVIEW.md](docs/evidence/G5A-INDEPENDENT-RECOVERY-REVIEW.md).
- **Not done:** no execution against the pilot database, no flag cleared, no
  live allowlist change, no provider contact, no QR/session, no observe/send,
  no deployment and no merge. The pilot containers remained stopped.

## Controlled reconciliation preflight — 2026-11-04 (read-only, BLOCKED)

The Owner authorized one audited reconciliation (`G5A_RECONCILIATION_ONLY`).
The ten mandatory preconditions were checked read-only against the dedicated
pilot database:

- **PASS (nine):** reviewed code and migration identity; dedicated host and
  database; no connector/SDK/worker; expected `uncertain`/epoch 1/gap 1/provider
  state; no `session.enc` or quarantine artifact; zero unresolved
  delivery/provider work; provider session logged out per the Owner device
  history with no newer local evidence; zero advisory locks; non-mutating
  rehearsal on a disposable schema.
- **BLOCKED — precondition 8:** the pilot database has no users and no sessions.
  The reviewed path requires an authenticated active admin and a CSRF token, so
  admin authentication and single-use request identity cannot be verified.
  Creating an admin identity is a control-state mutation and a new credential,
  outside this authorization. The reviewed operation was therefore **not
  invoked**.
- **Rehearsal:** on the disposable database with the exact pilot rows, the
  operation returns 403 and writes nothing without an admin; with a disposable
  admin it performs `uncertain → idle`, epoch 1→2, gap 1→2, one audit row, and
  an identical replay returns `alreadyApplied`. This is synthetic evidence, not
  live execution.

No write transaction reached the pilot database; every query ran read-only. The
database container was started only for inspection and returned to `Exited (0)`;
the egress gateway stayed stopped. No session, QR, connector, provider contact,
delivery change or SQL override occurred. Details:
[G5A-RECONCILIATION-PREFLIGHT-BLOCKED.md](docs/evidence/G5A-RECONCILIATION-PREFLIGHT-BLOCKED.md).

## Pilot admin provisioning — 2026-11-04 (PASS, no reconciliation)

Under `G5A_PILOT_ADMIN_PROVISIONING_ONLY` the Owner authorized resolving only
the missing admin prerequisite.

- **Provisioning:** one short-lived container connected as `zs_owner` over
  `verify-full`, inserted one admin inside a transaction using the reviewed
  `seed()`/`hashPassword()`, verified exactly one active `role='admin'` row, and
  appended one `auth.admin_provisioned` audit row. The runtime role `zs_app`
  and its grants are unchanged; no migration ran.
- **Identity:** `4fd6c034d5e7` (`pilot-admin@zalo-shared.invalid`), user
  `0b3030ee-1e4b-4798-912c-34006c9b1428`, role `admin`, active. The credential
  is 64 base64url characters in a `0600` file under a `0700` directory outside
  the repository and is not reproduced in any evidence or log.
- **Verification:** 22/22 checks inside a no-published-port app container —
  login, strict cookie, CSRF, admin-only authorization, unauthenticated and
  forged-session rejection, malformed reconciliation body → `400`, read of the
  fenced state, logout, and no surviving session. 19/19 checks on a disposable
  database cover the successful `uncertain → idle` reconciliation, epoch 1→2,
  gap 1→2, one audit row, idempotent replay, agent `403` and delivery state
  unchanged.
- **Invariants:** `connector_ownership` (`uncertain`, epoch 1, owner
  `d4729725-…`, fault `shutdown`) and `provider_state` (`disconnected`,
  `reconciliation_required=true`, gap 1) are identical to the pre-work
  baseline. Audit grew only by the provisioning and two verified login/logout
  pairs; delivery, provider-event and media counts remain zero.
- **Not done:** no reconciliation invocation against the pilot, no flag clear,
  no provider contact, no QR/session, no observe/send, no deployment, no merge.
  The pilot database is back to `Exited (0)` and the egress gateway stayed
  stopped. Details and the independent review disposition:
  [G5A-PILOT-ADMIN-PROVISIONING.md](docs/evidence/G5A-PILOT-ADMIN-PROVISIONING.md).

## Controlled reconciliation execution — 2026-11-05 (PASS)

Under the Owner's one-shot schedule authorization, exactly one reconciliation
ran inside the authorized window `02:00:00Z`–`02:20:00Z`.

- **Path.** A persistent local scheduler (Windows Task Scheduler task
  `ZaloPilotG5AReconcile`, WSL user `zen`, no elevation) invoked the reviewed
  driver once. The driver took its own advisory lock (`73003`), re-checked the
  window before any action, wrote a one-shot attempt marker, authenticated as
  the pilot admin, obtained a CSRF token and made **one** `POST
  /api/provider/operations/reconcile` with the expected owner, epoch, gap and
  `confirmOwnerApproved: true`, then logged out.
- **Result.** HTTP 200, `outcome=reconciled`, `alreadyApplied=false`,
  `transportUnknown=false`. Started `02:01:09.653Z`, finished `02:01:10.189Z`.
  `connector_ownership` moved `uncertain → idle`, epoch 2, owner cleared, fault
  cleared; `last_fenced_owner_id`/`epoch` retain the incident
  (`d4729725-…`, 1). `provider_state` is `disconnected`,
  `reconciliation_required=false`, gap 2. Exactly one `connector.reconciled`
  audit row (id 9) carries the request id; no message, outbox, delivery, event,
  media, budget or ledger row was touched.
- **Verification.** The driver re-read the state on a separate read-only
  connection; 20/20 checks PASS. An independent read-only re-verification later
  that morning reproduced the same post-state, `users=1`, `admins=1`,
  `sessions=0`, zero unresolved work and zero advisory locks.
- **Containment.** The scheduler self-deleted after the run; the Qoder
  automation that could re-arm the same operation was removed first. No retry,
  no replay, no direct SQL, no provider contact, no QR, no connector start, no
  allowlist change. Credential, driver JSON and logs stayed in the private
  `pilot-admin` directory (`0600`, outside the repository).
- **Evidence gap.** The Task Scheduler Operational log is disabled on this host,
  so the wrapper log (UTC start/end/exit code) is the scheduling record; it is
  private and not committed. The sanitized report is committed.
- **Not done:** no G5-A bootstrap, no observe/send-test, no deployment, no PR
  merge. The egress gateway and database stayed stopped.

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

The 2026-11-06 bootstrap authorization is consumed, not extended, and its single
attempt ended `FAIL (qr-expired)` when the QR's 100-second lifetime ran out
before the terminal confirmation. The fenced incident has been reconciled
(`G5A_RECONCILED_20261106`): ownership is `idle`, epoch 4, provider
`disconnected` with `reconciliation_required=false`, gap 4 and zero unresolved
work. The live redirect remains UNPROVEN.

1. **Owner phone confirmation (blocking, no cleanup).** The Owner reports the
   scan succeeded around the moment the connector's QR window closed. Confirm
   that the official phone is still operational and whether a new pilot/device
   session appears in its session list; if one does, log it out from the phone.
   The connector has no logout capability and stored no session.
2. **New G5-A authorization.** Supply a fresh explicit UTC start and expiry for
   bootstrap only. The 2026-11-04 and 2026-11-06 windows cannot be reused.
3. **Timing is now the dominant risk.** The QR is valid for exactly 100 seconds.
   Open the QR viewer and the phone scanner before the connector starts, scan
   within the first half-minute, then type `confirm` in the attached console for
   the identity shown there.
4. **The redirect hypothesis is still untested.** Neither attempt reached
   `checkSession`, so the deployed `chat.zalo.me` hop has never been exercised
   live; this attempt neither supports nor refutes it.
5. **Unchanged Owner decisions.** Observe/send-test window (their runtime-only
   hosts still fail closed), an optional second-device LAN probe, optional
   registry publication for the unsigned local images, and optional
   `DOCKER-USER` rules on native Linux.

G5-B is not authorized. No retry, login, QR generation, observe, send or media
action is permitted until a new authorization exists.

**STOP — `G5A_BLOCKED_REDIRECT_POLICY`.** The 2026-11-07 `01:02–01:32Z` window was
not used: no grant, no QR, no provider contact and no deployed change, because
the post-scan redirect target cannot be determined from the retained sanitized
evidence and no unreviewed policy broadening is permitted. Ownership remains
`idle` at epoch 6, `provider_state` `disconnected` with
`reconciliation_required=false` and gap 6, the fenced pair `7cc878cf-…`/5 is
preserved, and zero unresolved work remains. The next attempt requires a new
explicit UTC Owner window plus either a reviewed host-only denial diagnostic
(exercised by one authorized live attempt) or an independently sourced statement
of the post-scan redirect chain; only then can the minimal policy change be
specified, reviewed, tested and deployed. The live redirect and the phone-side
session outcome remain UNPROVEN. No retry exists and no control state may be
reset by hand.

**DIAGNOSTIC ARTIFACT DEPLOYED — `G5A_DIAGNOSTIC_DEPLOYED_WITH_TIMEBOXED_CVE_DISPOSITION_AWAITING_OWNER_START`.**
Under the Owner's conditional Option D the private pilot now points at
`zalo-shared-connector:g5-diag-a2a7aa0` (index `sha256:390b87b6…`, config
`sha256:4d6cc120…`, source commit `a2a7aa0`). The two unfixed `zlib1g` HIGH
findings (`CVE-2026-76844`, `CVE-2026-85091`) remain visible and unpatched; they
are accepted only for this image, only for the private G5-A diagnostic scope and
only until `2026-11-09T00:00:00Z`, after which the evaluator refuses. The
unfiltered scan still fails on exactly those two findings and that failure is
retained. An independent review rejected the first evaluator because `--now`
let a caller move the expiry; the clock is now the process clock, unknown flags
are refused, and the re-review approved. `verify-deployed-pilot.sh` passed all
48 deployed-network assertions; ownership is `idle` at epoch 6 with gap 6, the
fenced pair `7cc878cf-…`/5 is preserved, the provider is `disconnected` with
zero unresolved work, the diagnostic sink is unchanged (15 lines,
`43fc4212…`), and no connector container exists. Live capture, QR, provider
contact, login, `observe`, `send-test` and merge remain unauthorized and require
a separate Owner START. The live redirect and the phone-side session outcome
remain UNPROVEN.

The 2026-11-09 renewal assessment ([G5A-SECURITY-GATE-RENEWAL-2026-11-09](docs/evidence/G5A-SECURITY-GATE-RENEWAL-2026-11-09.md)) supersedes the time-boxed exception instead of renewing it. The expired disposition is untouched (`expiresAt 2026-11-09T00:00:00Z`): the evaluator now refuses it with exit 3 and the three-entry ledger is unchanged. Debian trixie-security fixed both CVEs in `zlib1g 1:1.3.dfsg+really1.3.1-1+deb13u1`, the current distroless `nodejs24-debian13` base (`b770c59f…`) carries it, and images rebuilt at `af2be54` from that base scan with zero HIGH/CRITICAL: connector `7ae6f66f…` (config `0664e441…`, gate exit 0), application `989c6154…` (config `1ea4f333…`) and gateway `f75c2e8a…` (config `e2296655…`). The deployed generation still reports exactly the two findings and the unfiltered gate still fails on it (exit 1), so nothing is suppressed. The patched images are built and scanned only — not deployed and not merged; PR #3 stays draft. Offline checks at `af2be54`: typecheck clean, 403/403 suite, 40/40 redirect diagnostics, synthetic Windows QR viewer PASS. An independent review at `fb2f8cb` returned APPROVE with no blocking findings. Ownership remains `idle` at epoch 6 with gap 6, zero unresolved work, no running connector (the earlier "no connector container" wording is corrected: inert `Created` probe containers remain), the gateway is healthy and the sink is unchanged (15 lines, `43fc4212…`). Redeploying the patched artifacts and any live stage still require a separate Owner decision and start authorization. **G5A_SECURITY_GATE_PATCHED_NO_EXCEPTION_NEEDED**

**PATCHED PILOT DEPLOYED — `G5A_PATCHED_PILOT_DEPLOYED_AWAITING_OWNER_START`.**
Under the Owner's patched-redeploy authorization the private G5-A pilot now runs the
reviewed patched generation from the digest-pinned Debian 13 distroless Node 24 base
(`b770c59f…`, `zlib1g 1:1.3.dfsg+really1.3.1-1+deb13u1`): application
`zalo-shared:g5-patched-af2be54` (`sha256:989c6154…`, config `1ea4f333…`) healthy on
`127.0.0.1:3100`, and egress gateway `zalo-shared-egress-gateway:g5-patched-af2be54`
(`sha256:f75c2e8a…`, config `e2296655…`) healthy with the unchanged four-host allowlist,
no published port and `ip_forward 0`. The connector
`zalo-shared-connector:g5-patched-af2be54` (`sha256:7ae6f66f…`, config `0664e441…`) is
staged only: no connector container exists, so no session and no provider contact. Gate
scans report zero HIGH/CRITICAL on all three; a genuinely unfiltered rescan (no severity
flag) reports 46 MEDIUM/LOW findings per image, zero HIGH/CRITICAL, and its non-zero exit
is recorded rather than suppressed. No waiver or override is in force; the time-boxed zlib
disposition remains expired and unused. Offline acceptance re-ran at the deployed
generation: typecheck exit 0, 403/403 suite, 40/40 redirect diagnostics, admin proof 22/22,
container boundary 25/25, deployed topology 48/48, synthetic Windows QR viewer PASS with no
real QR. Ownership is `idle` at epoch 6 with the fenced pair `7cc878cf-…`/5 preserved,
provider `disconnected` with `reconciliation_required=false`, gap 6, one admin, zero
sessions and zero unresolved work; audit grew only by the proof's login/logout pairs
(20 → 26); the sink is unchanged (15 lines, `43fc4212…`) and no `session.enc` exists. The
stale G2 stack is stopped with its volume intact. An independent read-only review returned
APPROVE WITH CONDITIONS; all code and evidence conditions are closed, and the only carried
condition is the Owner's acknowledgment of the app's reviewed edge posture before any live
stage. No QR was generated, no provider was contacted, nothing was merged and PR #3 stays
draft. Any live G5-A stage requires a separate Owner START.
**G5A_PATCHED_PILOT_DEPLOYED_AWAITING_OWNER_START**

**Owner acceptance of the application edge-network posture (2026-11-09, G5-A only).**
The Owner explicitly accepted the existing, independently reviewed application
edge-network posture **for the private G5-A pilot only**: the application container joins
the reviewed non-internal `zalo-shared-pilot-app_pilot-edge` bridge, so its namespace has
an outbound default route, and its API is published only on `127.0.0.1:3100`. The
acceptance was given on the record that the application holds no Zalo SDK, no provider
credentials, no QR payload and no authenticated provider session, and that the connector
stays isolated behind the dedicated egress gateway with only the four reviewed provider
hosts admitted. It covers that residual condition and nothing else: it does **not** apply
to G5-B, G5-C, production or any broader deployment. The topology was not changed to close
the condition and remains exactly as reviewed; any future attempt to widen the app's
network reach (a new non-internal attachment, a second published port, a public bind, or
provider reachability from the app namespace) is outside this acceptance and requires a new
Owner decision. Recorded in
[G5A-PATCHED-PILOT-DEPLOYMENT-2026-11-09](docs/evidence/G5A-PATCHED-PILOT-DEPLOYMENT-2026-11-09.md)
§13.3 and §15. **OWNER ACCEPTANCE RECORDED — G5-A EDGE POSTURE, NO TOPOLOGY CHANGE**

**CI PROVENANCE CLOSED AND FINAL G5-A OFFLINE READINESS — `G5A_OWNER_START_READY`.**
The connector staged for the pilot is now the artifact CI built, not a local build. Workflow
run [42602520323](https://github.com/kha997/zalo-shared/actions/runs/42602520323) succeeded
at `10524666274704daa8e940a9ddad13719a56a967` (both jobs, 10:39:52Z–10:44:25Z) and published
the image itself as `pilot-connector-image`. The pilot job now checks out that commit, asserts
`HEAD` equals it, builds with `SOURCE_COMMIT` set to it and exports the exact image with its
id, archive sha256 and a self-describing manifest; the synthetic manifests bind to the same
SHA. The downloaded archive re-hashes to the run's record
(`a9d2f2440ead231c5b86e5975ce262554a1bb454bdd0bfd4b885794ed701cb76`), its config blob hashes
to the run's image id (`sha256:5ab893f7…`), all 29 layer diffIDs and the config match, and
the image's own identity reads `sourceCommit 1052466…` with the reviewed lock hash and
`zca-js` integrity. The reviewed scan gate exits 0 with zero HIGH/CRITICAL and no exposed
ports; uid is 65532 and no private pilot file is present. The artifact is staged as
`zalo-shared-connector:g5-ci-1052466` (local manifest digest `sha256:f54f760b…`, a store
difference from the runner's config digest, both recorded) and referenced by the private
interpolation with no connector container started. The image carries the eight-class redirect
vocabulary including candidates A/B/C. Because `server/pilot-policy.ts` compares the grant's
build block with the image identity, any live bootstrap grant must name `sourceCommit`
`1052466…`. Readiness re-verified: application `sha256:989c6154…` and gateway
`sha256:f75c2e8a…` healthy with 0 restarts and ready 200, four-host allowlist unchanged,
ownership `idle` epoch 6 with `7cc878cf…`/5 preserved, provider `disconnected` gap 6
`reconciliation_required=false`, one admin and zero sessions/work, DB `verify-full`, no live
grant (both private grants expired 2026-11-07), the Windows QR viewer rehearsal PASS with a
synthetic fixture and the accepted edge posture unchanged. No QR, no provider contact, no
merge; PR #3 stays draft. Evidence
[G5A-CI-PROVENANCE-2026-11-09](docs/evidence/G5A-CI-PROVENANCE-2026-11-09.md).
Owner instruction for an authorized bootstrap: the QR appears automatically, about a second
after emission, at `C:\Users\Admin\pilot-private-qr\g5a-qr.png` in a Windows viewer; scan it
with the Zalo phone within the 100-second lifetime.
**G5A_OWNER_START_READY**


**G5-A SINGLE AUTHORIZED BOOTSTRAP — FAILED AT REDIRECT POLICY, FENCED, RECONCILIATION REQUIRED.**
The one attempt authorized for `2026-11-09T13:12–13:42Z` ran once at 13:25:05Z against
`zalo-shared-connector:g5-ci-1052466` (CI run 42602520323, source `1052466`); preflight was
admitted, the four-host boundary held and the automatic Windows viewer showed the real QR in
the interactive foreground at 13:25:10Z. The Owner scanned it at 13:25:16.5Z. The SDK's
`check-session` request then returned a redirect from `id.zalo.me` to `jr.zaloapp.com`, a host
outside the reviewed inventory, and the fetch policy refused it (`redirect-denied`,
`unexpected-location`, `request=check-session`, `hops=0`) at 13:25:18.4Z. No session was
stored, no delivery work exists, the QR source was cleared and the staged copy removed. The
connector exited and was removed; ownership is `uncertain` epoch 7 (`fault=shutdown`) and
provider state is `disconnected` gap 7 with `reconciliation_required=true`. No retry, no
policy loosening, no grant reuse and no reconciliation reset were performed. Resolving the
`jr.zaloapp.com` redirect requires an Owner decision and independent review, and a new
authorization requires the reviewed reconciliation first. Evidence
[G5A-BOOTSTRAP-ATTEMPT-2026-11-09](docs/evidence/G5A-BOOTSTRAP-ATTEMPT-2026-11-09.md).
**G5A_BOOTSTRAP_FAIL** — gate: `G5A_RECONCILIATION_REQUIRED_AWAITING_OWNER`

**G5-A REDIRECT REMEDIATION STAGED, RECONCILIATION PREPARED — `G5A_REDIRECT_FIX_REVIEWED_AND_RECONCILIATION_READY`.**
Under the Owner's remediation-preparation directive, the observed post-scan hop was
admitted narrowly: `REDIRECT_HOST`, the single admitted redirect-target and the compose
values now name `jr.zaloapp.com` (HTTPS 443, one hop, only from the exact `checkSession`
call, host-level because the `Location` path/query were never recorded), replacing the
previously hypothesised `chat.zalo.me`, which is now explicitly excluded. The grammar is
unchanged: manual redirects everywhere, exact-URL origin, single-use hop, no direct target,
any further 3xx refused. Attribution rests on the provider's own redirect during the
authorized attempt and on Certificate Transparency data (current DigiCert `*.zaloapp.com`
wildcard plus Zalo service names); no DNS or live TLS probe was made and the earlier
unverifiable A-record claim was removed. Offline: typecheck clean, 78/78 redirect/QR
transport tests, 407/407 full suite, all static network-checker assertions PASS. An
independent review returned APPROVE WITH CONDITIONS and every condition is closed. CI run
[42635857403](https://github.com/kha997/zalo-shared/actions/runs/42635857403) succeeded at
`8d9e39d` and its artifact was downloaded, hash-matched (`d416e76f…`), loaded, identity-read
(`sourceCommit 8d9e39d…`) and staged as `zalo-shared-connector:g5-ci-8d9e39d`; the compiled
image contains the new host and not the old one. **Nothing was deployed**: no connector
container exists and the running gateway still admits `chat.zalo.me`. Mission B confirmed
the fence read-only — ownership `uncertain` epoch 7, provider `disconnected` gap 7,
`reconciliation_required=true`, zero unresolved work, audit 28 rows, preflight `ok:true`
(0 advisory locks, 0 other sessions) — and prepared, but did not execute, the single
transition `uncertain → idle`, epoch 7→8, gap 7→8, `reconciliation_required → false`
(one authenticated POST, audit id 29). The automatic Windows QR viewer is unchanged, so a
next attempt needs only scan plus identity confirmation once the fix is deployed and the
fence reconciled. Remaining Owner approvals: deploy the staged fix; authorize reconciliation
with a UTC window; authorize a fresh bootstrap grant bound to `sourceCommit 8d9e39d…`; and
acknowledge that a further redirect from `jr.zaloapp.com` would fail closed with
`redirect-after-hop`. No QR, provider contact, live allowlist change, reconciliation, send,
merge or deployment occurred. Evidence
[G5A-REDIRECT-REMEDIATION-2026-11-09](docs/evidence/G5A-REDIRECT-REMEDIATION-2026-11-09.md).
**G5A_REDIRECT_FIX_REVIEWED_AND_RECONCILIATION_READY**
