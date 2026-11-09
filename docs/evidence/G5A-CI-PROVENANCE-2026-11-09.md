# G5-A — Owner edge-network acceptance, CI provenance closure and final offline readiness

Date: 2026-11-09 (UTC). Repository `kha997/zalo-shared`, branch `feat/shared-inbox`, PR #3
(open, draft). This record is the evidence for the directive *"Owner G5-A network
acceptance & CI provenance closure"*. No QR was generated, no provider was contacted, no
live grant was issued and nothing was merged.

## 1. Authorization and scope

Authorized: record the Owner's explicit acceptance of the application edge-network posture
for the private G5-A pilot; close the remaining CI image-provenance condition; verify final
offline readiness. Not authorized and not done: any live G5-A stage, G5-B observe, G5-C
send, production deployment, PR merge, security waiver, or automatic live grant.

## 2. Owner acceptance of the application edge-network posture

The Owner explicitly accepted the reviewed application edge-network posture **for the
private G5-A pilot only**. As deployed, the application container joins
`zalo-shared-pilot-app_pilot-edge` (a non-internal bridge, so the namespace has an outbound
default route) plus `zalo-shared-pilot-db` (internal), and publishes only
`127.0.0.1:3100`. The acceptance rests on the application holding no Zalo SDK, no provider
credential, no QR payload and no authenticated provider session, with the connector isolated
behind the dedicated egress gateway admitting only the four reviewed provider hosts.

Scope limits recorded with the acceptance: it does **not** extend to G5-B, G5-C,
production or any wider deployment, and it was not used to change the topology. The
posture is byte-for-byte the one reviewed; any widening (an extra non-internal attachment,
a second published port, a public bind, or provider reachability from the app namespace)
falls outside it and needs a new Owner decision.

Recorded in [PILOT-GATE-STATUS.md](../../PILOT-GATE-STATUS.md) and in
[G5A-PATCHED-PILOT-DEPLOYMENT-2026-11-09](G5A-PATCHED-PILOT-DEPLOYMENT-2026-11-09.md)
§13.3 and §15 (carried condition (a), now satisfied).

## 3. What `PRIVATE-PILOT.md` requires

`docs/operations/PRIVATE-PILOT.md` makes the **CI-built connector image digest recorded in
the pipeline** the trust anchor for a grant, and requires that this recorded digest — not a
local build — be the artifact deployed for a live stage. The image's own
`/app/build-identity.json` is build-derived, not a cryptographic attestation, and the
runtime cannot attest its own provenance.

Before this work the pipeline built, scanned and asserted the image, then published only
evidence text. No image left the run, so the artifact that was staged for the pilot was a
local build whose digest no run could vouch for. That was the open condition.

## 4. The change that closes it

Three commits on `feat/shared-inbox`:

| Commit | Change |
| --- | --- |
| `8a1e68c` | Pilot job gains `SOURCE_SHA` = PR head SHA (or `github.sha` on push), builds with `SOURCE_COMMIT=$SOURCE_SHA`, exports the exact image (`docker save`), records its id, its archive sha256 and a self-describing manifest, and uploads them as the `pilot-connector-image` artifact. |
| `b5ead06` | Checkout uses `ref: ${{ github.event.pull_request.head.sha \|\| github.sha }}` and the job asserts `HEAD == SOURCE_SHA`. Actions checks out the `pull_request` merge commit with a one-commit history, so the reviewed head was not even in the clone. Merge-result validation still runs in the `test` job. |
| `1052466` | `ops/g5-synthetic-manifest.ts` and `ops/ci-pilot-manifest.ts` prefer `SOURCE_SHA` over `GITHUB_SHA`. The offline G5 preflight compares the manifest's `sourceCommit` with the image's embedded identity, and `GITHUB_SHA` on a PR is the merge commit, so the preflight denied the image built from the reviewed commit. |

Two earlier runs of the workflow (`42601700384` at `8a1e68c`, `42602047981` at `b5ead06`)
were cancelled after the failing job; neither published a `pilot-connector-image` artifact,
so exactly one CI-built connector image exists for this branch.

The provenance policy was not relaxed: the export step only adds an artifact, `SOURCE_SHA`
makes the embedded identity name a commit that survives the ephemeral merge commit, and the
existing scan and identity assertions still gate the job.

## 5. CI run and artifacts

- Run [42602520323](https://github.com/kha997/zalo-shared/actions/runs/42602520323),
  event `pull_request`, attempt 1, `2026-11-09T10:39:52Z` → `10:44:25Z`, **success**.
- Head `10524666274704daa8e940a9ddad13719a56a967`, tree
  `5240d624476e3a037155d87af25b2925372f0f35`; the job's own record
  (`connector-source-tree.txt`) states `checked_out` = `SOURCE_SHA` = that commit.
- Jobs: `test` success, `pilot` success (17 steps).
- Artifacts: `pilot-connector-image` 58,949,161 B (id 13665754859),
  `pilot-connector-evidence` 1,551,048 B, `synthetic-validation-evidence` 1,647,140 B.
- Builder base pinned `node@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df`.
- In-run assertions that passed: offline dry-run admitted; G5 `bootstrap`/`observe`/
  `send-test` preflights admitted and the out-of-scope manifest denied; connector scan gate;
  gateway boundary and allow-path harness; build identity equal to `SOURCE_SHA`, the lock
  sha256 and the lock's `zca-js` integrity.

## 6. What the downloaded artifact was checked against

`pilot-connector-image` was downloaded and verified locally:

| Check | Result |
| --- | --- |
| `sha256(connector-image.tar)` vs the run's `connector-image-sha256.txt` | **PASS**, `a9d2f2440ead231c5b86e5975ce262554a1bb454bdd0bfd4b885794ed701cb76` (166,074,880 B) |
| Archive config blob content hash vs its own content-addressed filename | **PASS**, `sha256:5ab893f7…de563` |
| Loaded image config vs the run's `connector-image-inspect.json` | **PASS**: all 29 layer diffIDs, `Created`, `User`, `Entrypoint`, `Cmd`, `Env`, `ExposedPorts` identical |
| Image build identity read from inside the image | **PASS**: `version 1`, `sourceCommit 1052466…`, `lockSha256 17dcd254…030c9b`, `sdkIntegrity sha512-pBU0T0/…x4pgA==` — equal to the run's manifest and to the connector lock |
| Runtime surface | **PASS**: uid 65532, `zca-js 2.2.0` resolved from `/app/node_modules`, `crypto-js 4.2.0`, no exposed ports, `privateFiles: []` |
| Gate scan with the reviewed `ops/pilot-scan.sh` (Trivy 0.76.1, DB UpdatedAt 2026-11-09T00:56:17Z) | **PASS**, exit 0, **0 HIGH/CRITICAL** |
| A/B/C redirect diagnostics compiled into the image | **PASS**: the eight-class vocabulary equals `server/pilot-diagnostic.ts` and includes `unexpected-redirect`, `redirect-after-hop`, `direct-redirect-host` and `malformed-redirect` |

### Image-id semantics (why `.Id` is not compared across the boundary)

The runner reports `Id` as the **config digest** (`sha256:5ab893f7…`), while `docker load`
on this host installs into the containerd image store, which reports `Id` as the **manifest
digest** (`sha256:f54f760b1d11a59784e143726ae0f8a177130bb0d34788e2b9da888c79b18903`).
`docker load` also rebuilds the manifest, so `Id` equality across a save/load boundary is
not a meaningful test. The provenance link is therefore the archive sha256 recorded by the
run, the config-blob digest, and the 29 content-addressed layer diffIDs — all of which
match. Recorded digests:

- CI run image id (config digest, as the run recorded it): `sha256:5ab893f7fdc627d92ab10136234e2a8da75c0e57cf822b980c6058768c6de563`
- Artifact archive: `a9d2f2440ead231c5b86e5975ce262554a1bb454bdd0bfd4b885794ed701cb76`
- Local deployed digest after load (manifest digest): `sha256:f54f760b1d11a59784e143726ae0f8a177130bb0d34788e2b9da888c79b18903`

## 7. Staging for the private pilot

- Verified artifact tagged `zalo-shared-connector:g5-ci-1052466`; both that tag and
  `zalo-shared-connector:ci` resolve to the loaded digest.
- Private topology interpolation updated from `g5-patched-af2be54` to
  `zalo-shared-connector:g5-ci-1052466`; the previous file is preserved as
  `pilot-interpolation.pre-g5-ci-20261109.env` (outside the repository).
- `docker compose config` resolves `pilot-connector` to that image with networks
  `pilot-db` + `pilot-egress` and **no published ports**; no connector container was
  created or started. Prior probe containers are gone; `docker ps -a` shows none.
- Gateway image and application image are unchanged
  (`zalo-shared-egress-gateway:g5-patched-af2be54` `sha256:f75c2e8a…`,
  `zalo-shared:g5-patched-af2be54` `sha256:989c6154…`); those two are not grant-bound and
  their provenance is unchanged from the deployment record, which discloses that they are
  local builds.

## 8. Grant-image binding

`server/pilot-policy.ts` requires `manifest.grant.sourceCommit`, `lockSha256` and
`sdkIntegrity` to equal the image's embedded build identity exactly. The staged connector
embeds `sourceCommit 10524666274704daa8e940a9ddad13719a56a967`. A live bootstrap grant
must therefore be generated against that commit — for example with
`SOURCE_SHA=10524666274704daa8e940a9ddad13719a56a967` — not against whatever the branch
head is at the time. Commits after `1052466` in this directive add only evidence documents,
so the artifact still describes the reviewed product source; the delta is
`git diff 1052466..<evidence-head> --stat`, which touches `docs/` and `PILOT-GATE-STATUS.md`
only.

Offline proof of both directions at `1052466`, against the previously staged connector
image: a manifest bound to that image's identity is `admitted` (exit 0); a manifest bound to
a different commit is `denied` (exit 1). The check is not vacuous.

## 9. Readiness checklist (§5)

| Condition | Result |
| --- | --- |
| Application healthy | **PASS** `zalo-shared-pilot-app-1`, image `sha256:989c6154…`, healthy, 0 restarts, `/health/ready` HTTP 200 |
| Gateway healthy | **PASS** `zalo-shared-pilot-egress-gateway-1`, image `sha256:f75c2e8a…`, healthy, 0 restarts, no published port |
| Four-host allowlist unchanged | **PASS** `GATEWAY_ALLOW_HOSTS=id.zalo.me,wpa.chat.zalo.me,jr.chat.zalo.me,chat.zalo.me` |
| Connector carries A/B/C redirect diagnostics | **PASS** §6, eight-class vocabulary matches source |
| Automatic Windows QR viewer with a synthetic fixture | **PASS** `qr-viewer.ps1` shown in session 1 at 480x600, cleanup final, no staged copy; corrupt and truncated PNGs refused with exit 4; verdict `PASS` |
| Ownership | **PASS** `idle`, epoch **6**, owner null, last fenced pair `7cc878cf…`/5 preserved |
| Provider state | **PASS** `disconnected`, gap **6**, `reconciliation_required=false` |
| No authenticated Zalo session | **PASS** `sessions=0`, no `session.enc` under the private pilot tree |
| No connector or unresolved work | **PASS** no connector container; messages, outbox, delivery parts, provider events, media jobs all 0 |
| Database TLS | **PASS** `DATABASE_URL` carries `sslmode=verify-full`, host `pilot-db`, CA via `NODE_EXTRA_CA_CERTS=/run/pilot/db-ca.crt` |
| HIGH/CRITICAL image findings | **PASS** connector 0 (§6); application and gateway 0 per the deployment record, unchanged images, unchanged Trivy DB |
| No live grant | **PASS** both private grants expired `2026-11-07T00:09:00Z` / `00:18:00Z`; `PILOT_MANIFEST_FILE` still points at a synthetic manifest |
| Accepted edge posture not expanded | **PASS** app networks are still `pilot-edge` (non-internal) + `pilot-db`; single `127.0.0.1:3100` publish; `pilot-db` and `pilot-egress` internal, `pilot-uplink` non-internal and gateway-only |
| Audit | `26` rows, unchanged since the deployment proof's login/logout pairs; `users=1`, admin only |

## 10. Residual risks and UNPROVEN items

1. **UNPROVEN — live behaviour.** No QR, login, UID binding, session, observe or send. The
   redirect diagnostics are present in the artifact and proven offline, not on the wire.
2. **No cryptographic attestation.** The pipeline records the digests it built and the
   artifact it exported, and those were checked end to end here, but there is no cosign or
   SLSA signature. The trust anchor is the CI run's record — exactly what
   `PRIVATE-PILOT.md` prescribes — which means a compromised CI runner would not be
   detectable from the artifact alone. Within that limit the chain is complete.
3. **Archive-and-run hashes come from the same run.** Comparing the downloaded archive to
   `connector-image-sha256.txt` proves internal consistency and detects transport damage; the
   independent anchors are the reviewed workflow at a pinned action SHA, the build identity
   derived from `connector/package-lock.json`, and the layer content hashes.
4. **Artifact retention is 14 days.** The archive is not pushed to a registry. If a live
   stage is authorized after expiry, either re-run the workflow from `1052466` or keep a
   private copy; the staged tag on this host is the durable local artifact.
5. **Digest naming.** The grant binds by build identity, not by digest; the digest recorded
   by the run is the config digest, while the local deployed reference is the manifest
   digest. Both are recorded in §6 so a later reproduction cannot silently pick the wrong
   one.
6. **`crypto-js@4.2.0`** remains deprecated and transitively required by `zca-js@2.2.0`.
7. The 46 MEDIUM/LOW findings per image disclosed in the deployment record are unchanged and
   below the Owner's HIGH/CRITICAL bar; no waiver is in force and the expired zlib
   disposition stays expired and unused.
8. **App/gateway images are still local builds.** They are not grant-bound, their digests and
   scans are recorded, and `PRIVATE-PILOT.md`'s CI-origin anchor is written for the connector
   image; this record does not claim CI provenance for them.

## 11. Evidence index

- This record; `PILOT-GATE-STATUS.md`.
- Workflow and generator changes: `.github/workflows/ci.yml`, `ops/ci-pilot-manifest.ts`,
  `ops/g5-synthetic-manifest.ts` at `1052466`.
- Run artifacts: `pilot-connector-image` (archive + id + sha256 + manifest + inspect),
  `pilot-connector-evidence` (`connector-source-tree.txt`, `connector-image-inventory.json`,
  `ci-g5-preflight-*.json`, `ci-pilot-dry-run.json`, scans, boundary harness results),
  `synthetic-validation-evidence`.
- Local verification output: `g5a-ci-verify-2026-11-09.log` (tool output summarized in §6),
  `g5a-ci-diagnostics.json`.
- Prior deployment evidence: `G5A-PATCHED-PILOT-DEPLOYMENT-2026-11-09.md`,
  `G5A-SECURITY-GATE-RENEWAL-2026-11-09.md`.
