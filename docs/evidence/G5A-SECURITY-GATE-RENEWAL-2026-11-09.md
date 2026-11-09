# G5-A security gate reassessment (2026-11-09)

**Directive:** `ZALO SHARED — OWNER DIRECTIVE: RENEW G5-A SECURITY GATE`.
**Scope granted:** read-only assessment, evidence collection and preparation of a renewal. No new
disposition is activated, no provider is contacted, no QR is generated and nothing is deployed or
merged under this record.
**Verdict token:** `G5A_SECURITY_GATE_PATCHED_NO_EXCEPTION_NEEDED`.

**Why this token:** the directive's item 9 says a verified patch takes precedence over renewing the
exception. Debian trixie-security has shipped `zlib1g 1:1.3.dfsg+really1.3.1-1+deb13u1` for both
CVEs, the supported distroless `nodejs24-debian13` base now carries that package, and all three
project images rebuilt from the pinned base scan with **0 HIGH/CRITICAL**. A new time-boxed
disposition is therefore neither needed nor created.

**Clock:** all checks ran between `2026-11-09T06:30Z` and `2026-11-09T06:45Z` (host clock read as
`2026-11-09T06:39:39Z`). The expired disposition's cut-off was `2026-11-09T00:00:00Z`; it is past.

## 1. The expired disposition cannot be reused

`ops/g5a-cve-disposition.json` is unchanged: `expiresAt 2026-11-09T00:00:00Z`, schema 1, scope
`private-g5a-diagnostic`, entries `CVE-2026-76844` and `CVE-2026-85091` on
`zlib1g 1:1.3.dfsg+really1.3.1-1+b1`.

Evaluating it against the deployed image with the real clock:

```
$ env -u NODE_OPTIONS node ops/g5a-cve-disposition.cjs evaluate \
    --vulnerabilities docs/evidence/g5a-renewal-deployed-connector-container-vulnerabilities.json \
    --disposition ops/g5a-cve-disposition.json \
    --image-ref zalo-shared-connector:g5-diag-a2a7aa0 \
    --image-id sha256:390b87b634cfd18d9ea32ed28ec35d4d625b6c55ba89eb2fed82821264853141 \
    --scope private-g5a-diagnostic \
    --report docs/evidence/g5a-renewal-deployed-connector-container-vulnerabilities.json \
    --ledger docs/evidence/G5A-CVE-DISPOSITION-LEDGER.jsonl
g5a-cve-disposition: REFUSED disposition expired at 2026-11-09T00:00:00Z
evaluator_exit=3
```

The ledger still has its original three entries (`seq` 1–3, all `expiresAt 2026-11-09T00:00:00Z`); a
refused evaluation appends nothing. There is no `--now` flag, no scope widening and no ignore file
anywhere in the tree.

## 2. Base image availability (directive item 3)

`gcr.io/distroless/nodejs24-debian13` is the supported runtime base for all three Dockerfiles.
Resolved today:

| Reference | Digest | Contents |
| --- | --- | --- |
| `nodejs24-debian13` tag (`:latest`) | `sha256:b770c59f44ed459329508a73794e6d284f6c10143f83c8012a8f775cd514eca2` | Debian 13.7, Node v24.22.2, `zlib1g …+deb13u1` |
| previous pin (still resolvable) | `sha256:cb606325b7ec4af55462cb0b424a53b452a5b4a894ffe841fcf1048d216fb9f8` | Debian 13.7, Node v24.22.1, `zlib1g …-1+b1` |
| patched amd64 manifest | `sha256:a23422cc0dee3bbd0f080b2840e20df4727f60f3dda7c860fe9a127822711b1e` | linux/amd64 |
| patched arm64 manifest | `sha256:791e76a892c63f29c499b7113c9fe579ac7780ecbb05e4ba3c71870594f2ded5` | linux/arm64/v8 |

The patched base is the **current** published `nodejs24-debian13` image, not a private build.

Debian security tracker (read 2026-11-09):

| CVE | Trixie status | Fixed version |
| --- | --- | --- |
| CVE-2026-76844 (zlib heap overflow) | fixed | `1:1.3.dfsg+really1.3.1-1+deb13u1` |
| CVE-2026-85091 (heap buffer overflow, `gz_vacate()`) | fixed | `1:1.3.dfsg+really1.3.1-1+deb13u1` |

## 3. Deployed state (directive items 1, 2, 4)

Scanner: Trivy 0.76.1, vulnerability DB v2 updated `2026-11-09 00:56:17Z`. Reports:
`docs/evidence/g5a-renewal-deployed-*.json`.

| Image | Tag | Index digest | Config digest | Node | zlib1g | HIGH/CRITICAL |
| --- | --- | --- | --- | --- | --- | --- |
| Connector | `zalo-shared-connector:g5-diag-a2a7aa0` | `sha256:390b87b634cfd18d9ea32ed28ec35d4d625b6c55ba89eb2fed82821264853141` | `sha256:4d6cc120795b3ba6cc15d98e2690adb61d50ef62311573673c24ea93ef536dd8` | v24.22.1 | `1:1.3.dfsg+really1.3.1-1+b1` | 2 |
| Application | `zalo-shared-g2-app:latest` (running `zalo-shared-g2-app-1`) | `sha256:9d3454015db1d8c6558c2d461fde86a2f71de0a26193d997432352115a890d65` | `sha256:0711c74a8c4c82ed5a3eeef08856f832cd997c2caf2d62f5db0095448973990c` | v24.22.1 | `1:1.3.dfsg+really1.3.1-1+b1` | 2 |
| Gateway | `zalo-shared-egress-gateway:g5-local` (running) | `sha256:bfde5c7a96ca7155473ee305a96b51b05eb3d7ac680c27ba37250fdc85ad4e75` | `sha256:78532fa6ce182fb1f83b491976f592eee7c58fa9cb9226a4e47cc2538f205692` | v24.22.1 | `1:1.3.dfsg+really1.3.1-1+b1` | 2 |

Every deployed image reports exactly the same two findings, unchanged in package, installed version
and distribution (Debian 13.7) from the 2026-11-07 assessment:

| CVE | Package | Installed | Fixed | Severity |
| --- | --- | --- | --- | --- |
| CVE-2026-76844 | zlib1g | `1:1.3.dfsg+really1.3.1-1+b1` | `1:1.3.dfsg+really1.3.1-1+deb13u1` | HIGH |
| CVE-2026-85091 | zlib1g | `1:1.3.dfsg+really1.3.1-1+b1` | `1:1.3.dfsg+really1.3.1-1+deb13u1` | HIGH |

No other HIGH or CRITICAL finding appears on any of the three images (including OS and Node
package scans). Exploit reachability is unchanged and re-measured on the deployed connector:

- Node maps 8 shared objects; none is `libz`/`zlib`.
- No `.node` native addon exists under `/app/node_modules`.
- Node bundles zlib statically; the packaged `zlib1g` is not loaded by any process.

## 4. Patched state at `af2be54` (directive item 9)

`ops/Dockerfile`, `ops/Dockerfile.connector` and `ops/Dockerfile.gateway` now pin
`ARG RUNTIME_IMAGE=…@sha256:b770c59f…` (commit `b3dab20`, three changed lines, nothing else).
All three images were rebuilt from the clean tree at `af2be54` with
`--build-arg SOURCE_COMMIT=$(git rev-parse HEAD)`.

| Image | Tag | Index digest | Config digest | Node | zlib1g | HIGH/CRITICAL |
| --- | --- | --- | --- | --- | --- | --- |
| Connector | `zalo-shared-connector:g5-patched-af2be54` | `sha256:7ae6f66f83cff604b762b2c9c28256e3857baca075819d75b9fa1b1b84b1704f` | `sha256:0664e4415e2c42795a1000111fd21270cfa2e4050a182168d347fafc6538e786` | v24.22.2 | `1:1.3.dfsg+really1.3.1-1+deb13u1` | **0** |
| Application | `zalo-shared:g5-patched-af2be54` | `sha256:989c61541cc95931bef1bd223934032f6d42b5937ff78de62b5e451dc0fbe824` | `sha256:1ea4f33303c886ccac875a37a4edfb96a14f563ce09df7c2de41d51230272294` | v24.22.2 | `1:1.3.dfsg+really1.3.1-1+deb13u1` | **0** |
| Gateway | `zalo-shared-egress-gateway:g5-patched-af2be54` | `sha256:f75c2e8aad3e6eaa1a9f987a20e3b2738f074c257f20d0ca345cb537a4f5d4c9` | `sha256:e22966554d8c44915dce20c456a91671cd89f3d320b8493a07e470d909a18165` | v24.22.2 | `1:1.3.dfsg+really1.3.1-1+deb13u1` | **0** |

The packaged zlib version was read from `/var/lib/dpkg/status.d/zlib1g` inside each image, not
inferred from Trivy metadata.

Per-image reassessment (directive item 5):

- **Connector** — `ops/pilot-scan.sh zalo-shared-connector:g5-patched-af2be54
  g5a-renewal-patched-connector` exits **0**: 0 HIGH/CRITICAL, UID 65532, zca-js 2.2.0 resolved,
  crypto-js 4.2.0, no exposed ports, no private files, embedded build identity
  `sourceCommit=af2be54…` matching. Reachability unchanged: 8 shared objects, no `libz`, no native
  addons.
- **Application** — `ops/scan-image.sh zalo-shared:g5-patched-af2be54 …` exits 0 with 0 findings
  and OS 13.7; the image still stays SDK-free.
- **Gateway** — same scanner, 0 findings, OS 13.7.

Repository changes since `1aa35f3` are only the three digest pins (`b3dab20`) and the raw scan
evidence (`af2be54`). No scan script, CI workflow, allowlist or suppression file was modified; no
`.trivyignore` exists in the tree.

## 5. Unfiltered gate remains visible (directive item 6)

The gate counts every HIGH/CRITICAL independently of Trivy's own exit status and has no exclusion
list. Run today on the same scanner and DB:

| Image | Gate result |
| --- | --- |
| `zalo-shared-connector:g5-diag-a2a7aa0` (deployed) | **exit 1** — `High/critical connector image vulnerabilities remain` (2) |
| `zalo-shared-connector:g5-patched-af2be54` | exit 0 (0) |

So the deployed artifact stays visibly blocked by the repository's own gate; the patched artifact
passes it. Nothing is suppressed.

## 6. Offline verification at `af2be54` (directive items 10, 11)

| Check | Result |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm test` (backend + transport) | 403/403 pass, 0 fail, ~55 s |
| A/B/C redirect diagnostics (`tests/transport/sdk-redirect*.test.ts`) | 40/40 pass |
| Automatic Windows QR viewer rehearsal (synthetic fixture, Session 1) | PASS — valid fixture shown 480x600, corrupt and truncated PNGs refused (`invalid-png`, exit 4), no staged copy remains, log line ≤ 107 chars |
| Connector build identity | `sourceCommit=af2be54db767ff703f7c4db8580739efd50b401a`, lock and SDK hashes match |
| Pilot ownership | `epoch 6`, `phase idle`, `owner_id NULL`, `last_fenced_owner_id 7cc878cf-…`, `last_fenced_epoch 5` |
| Provider state | `disconnected`, `reconciliation_required false`, `gap_version 6` |
| Pending work | outbox 0, messages 0, delivery_parts 0, sessions 0, attachments 0, pilot_send_budget 0, provider_media_jobs 0, provider_events 0 |
| Connector container | none active or stopped |
| Gateway | healthy, unchanged image `g5-local` |
| Diagnostic sink | 15 lines, `sha256 43fc4212c8cfe0b07be193ff44b33e1830a6291e91ff0f7f214db54245080543…`, unchanged |

No real Zalo connection, QR, login, session, customer data or merge occurred.

## 7. Decision

1. **No new disposition record is created.** Item 9 of the directive makes a verified patch
   preferable to a renewed exception, and the patch is verified for all three images.
2. **The expired disposition stays expired.** `ops/g5a-cve-disposition.json` is not edited, not
   extended, not deleted; the evaluator refuses it with exit 3.
3. **Nothing is deployed or merged.** The patched images are built and scanned locally only. PR #3
   remains draft.
4. **Proposed expiry:** not applicable — no exception is proposed. If the Owner nevertheless wants a
   residual exception (for example to run the pilot on the *deployed* image before redeploying), it
   needs a fresh directive; this record does not grant one.

## 8. Owner handoff

Redeploying the patched artifacts is an Owner decision and was deliberately not performed. If the
Owner approves, the sequence is:

```bash
# 1. Confirm the exact artifacts
docker inspect -f '{{.Id}}' \
  zalo-shared-connector:g5-patched-af2be54 \
  zalo-shared:g5-patched-af2be54 \
  zalo-shared-egress-gateway:g5-patched-af2be54
# expected: 7ae6f66f…704f, 989c6154…e824, f75c2e8a…d4c9

# 2. Re-run the gates on the exact tags
bash ops/pilot-scan.sh zalo-shared-connector:g5-patched-af2be54
bash ops/scan-image.sh zalo-shared:g5-patched-af2be54
bash ops/scan-image.sh zalo-shared-egress-gateway:g5-patched-af2be54

# 3. Deploy the topology with the new connector image, then verify
PILOT_CONNECTOR_IMAGE=zalo-shared-connector:g5-patched-af2be54 \
PILOT_EGRESS_GATEWAY_IMAGE=zalo-shared-egress-gateway:g5-patched-af2be54 \
  bash ops/local/deploy-pilot-topology.sh
PILOT_CONNECTOR_IMAGE=zalo-shared-connector:g5-patched-af2be54 \
PILOT_EGRESS_GATEWAY_IMAGE=zalo-shared-egress-gateway:g5-patched-af2be54 \
  bash ops/local/verify-deployed-pilot.sh
```

Deploying the connector image still needs an active manifest/grant and a separate Owner start
authorization; the security patch alone does not authorize a live stage.

## 9. Remaining risks

- `crypto-js@4.2.0` is deprecated and pulled transitively by `zca-js@2.2.0`; unchanged by this work.
- Unofficial-client behavior and account restrictions remain UNPROVEN until an approved live pilot.
- The scan is a package/severity scan, not proof that no exploit path exists; it shows the two
  reported HIGH findings are absent from the patched images.
- The patched images were built on this host, not by CI; the trust anchor for any live stage remains
  the CI-built digest recorded with the grant, as documented in
  `docs/operations/PRIVATE-PILOT.md`.
- The running application container (`zalo-shared-g2-app-1`) and gateway still use the old base.
  They must be redeployed from the patched tags before they stop reporting the two findings.

## 10. Independent review

Recorded in section 11 after review of this document and the enforcement claims.

## 11. Review record

_Pending._
