# G5-A patched pilot deployment — 2026-11-09

## 1. Authorization and scope

Owner directive: **ZALO SHARED — OWNER AUTHORIZATION: PATCHED PILOT REDEPLOYMENT**
(`PATCHED PRIVATE PILOT DEPLOYMENT AND OFFLINE ACCEPTANCE ONLY`). The Owner approved
deploying the independently reviewed, security-patched image generation to the dedicated
local G5-A pilot using the patched Debian 13 distroless Node 24 base pinned by digest, with
no CVE waiver, override or scanner suppression, and limited the work to private pilot
deployment and offline verification. Real Zalo authentication was not authorized.

Base branch `feat/shared-inbox`, `HEAD` `f84fea4`, PR #3 open and draft. No product source
changed after `af2be54`: `git diff --stat af2be54..HEAD -- server client ops/Dockerfile
ops/Dockerfile.connector ops/Dockerfile.gateway` is empty, so the reviewed artifact
generation and the reviewed sources are the same code.

No real QR was generated, no provider was contacted, no live authentication, observe or
send-test ran, nothing was merged and no ownership or reconciliation row was altered.

## 2. Pre-deployment state (verified before the first container action)

| Check | Observed |
| --- | --- |
| Ownership | `phase idle`, `epoch 6`, `owner_id NULL`, `last_fenced 7cc878cf-…/5` |
| Provider state | `disconnected`, `reconciliation_required false`, `gap_version 6` |
| Pending work | messages 0, outbox 0, delivery parts 0, budget 0, media jobs 0, provider events 0 |
| Users / sessions | 1 admin, 0 sessions |
| Session material | no `session.enc` in `/home/zen/pilot-private/zalo-shared/pilot/state` |
| Connector | no container running or stopped |
| Database | `pilot-postgres` healthy on `zalo-shared-pilot-db` (`internal=true`), TLS `verify-full` |
| Gateway | healthy, four-host allowlist, only member of `pilot-uplink` |

## 3. Deployed artifacts

All three images run Node `v24.22.2` on runtime base
`gcr.io/distroless/nodejs24-debian13@sha256:b770c59f44ed459329508a73794e6d284f6c10143f83c8012a8f775cd514eca2`
and package `zlib1g 1:1.3.dfsg+really1.3.1-1+deb13u1`, which is the Debian 13 release that
carries the fix for the two findings raised against the previous base. The two CVEs that
made an exception necessary are therefore absent, not waived.

| Artifact | Tag | Image digest | Runtime identity |
| --- | --- | --- | --- |
| Application | `zalo-shared:g5-patched-af2be54` | `sha256:989c61541cc95931bef1bd223934032f6d42b5937ff78de62b5e451dc0fbe824` | node 24.22.2, zlib1g `…deb13u1` |
| Gateway | `zalo-shared-egress-gateway:g5-patched-af2be54` | `sha256:f75c2e8aad3e6eaa1a9f987a20e3b2738f074c257f20d0ca345cb537a4f5d4c9` | node 24.22.2, zlib1g `…deb13u1` |
| Connector | `zalo-shared-connector:g5-patched-af2be54` | `sha256:7ae6f66f83cff604b762b2c9c28256e3857baca075819d75b9fa1b1b84b1704f` | node 24.22.2, zlib1g `…deb13u1`, uid 65532 |

Connector build identity inside the image: `sourceCommit af2be54db767ff703f7c4db8580739efd50b401a`,
`lockSha256 17dcd254…030c9b`, `sdkIntegrity sha512-pBU0T0/…x4pgA==`, `zca-js 2.2.0`,
`crypto-js 4.2.0`. The connector artifact is staged for on-demand `docker compose run`
exactly as the reviewed topology intends; **no connector container was created or started.**

Deployed container image references equal those digests (`docker inspect -f '{{.Image}}'`):
app `sha256:989c6154…e824`, gateway `sha256:f75c2e8a…d4c9`.

## 4. Deployment sequence (UTC, 2026-11-09)

| Time | Action |
| --- | --- |
| 08:01:22 | Pilot application created and started (`zalo-shared-pilot-app-1`), healthy |
| 08:02–08:03 | Reviewed admin authentication proof, first run (see §6) |
| 08:03:25 / 08:04:23 | Gateway recreated on the patched image; healthy after the verification stop/start |
| 08:06:32 | Automatic Windows QR viewer rehearsal, synthetic fixture only |
| 08:06:59 | Full offline suite finished: 403/403 |
| 08:17:33–08:17:39 | Unfiltered scans of all three deployed images, no severity flag |
| 08:19:30–08:19:42 | Verification re-run captured as evidence: admin proof 22/22, boundary 25/25, deployed topology 48/48 |

### Application deployment

`ops/local/deploy-pilot-app.sh` renders the reviewed `ops/pilot-app-compose.example.yml`
into a private path and starts the app against the pilot database. The service is the same
hardened app service as `ops/compose.yaml` — uid 65532, read-only root, `cap_drop ALL`,
`no-new-privileges`, `init`, `restart unless-stopped`, provider disabled — with two pilot
differences:

- `DATABASE_URL` targets `pilot-db:5432/zalo?sslmode=verify-full`; the private pilot CA is
  mounted read-only and trusted through `NODE_EXTRA_CA_CERTS`.
- The app joins the internal `zalo-shared-pilot-db` network plus one project-scoped
  non-internal bridge (`zalo-shared-pilot-app_pilot-edge`) whose only member it is, because
  Docker cannot publish a port for a container attached solely to an internal network.
  The only published surface is `127.0.0.1:3100 -> 3100/tcp`.

Secrets are generated or read into a `0600` private env file outside the repository; no
value appears in argv, logs or this record. `METRICS_TOKEN` is generated once and stored
`0600` beside it.

The script refuses to act unless the tag resolves to the reviewed image ID, which was
verified after the fact as well: the deployed container's `{{.Image}}` and the tag's
`{{.Id}}` are both `sha256:989c6154…e824`. A re-tag of that name cannot silently deploy a
different artifact.

### Gateway deployment

`ops/local/deploy-pilot-topology.sh` re-rendered the private compose copy and recreated only
the gateway. The reviewed allowlist is unchanged and exact:
`id.zalo.me,wpa.chat.zalo.me,jr.chat.zalo.me,chat.zalo.me`, bound to `172.16.29.10:443`,
uplink membership exactly the gateway, no published port, `ip_forward 0`.

## 5. Application health: diagnosis and resolution

The reported unhealthy container was `zalo-shared-g2-app-1`, the earlier G2 loopback stack,
not the pilot. Independent diagnosis:

- `/health/live` answered 200 while `/health/ready` answered 503, so the process and HTTP
  layer were alive and only the database probe failed.
- Its dependency `zalo-shared-g2-postgres-1` exited 127 on 2026-11-04T06:37:42Z with
  `runc create failed … error mounting "/run/desktop/mnt/host/wsl/docker-desktop-bind-mounts/
  Ubuntu-24.04/8f8d561afa7b…" to rootfs at "/docker-entrypoint-initdb.d/10-runtime-role.sh":
  not a directory`. The bind source is a Docker Desktop proxy path for
  `ops/init-runtime-role.sh` that no longer exists after a Docker Desktop/WSL restart, so the
  database container could not be recreated and the healthcheck never recovered.
- Root cause: a stale G2 stage stack whose database container cannot start, running the
  unpatched image against a non-TLS database — not an application defect and not a
  healthcheck defect.

Resolution within the pilot scope: the patched application now serves the reviewed loopback
origin with the pilot database, and the stale G2 stack was isolated rather than deleted
(`zalo-shared-g2-app-1` stopped, `zalo-shared-g2-postgres-1` left exited). The named volume
`zalo-shared-g2_postgres-data` and both containers are untouched, so the earlier data and a
possible recovery remain available; restarting that stack is a separate Owner decision.

The healthcheck was not disabled or weakened: the deployed app keeps the reviewed exec-form
readiness probe against `/health/ready` (PostgreSQL `SELECT 1`), and the container reports
`healthy` with a successful probe log.

## 6. Application verification

| Check | Result |
| --- | --- |
| Docker healthcheck | `healthy`, readiness probe `{ok:true}` |
| `/health/live` from the host | 200 |
| `/health/ready` from the host | 200 |
| Client bundle | `/` returns 200 `text/html` (Vietnamese shell) |
| Listener scope | `127.0.0.1:3100` only; nothing on other interfaces |
| `/metrics` without a token | 401 |
| Database transport | `pg_stat_ssl`: `zs_app`, `ssl=t`, `TLSv1.3`, `TLS_AES_256_GCM_SHA384` |
| Database target | pilot database: 1 user, 1 admin, 0 sessions before and after |
| Authenticated admin proof | `ops/local/verify-pilot-admin-auth.mjs`, **22/22 checks pass**, output kept in `docs/evidence/g5a-deploy-admin-proof.json` |

The admin proof ran in a transient container sharing the deployed app's network namespace,
so the loopback-only base URL rule held. It verified: one admin baseline; unauthenticated
and forged sessions rejected; wrong password and unknown identity rejected; login issues an
`HttpOnly`, `SameSite=Strict`, non-`Secure` (HTTP loopback) cookie; a CSRF token is issued
and resolves back through `/api/auth/me`; a state change without CSRF is 403; a foreign
origin is 403; the reconciliation route rejects a malformed body with 400 before any
operation; the admin reads the fenced state (`idle`, epoch 6, gap 6,
`reconciliationRequired=false`); logout invalidates the session; ownership, provider and
delivery rows are byte-identical; no reconciliation row was added; exactly one admin
survives with no session; and only the login/logout audit rows were appended.

Three proof runs were made. The first used the harness's hardcoded incident-era
expectations (`uncertain`, epoch 1, zero historical reconciliation rows) and reported four
baseline mismatches while every security assertion passed. The harness now takes the
expected baseline from the caller with the observed values
(`PILOT_EXPECT_PHASE=idle`, `PILOT_EXPECT_EPOCH=6`,
`PILOT_EXPECT_RECONCILIATION_REQUIRED=false`, defaults unchanged), and asserts that no new
reconciliation row appears instead of requiring zero historical rows; the second run passed
22/22. A third run, whose JSON is the saved evidence, also passed 22/22 with the same
values. Only the login/logout rows were appended each time (audit 20 → 24 → 26); ownership,
provider and delivery rows were byte-identical throughout, `reconciled` stayed at 3, and
one admin survives with no session. The parameterization is not self-fulfilling: the
one-admin, unchanged-row, no-new-reconciliation and audit-append checks compare the API's
answer against literal values and against the before/after snapshots, so a drifted
baseline fails.

## 7. Network boundary and control state after deployment

| Check | Result |
| --- | --- |
| `ops/local/verify-pilot-network.sh` | **25/25 assertions PASS**, log in `docs/evidence/g5a-deploy-network-verifier.log` |
| `ops/local/verify-deployed-pilot.sh` (patched connector image) | **48/48 assertions PASS**, log in `docs/evidence/g5a-deploy-topology-verifier.log` |
| `zalo-shared-pilot-db` | `internal=true`; members `pilot-postgres`, `zalo-shared-pilot-app-1` |
| `zalo-shared-pilot_pilot-egress` | `internal=true`; member gateway only |
| `zalo-shared-pilot_pilot-uplink` | `internal=false`; member gateway only |
| `zalo-shared-pilot-app_pilot-edge` | `internal=false`; member app only |
| Published ports | app `127.0.0.1:3100`; gateway none; database none |
| Gateway log | startup only, zero admitted tunnels, zero provider SNI |
| Connector | no container exists |

After the evidence-capture re-run the gateway log holds nine lines: three `startup`, two
`shutdown`, four `sni_deny` (two `.test` fixtures from each verification run) and
**zero `sni_allow`**, so no provider contact occurred. The stop/start pair at 08:19:33 /
08:19:42 is the deployed-verification harness exercising the closed path.

Control state after all work: ownership `idle`, `epoch 6`, `owner_id NULL`, last fenced
`7cc878cf-…/5`; provider `disconnected`, `reconciliation_required false`, `gap_version 6`;
users 1, sessions 0, messages 0, outbox 0, delivery parts 0.

## 8. Deployed connector diagnostics (offline)

An in-image probe imported the deployed build (`/app/dist/connector/...`) with the image
entrypoint overridden, no network and an empty `NODE_OPTIONS`:

- `followableLocation` admits exactly `https://chat.zalo.me/…` and refuses a foreign host,
  plain HTTP and a malformed value (`null` for each).
- `safeDestinationHost("https://user:pass@chat.zalo.me/x?y=1")` returns `chat.zalo.me`;
  a malformed value returns `invalid`.
- Closed vocabularies present: redirect classes `unexpected-redirect`,
  `unexpected-location`, `redirect-after-hop`, `direct-redirect-host`, `stale-hop`,
  `malformed-redirect`, `invalid-target`, `not-admitted`; request categories
  `check-session`, `provider-direct`, `redirect-follow`, `other`.
- `pilot-reasons` (26 reasons/15 stages) and `private-pilot-files` (AES-GCM private session
  store, private QR view, confirmation prompt) are present.

Offline regressions: `tests/transport/sdk-redirect.test.ts` 5/5,
`sdk-redirect-policy.test.ts` 19/19, `sdk-redirect-diagnostics.test.ts` 16/16 — **40/40**,
covering the unexpected Location, additional redirect, direct redirect-host, malformed and
stale cases, denial without network, restricted diagnostic output and denial evidence
surviving exit.

The private diagnostic sink is unchanged: 15 lines,
`sha256 43fc4212c8fe0b07be193ff44b33e1830a6291e91ff0f7f214db54245080543`.

## 9. Automatic Windows QR presentation

`ops/local/rehearse-qr-viewer.sh --stage 'C:\Users\Admin\pilot-private-qr'` with synthetic
fixtures, run against the interactive desktop (Session 1):

| Case | Result |
| --- | --- |
| Valid fixture | shown, `visible=True`, `480x600`, window in session 1, staged copy removed |
| Corrupt PNG | refused as `invalid-png`, exit 4, no staged copy |
| Truncated PNG | refused, exit 4, no staged copy |
| Log line length | 107 characters maximum (no payload content) |

No real QR exists between attempts and none was created here.

## 10. Scans

The repository gates (`ops/scan-image.sh`, `ops/pilot-scan.sh`) report on HIGH/CRITICAL
only: Trivy is invoked with `--severity HIGH,CRITICAL` and `--exit-code 0`, and the gate
itself is the script's subsequent assertion that the summarised HIGH/CRITICAL count is
zero. Those runs are therefore **not** unfiltered, and the earlier draft of this section
that described them as unfiltered was wrong. They remain the gate record:
`g5a-deploy-app-scan-summary.json`, `g5a-deploy-gateway-scan-summary.json` and
`g5a-deploy-connector-image-scan-summary.json`.

To close that gap, all three deployed images were scanned again with no severity flag at
all (`trivy image --input <docker save> --scanners vuln --skip-db-update --exit-code 1`,
Trivy 0.76.1, database updated 2026-11-09T00:56:17Z):

| Image | Findings | Composition | HIGH/CRITICAL | Scanner exit |
| --- | --- | --- | --- | --- |
| Application | 46 | 34 MEDIUM, 12 LOW | **0** | 1 (findings exist) |
| Gateway | 46 | 34 MEDIUM, 12 LOW | **0** | 1 (findings exist) |
| Connector | 46 | 34 MEDIUM, 12 LOW | **0** | 1 (findings exist) |

Evidence: `docs/evidence/g5a-deploy-{app,gateway,connector}-unfiltered-vulnerabilities.json`
and `…-unfiltered-summary.json`. No ignore file, waiver, override, package exception or
severity suppression was used. The non-zero scanner exit is the honest result of an
unfiltered run and is recorded rather than worked around. The 46 findings are almost
entirely distroless-base and toolchain packages (`libc6` 22; `gcc-14-base`, `libgcc-s1`,
`libgomp1`, `libstdc++6` six each) and are disclosed here rather than waived. The Owner's
requirement is zero unresolved HIGH/CRITICAL, which holds in the unfiltered run.

Scan-to-artifact identity: Trivy records the archive's config-blob digest (`1ea4f33…` app,
`0664e441…` connector, `e2296655…` gateway), matching the config digests recorded at build
time; Docker's `RepoDigests` and `{{.Image}}` report the manifest digest (`989c6154…`,
`7ae6f66f…`, `f75c2e8a…`) for the same archives. `RepoTags` and the layer counts
(26/26/29) tie each report to the deployed artifact.

The earlier build-verification scans and these deployment scans are kept separate: the
repository scripts write fixed filenames (`connector-*`, `container-*`) that document the
earlier deployed generations, so those tracked files were restored to `HEAD` and this
deployment's output is recorded under the `g5a-deploy-*` names.

Trivy reports **license** findings at HIGH severity (for example GPL and LGPL on base
packages). Those are licence classifications, not vulnerabilities, and the gate counts
vulnerabilities; the licence inventory is kept in the connector evidence for review.

## 11. Offline acceptance

| Check | Result |
| --- | --- |
| `npm run typecheck` | exit 0 (`docs/evidence/g5a-deploy-typecheck.log`) |
| Full suite (`npm test`, Node 24.19.0) | **403/403 pass**, 0 fail, 0 skipped (`docs/evidence/g5a-deploy-suite.log`) |
| A/B/C redirect diagnostics | 40/40 pass |
| Build provenance | connector `sourceCommit af2be54…`; no product source diff since |

## 12. Cleanup and preserved state

- Twelve inert `Created` containers from earlier probe and verification runs were proven to
  hold no mount, no process and no live network endpoint (`docker network inspect` showed
  none), then removed. The control state was `idle`/6 before and after.
- The three scratch tags `*:g5-patched-probe` were proven unused and removed; of the
  patched generation only the three reviewed `:g5-patched-af2be54` tags remain. Older
  pre-patch and G2 images elsewhere on the host were not touched.
- Preserved untouched: pilot database and its volume, `zalo-shared-g2_postgres-data` volume,
  `pilot/state` (session key, diagnostic sink, view directory), the pilot CA, the pilot admin
  credential file, audit history and evidence files.
- The admin proof used a transient `0400` copy of the credential owned by uid 65532 inside a
  `0700` directory, removed immediately after the run.

## 13. Remaining risks and UNPROVEN items

1. **UNPROVEN — live provider behaviour.** No QR, login, UID binding, session, observe or
   send. The redirect policy is proven offline and in the artifact, not on the wire.
2. The patched images were built on this host, not by CI. The trust anchor for a live stage
   remains the CI-built digest recorded with the grant, as `PRIVATE-PILOT.md` requires.
3. The application joins one loopback-published non-internal bridge, so its namespace has a
   default route. This is the reviewed `ops/compose.yaml` app posture and the app holds no
   SDK and no provider credential, but a compromise of the app process could reach the
   network. Traffic admission for the connector is unaffected. The independent reviewer
   asked for the Owner's explicit acknowledgment of this posture before the live gate; it
   is listed as a condition in §15.
4. The stale G2 stack remains stopped with a broken database container. Its volume is
   intact; recovering or deleting it is an Owner decision.
5. `crypto-js@4.2.0` remains deprecated and transitively required by `zca-js@2.2.0`.
6. The QR viewer rehearsal is synthetic; the launcher path is proven but a real QR
   presentation is still only exercised inside an authorized bootstrap window.
7. `ops/local/verify-pilot-admin-auth.mjs` was adjusted to take its baseline from the caller
   (`idle`, epoch 6 and `reconciliationRequired=false` were supplied). The change is ops
   tooling, not product code; the security assertions are unchanged and the saved 22/22
   output is the evidence.
8. The unfiltered scans report 46 MEDIUM/LOW findings per image, concentrated in the
   distroless base and toolchain packages. They are disclosed, not waived, and lie below
   the Owner's HIGH/CRITICAL bar.
9. `ops/local/deploy-pilot-app.sh` now refuses to act unless the tag resolves to the
   reviewed image ID; the running container was verified separately against that same ID.

## 14. Independent review

An independent reviewer with no prior context examined this record, the new ops tooling
(`deploy-pilot-app.sh`, `pilot-app-compose.example.yml`, the `verify-pilot-admin-auth.mjs`
diff), the whole change set and the live host, read-only, and re-derived the artifact
digests, container flags, layer identity, live endpoints, database state and boundary from
the host rather than from this text.

Verdict: **APPROVE WITH CONDITIONS** — every material deployment claim it could test held;
two evidence-process statements were overstated (the gate scans were described as
unfiltered, and the recorded files were attributed to a run that left no artifact). The
findings and their dispositions are recorded in §15.

Independently verified by the reviewer: exact image IDs and health of both running
containers; zero containers from the connector image; exec-form healthcheck; uid 65532,
read-only root, `cap_drop ALL`, `no-new-privileges`; loopback-only publish; the exact
four-host allowlist; gateway with no published port, `ip_forward 0`, sole uplink member;
internal networks and the app's edge membership; DB TLS `verify-full` and the read-only CA
mount; `idle`/6/no owner and `disconnected`/`false`/6 with 1 user, 0 sessions, 0 work and
audit 24 at review time (26 after the evidence-capture run); no `session.enc`; unchanged
sink hash; zero `sni_allow`; and layer identity between the scan archives and the deployed
images.

## 15. Review record

| # | Severity | Finding | Disposition |
| --- | --- | --- | --- |
| 1 | MAJOR | §10 called the gate scans "unfiltered", claimed no severity filter and reported "gate exit 0", while `ops/scan-image.sh` and `ops/pilot-scan.sh` run `--severity HIGH,CRITICAL --exit-code 0`. | §10 rewritten. All three deployed images rescanned with no severity flag at all: 46 MEDIUM/LOW findings each, **0 HIGH/CRITICAL**, scanner exit 1 recorded. |
| 2 | MINOR | The recorded scan files predated the run §10 attributed them to; no artifact of that run existed, so "byte-identical, verified with cmp" was unproven. | The new unfiltered artifacts and summaries are the record; the attribution is corrected and the claim removed. |
| 3 | MINOR | The admin harness now takes its baseline from the caller, so a drifted baseline could pass if the operator feeds observed values. | Expectations used (`idle`, epoch 6, `reconciliationRequired=false`) are recorded; the 22/22 JSON is saved; the reviewer confirmed no check is vacuous and the one-admin, unchanged-row, no-new-reconciliation and audit-append assertions still compare against literals and the before/after snapshots. |
| 4 | MINOR | `deploy-pilot-app.sh` asserted the tag, not the digest; a re-tag could deploy silently. | Digest assertion added and the script re-run idempotently against the running deployment. |
| 5 | MINOR | 22/22, 25/25, 48/48 and 403/403 were prose only. | The three harnesses were re-run at 08:19Z and their outputs saved as `g5a-deploy-admin-proof.json`, `g5a-deploy-network-verifier.log` and `g5a-deploy-topology-verifier.log`; all passed again. |
| 6 | NIT | §12's tag statement was true only within the patched generation. | Corrected. |
| 7 | NIT | "The gateway is the only egress path" now scopes to the connector; the app has a default route via its reviewed edge bridge. | Already disclosed in §13.3; the Owner's acknowledgment of that posture is carried as a pre-live condition. |
| 8 | NIT | §14/§15 were pending. | Filled by this section. |

Conditions carried to the Owner's live start: (a) acknowledge the app's reviewed edge
posture in §13.3; (b) commit this record and the ops tooling with the deployment (this
commit); (c) supply a separate START authorization for any live stage. No condition
requires work inside the private pilot, and none was left open in the deployment.
