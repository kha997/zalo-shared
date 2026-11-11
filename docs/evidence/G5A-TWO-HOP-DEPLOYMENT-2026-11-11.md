# G5-A two-hop deployment and QR viewer acceptance (2026-11-11)

**Date:** 2026-11-11
**Authorization:** `OWNER AUTHORIZATION: DEPLOY TWO-HOP FIX & FINAL QR VIEWER ACCEPTANCE`
**Base HEAD:** `671b8f8eca7768e090235ca2f51cd8ae14b1f831`
**Reviewed source commit:** `d6f8aec2197bc8249b91bd9d4595e36f3129c0b4`
**Live action:** deployment of the reviewed connector artifact and its private
configuration, plus offline QR viewer acceptance. No connector was launched, no
provider was contacted, no QR was generated, no reconciliation was executed, and
no ownership, provider or audit row was altered.

## 1. Scope and prohibitions

§1–§3 of the directive authorized deploying the already CI-built two-hop
connector, verifying it independently, closing the remaining QR viewer lifecycle
risks, and preparing (not executing) the next reconciliation. §10 prohibited
provider contact, a real QR or Zalo login, reconciliation execution,
observe/send/media, additional provider hosts, production deployment, a PR merge
and automatic retries.

## 2. Deployed artifact identity

The private interpolation file now names the reviewed CI artifact. The image was
not started: `docker ps -a` shows no connector, bootstrap or reconciliation
container.

| Field | Value |
| --- | --- |
| Private pointer | `PILOT_CONNECTOR_IMAGE=zalo-shared-connector:g5-ci-d6f8aec` |
| Image id (platform manifest) | `sha256:d2a85b1911f961445579276f090dc8cee0ffea195a91b9691d7c114aa108f91b` |
| Config digest (OCI) | `sha256:9923258e6c0195f8cdc4485b1abbb47dbc364e8e0e027d7a61544b18e57ca653` |
| Layers | 29; every rootfs layer equals the OCI manifest layer digests |
| Image created | `2026-11-11T02:09:24.451646393Z` |
| Source commit (in config) | `d6f8aec2197bc8249b91bd9d4595e36f3129c0b4` |
| `lockSha256` | `17dcd25426639f7112b80764bc8aa27f9be2af3acf0aaf0f2cd490c434030c9b` |
| `sdkIntegrity` | `sha512-pBU0T0/uadH3Neq7yMssUmE769VVuqKhL8YD1HqQQG8e6lkwueAopNu0vhJdqiJRHZdPIEomT2FxRzauOx4pgA==` (`zca-js@2.2.0`) |
| Runtime | uid/gid `65532:65532`, `NODE_ENV=production`, entrypoint `/nodejs/bin/node --require=/app/egress-guard.cjs` |
| Exposed ports | none |
| CI run | `42943971343` attempt 1, `pull_request` `refs/pull/3/merge`: `test` and `pilot` both success |
| Artifact | `pilot-connector-image` id `13822176119`, 166,080,000 bytes, archive SHA-256 `d2410cdb7983f39df96725c4e3462ff1e61e44420d3577b7a8d73788f9a19fff` |
| Scan | Trivy 0.76.1: `highCriticalCount=0`, `fixableHighCriticalCount=0` |

The application and gateway images are unchanged by this deployment:
`zalo-shared:g5-patched-af2be54` (`sha256:989c6154…`) and
`zalo-shared-egress-gateway:g5-patched-af2be54` (`sha256:f75c2e8a…`), both
healthy. The gateway container is `421984c5…`, created
`2026-11-11T08:43:37.768858461Z`.

The private topology previously pointed at `g5-ci-8d9e39d` (prior gate record).
The exact pre-deployment interpolation file was overwritten at `08:43:37Z` and
the deploy script keeps no backup; the most recent retained interpolation backup
(`2026-11-09T1312Z`) predates that artifact and names `g5-ci-1052466`. The old
value is therefore not re-readable, but no connector had run under it since the
fenced incident and the image is not launched now. Recorded as a low-severity
evidence gap, not a control failure.

## 3. Deployment sequence (UTC)

| Time | Action |
| --- | --- |
| 08:43:37.167 | Private compose copy and interpolation file rewritten: connector pointer `g5-ci-d6f8aec`; both allowlists `chat.zalo.me` → `jr.zaloapp.com` |
| 08:43:37.768 | Egress gateway created from `g5-patched-af2be54`, started `08:43:38.588` |
| 08:43:39.321 | Gateway `startup` audit line: bind `172.16.29.10:443`, allow `id.zalo.me`, `jr.chat.zalo.me`, `jr.zaloapp.com`, `wpa.chat.zalo.me`, `maxTunnels 32` |
| 08:44:57 | Deployment gateway baseline written for the reconciliation wrapper |
| 08:56:47 | Single controlled QR rehearsal on the final scripts (synthetic fixture only) |

The gateway was recreated twice in this sequence: a first start used the deploy
script's default `g5-local` image and was immediately corrected to the patched
image. Because a recreation resets the container log, the wrapper's binding was
changed to a deployment baseline (same container id, image and creation time, and
a byte-identical log), recorded in
`/home/zen/pilot-private/zalo-shared/pilot-admin/reconcile-gateway-baseline.json`
with reason and `authorizationRef`. The pre-deployment log (the two tunnels of
the authorized 2026-11-11 attempt and four pre-incident synthetic denials) is
preserved in [G5A-TWO-HOP-REMEDIATION-2026-11-11.md](G5A-TWO-HOP-REMEDIATION-2026-11-11.md)
and in the incident evidence; it cannot be re-read from the recreated container.
That recreation is disclosed, not hidden.

No new provider hostname was admitted. `chat.zalo.me` remains excluded and no
wildcard exists anywhere in the deployed configuration.

## 4. Deployed policy and network verification

| Check | Observed |
| --- | --- |
| Connector allowlist | `PILOT_EGRESS_HOSTS=id.zalo.me,wpa.chat.zalo.me,jr.chat.zalo.me,jr.zaloapp.com` |
| Gateway allowlist | `GATEWAY_ALLOW_HOSTS=id.zalo.me,wpa.chat.zalo.me,jr.chat.zalo.me,jr.zaloapp.com` |
| Port | `PILOT_EGRESS_PORTS=443`; gateway binds `172.16.29.10:443`, upstream 443 |
| Name pins | `extra_hosts` maps the same four names to `172.16.29.10`; no other resolver |
| Connector networks | `[pilot-db, pilot-egress]`; no published ports |
| Egress network | `zalo-shared-pilot_pilot-egress` `internal=true`, sole member the gateway |
| Uplink network | `zalo-shared-pilot_pilot-uplink` `internal=false`, sole member the gateway |
| Runtime hardening | `read_only`, `cap_drop: [ALL]`, `no-new-privileges`, uid `65532:65532`, tmpfs `/tmp` 16m |
| Gateway routing | `net.ipv4.ip_forward=0`, no published ports, `NET_BIND_SERVICE` only |
| Connector container | none created, running or stopped |
| TLS | end-to-end at the gateway; connector trusts no extra provider CA; DB `verify-full` via `NODE_EXTRA_CA_CERTS` |

The policy itself is the reviewed `adapters/zalo/redirect-policy.ts` built into
this image: at most two hops, hop 1 only from the exact `checkSession` GET on
`id.zalo.me` to `https://jr.zaloapp.com:443`, hop 2 only from that authorized
response to `https://jr.chat.zalo.me:443`, `pending` single-use and chain-bound,
`redirect: "manual"` on every request, a direct request to `jr.zaloapp.com`
refused as `direct-redirect-host`, a third redirect refused as
`redirect-after-hop`, and malformed, downgraded, ported, userinfo, IP-literal,
trailing-dot, backslash or lookalike destinations refused before a socket. The
compiled artifact inside the image was checked by extraction (no request
performed) and carries `MAX_HOPS = 2` and both host constants; see §9.

## 5. QR viewer lifecycle acceptance

Changes committed in `671b8f8` (`ops/local/launch-qr-viewer.sh`,
`ops/local/qr-viewer.ps1`, `ops/local/qr-viewer-guard.ps1`,
`ops/local/rehearse-qr-viewer.sh`):

- the launcher owns one attempt id; a second launch for the same attempt is
  refused and opens no window;
- a legitimate QR update rewrites the staged copy in place and the existing
  window refreshes — no new window;
- ownership is a run id written under a shared state lock (`qr-viewer-state.lock`,
  `FileShare.None`); the viewer claims it before staging, the guard re-reads it
  before every delete, and the launcher supersedes a stale run by handing the
  stage over only after the old viewer closes;
- a stale viewer from another attempt cannot display the new session: it observes
  the owner change on its tick and closes;
- the guard removes the staged copy after a forced kill, retries with
  `Attempts=240`, and only believes "absent" after `ConfirmAbsent=12` samples;
- a live viewer heartbeats its run file each poll, so a long display is not
  mistaken for a dead run; the launcher serialises with `flock` and sweeps a
  stale copy at start.

One controlled rehearsal was run with synthetic fixtures (no real QR, no
network), at `08:56:47Z`, with exactly **one** visible window announced in
advance. Result `PASS` (`/tmp/qr-rehearsal-20261111.json`):

| Scenario | Observed |
| --- | --- |
| Single visible window | 1 window, session 1, image 480×600, synthetic fixture `2dab0568…` |
| Duplicate launch, same attempt | refused, 0 extra windows |
| Legitimate QR update | in-place refresh to `b20e6f27…`, 0 extra windows |
| Source cleared (auth failure/denial) | `viewer-close source-cleared`, `viewer-closed cleanup=final`, no copy |
| Corrupt PNG | exit 4, `invalid-png`, 0 windows |
| Truncated/undecodable PNG | exit 4, `undecodable-png`, 0 windows |
| Timeout with no QR | exit 3, `no-qr`, 0 windows |
| Bounded display (off-screen) | `display-timeout`, `cleanup=final` |
| Forced termination (off-screen) | guard `removed-staged`, no copy |
| Attempt handover (off-screen) | old `superseded` before new staged; old never showed the new QR |
| Stale viewer start | refused `superseded`, 0 windows |
| Guard non-owner / owner | preserves the newer copy / removes its own |
| Log hygiene | longest line 156 bytes (<400); no image bytes |

The Owner previously saw several windows in quick succession from an earlier
seven-scenario rehearsal; the fixtures were synthetic and the code was repeated
by design. This acceptance run opened one window, labelled synthetic in its
title, and nothing is scheduled to reopen the viewer. No `qr.png`, run file,
owner file or lock remains in the stage directory and no viewer or guard process
exists.

## 6. Diagnostics

The closed vocabulary is unchanged in shape and gains `second-hop-denied` for a
hop-2 refusal. Recorded: stage, reason, request category
(`check-session|provider-direct|redirect-follow|other`), redirect class, source
and destination hostname, hop count (capped at 2), UTC time and correlation id.
A direct request to a redirect host is `other` with `direct-redirect-host`; only
a request that spends an authorization is `redirect-follow`. No full URL, path,
query, `Location` value, cookie, token, QR content, UID, phone number or
credential can reach the sink.

## 7. Offline verification

Run on the reviewed tree `d6f8aec` and re-checked at `671b8f8` where noted:

| Check | Result |
| --- | --- |
| `npm run typecheck` | PASS (clean) at `d6f8aec` and at `671b8f8` |
| `npm run test:transport` | 178/178 PASS at `d6f8aec` and at `671b8f8` |
| `npm test` (disposable PostgreSQL) | 421/421 PASS at `d6f8aec` |
| `npm run test:sdk` (`zca-js@2.2.0`) | 2/2 PASS |
| `npm run build` / `build:connector` | PASS |
| `ops/local/check-pilot-network.sh` | all assertions PASS (4 hosts, 2-hop chain, pins, topology) |

The QR viewer changes after `d6f8aec` are shell/PowerShell only and are not
covered by the TypeScript suites; they are covered by the rehearsal above and by
the direct guard tests (owned, superseded, missing run file) re-run against the
final bytes.

## 8. Fenced state and reconciliation readiness

Read-only preflight at HEAD `671b8f8` (`ops/local/reconcile-20261111.sh preflight`,
preflight-only: nothing stopped, sent or quiesced): **PASS**.

| Field | Observed |
| --- | --- |
| `connector_ownership` | `uncertain`, epoch 9, owner `0280fd84-9026-4c91-bda2-7e16013ee7dd`, `shutdown`, `2026-11-11T00:54:44` |
| Last fenced pair | `af5048a8-41c7-46b3-920c-310855d6c911` / 7 |
| `provider_state` | `disconnected`, gap 9, `reconciliation_required=true`, `shutdown` |
| Audit | 33 rows, max id 33, 4 prior `connector.reconciled` |
| Locks / sessions | 0 advisory locks; application database sessions sampled 0 on the review preflight and 1 on the deployment preflight — the idle pool session is not stable, and `app_quiesce_required=1` is emitted only when sessions > 0 |
| Gateway | running healthy, baseline container `421984c5…`, log SHA-256 `be08a8a0…` (one `startup` line, zero tunnels) |
| Private state | session key only; no `session.enc`, `qr.png` or quarantine |
| Connector | no container, no host process |

The prepared request `4203bde7-f27e-4f5c-adda-e8f4e4eb62fe` is `notSent` and
bound to owner/epoch/gap 9. The wrapper is bound to the reviewed driver and
preflight blobs, the application image `sha256:989c6154…`, the fence prefix and
the deployment gateway baseline. No Owner window file
(`reconcile-window-20261111.json`) exists, so `execute` refuses; nothing was
stopped, sent or written outside the private lock file.

## 9. Independent acceptance review

An independent reviewer with read access to the deployed image, private topology,
policy source and compiled artifact, viewer scripts, rehearsal report, diagnostics
and reconciliation wrapper returned:

**VERDICT: APPROVE WITH CONDITIONS.** No finding blocks live use.

Confirmed independently: image id `d2a85b19…`, config `9923258e…`, creation time,
uid `65532:65532`, entrypoint, `NODE_ENV=production`, no exposed ports, 29
layers; build identity `d6f8aec…`, `17dcd254…`, `sha512-pBU0T0…`; archive
`d2410cdb…`; Trivy 0 HIGH/CRITICAL. The deployed compiled policy
`app/dist/connector/adapters/zalo/redirect-policy.js` (SHA-256 `12a5446…`) is
byte-identical to the repository build and contains `const MAX_HOPS = 2`,
`REDIRECT_HOST = "jr.zaloapp.com"`, `CHAIN_HOST = "jr.chat.zalo.me"` and the
forced `redirect: "manual"`. Network membership is as recorded (`pilot-egress`
internal, `pilot-uplink` external, gateway sole member of both, no port
bindings, `read_only`, `ip_forward 0`, four name pins). The read-only preflight
reproduced the fence, provider state, audit count, lock count, gateway log hash
and the absent window file. Diagnostics use closed sets and cap `hops` at 2. The
viewer exit codes match the rehearsal record. The changed tracked files contain
no URL path/query, token, cookie, QR, UID, phone number or credential; the stage
directory holds no `qr.png`.

| Finding | Severity | Disposition |
| --- | --- | --- |
| Procedure header still carried the 2026-11-06 status token while its stop point named the new gate | Medium | **Closed** — header updated to the current gate and deployment evidence |
| `db_sessions=1` / `app_quiesce_required=1` was not reproducible (review run sampled 0; the marker is emitted only when non-zero) | Medium | **Closed** — §8/§10 corrected; both samples recorded; execute stops the app and proves zero others |
| The gateway baseline is unsigned and binds only "nothing since deployment" | Low | **Disclosed** — the pre-incident log is preserved in the incident/deployment evidence; the wrapper also pins the same container, image and creation time and requires a byte-identical log |
| `dist/` is untracked, so image↔source equivalence is inferred from the embedded build identity and byte equality, not a committed build output | Low | **Disclosed** — the image carries `sourceCommit`/lock/SDK identity and the compiled policy equals the build from the committed source; CI builds from that source |
| `PILOT_EGRESS_HOSTS` is container-wide; the chain-bound policy is installed for bootstrap, so a future observe/send stage would rely on its own transport policy | Low | **Disclosed** — observe/send are not authorized; admission stays host-level and four-host; any later stage needs its own reviewed transport policy |
| Duplicate-launch refusal relies on 10 s run-file / 20 s owner-file freshness; a viewer with a blocked UI thread could allow a duplicate window after 20 s | Low | **Disclosed** — a duplicate attempt can only show the same bytes, one attempt id owns the stage, and ownership still prevents a second session being displayed |
| Double kill (viewer and guard) leaves the copy until the next-start sweep; a stale `qr-viewer.ps1` copy (2026-11-07, not executed) sits in the stage directory | Low | **Disclosed** — the sweep is the last resort, no `qr.png` is present, and the stale script copy is inert and outside the repository |

Could not be verified (and not claimed): live provider or redirect behaviour and
the live TLS chain (prohibited), a fresh Trivy run (the summary is keyed to the
same image id), the single-visible-window claim beyond the synthetic rehearsal,
the four prior reconciliations by recount, and the gateway's SNI admission code
(topology only).

Condition: commit the corrected documentation. Met by the commit that records
this report; no runtime change was required.

## 10. Residual uncertainty

1. Hop 2 is proven offline against the pinned SDK and synthetic responses, not
   live. A third redirect is refused, not observed; whether the provider's hop-2
   response is final remains UNPROVEN until an authorized G5-A attempt.
2. A double kill (viewer and guard together) is covered only by the launcher's
   next-start sweep; the sweep was not exercised end-to-end on the final bytes.
   It cannot leave a copy the Operator must hunt for in the rehearsed modes, but
   it is a disclosed residual.
3. The attempt handover relies on the stale viewer's ≈1 s tick before it notices
   the owner change. The new window never shows the old QR and the old window
   never shows the new one in the rehearsal, but sub-second overlap is possible.
4. The read-only preflight sampled 0 or 1 idle application database sessions on
   different runs (`app_quiesce_required=1` only when the sample is non-zero):
   the idle pool connection is not stable. The execute path stops the application
   and proves zero other sessions before sending, either way.
5. The connector is staged, not launched. Deployment of a new image generation is
   complete only when the connector is started inside a new Owner-authorized
   G5-A window.
6. The gateway was recreated during this deployment; its pre-deployment log is
   preserved only in evidence. The wrapper's baseline proves nothing changed
   after `08:44:57Z`, not that the old log said what the earlier evidence says.

## 11. Terminal verdict

**G5A_TWO_HOP_DEPLOYED_RECONCILIATION_AWAITING_OWNER_START** — the reviewed
two-hop connector is deployed in the private pilot configuration, verified by
identity and by extraction of the compiled policy, with the four-host allowlist
and the gateway boundary unchanged; the QR viewer was accepted with one
controlled synthetic rehearsal and no copy remains; the fence is intact at
`uncertain` epoch 9, gap 9, and the epoch 9→10 reconciliation is prepared but not
executed.

No provider contact, no real QR or Zalo login, no reconciliation execution, no
observe/send/media, no additional provider host, no production deployment, no PR
merge and no automatic retry occurred.
