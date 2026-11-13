# Pilot gate status

**Date:** 2026-11-11
**Branch:** `feat/shared-inbox`; HEAD `6638d3b` (attempt); deployed connector source commit `d6f8aec2197bc8249b91bd9d4595e36f3129c0b4` (CI run 42943971343); previously staged `8d9e39d…` (CI run 42635857403)
**PR #3:** OPEN, **Draft** (not merged)
**Deployed pilot configuration (2026-11-11T08:43Z):** the independently reviewed two-hop
fix is deployed offline — connector artifact `zalo-shared-connector:g5-ci-d6f8aec`
(config `sha256:9923258e…`, archive `d2410cdb…`, scan 0 HIGH/CRITICAL, `sourceCommit d6f8aec…`),
allowlist `id.zalo.me,wpa.chat.zalo.me,jr.chat.zalo.me,jr.zaloapp.com` (no `chat.zalo.me`),
gateway `zalo-shared-egress-gateway:g5-patched-af2be54` healthy with one `startup` line and
zero tunnels. No connector container exists and **no live activation** has occurred. The single
epoch-9 reconciliation (epoch 9→10, gap 9→10) was executed once in the Owner window
`2026-11-11T09:12–09:27Z` and independently verified; ownership was `idle` at epoch 10, gap 10,
`reconciliation_required=false`, fencing and audit history preserved. A subsequent single
bootstrap attempt in the Owner window `2026-11-11T14:43–15:13Z` reached `qr-shown` but the QR
expired unscanned (`G5A_BOOTSTRAP_FAIL`, `reason=qr-expired`); the connector is now fenced
`uncertain` at epoch 11, gap 11, `reconciliation_required=true`.
**Owner decision:** `G5_SCOPE_APPROVED_ACTIVATION_PENDING` — D1–D7 approved in scope; live activation withheld
**G5-A authorization:** six live bootstrap authorizations have been consumed —
`2026-11-04T00:46Z–01:16Z` (failed before login), `2026-11-06T23:40Z–00:10Z`
(`qr-expired`), `2026-11-07T00:00Z–00:20Z` (post-scan `redirect-denied`),
`2026-11-09T13:12Z–13:42Z` (post-scan redirect to the unreviewed
`jr.zaloapp.com`, refused; `G5A_BOOTSTRAP_FAIL`),
`2026-11-11T00:52Z–01:22Z` (post-scan second redirect, refused;
`G5A_BOOTSTRAP_FAIL`) and `2026-11-11T14:43Z–15:13Z` (QR shown, expired
unscanned; `G5A_BOOTSTRAP_FAIL`). A further window, `2026-11-07T01:02Z–01:32Z`,
was blocked before any QR (`G5A_BLOCKED_REDIRECT_POLICY`). None may be extended,
rescheduled or reused.
**Live pilot:** **NOT ACTIVATED** — six live attempts emitted a QR; no completed
handshake, no UID, no session, no encrypted store and no real account operation.
On 2026-11-09 the phone scan succeeded and the connector refused the provider's
`checkSession` redirect to `jr.zaloapp.com`. On 2026-11-11 the allowed redirect
was followed, then the provider issued a second redirect from `jr.zaloapp.com` to
`jr.chat.zalo.me`, which the reviewed one-hop policy refused (`redirect-after-hop`).
On 2026-11-11 at `14:44:50Z` the two-hop build reached `qr-shown`; the primary QR
window was logged topmost/visible in the interactive session, the QR was not
scanned within its 100-second provider lifetime and the connector failed
`qr-expired` at `14:46:30Z`.
**Owner reconciliation gate:** the 2026-11-07 incident was reconciled once in the
Owner window `00:54–01:14Z` (epoch 5→6, gap 5→6). The 2026-11-09 incident was
reconciled once in the Owner window `2026-11-11T00:05Z–00:20Z` through the reviewed
API (epoch 7→8, gap 7→8, `reconciliation_required=false`). The 2026-11-11
`00:54Z` attempt was fenced `uncertain` at epoch 9, gap 9 and was reconciled once
in the Owner window `2026-11-11T09:12–09:27Z` (epoch 9→10, gap 9→10,
`reconciliation_required=false`). The 2026-11-11 `14:43Z` attempt is fenced
`uncertain` at epoch 11, gap 11, `reconciliation_required=true`; no reconciliation
was performed for it. No control state was reset by hand.
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

## Controlled Docker recovery — 2026-11-10

**`WSL_DOCKER_PILOT_RECOVERED_RECONCILIATION_READY`** — after the 2026-11-09 WSL outage the
Docker Desktop WSL integration list was empty (`IntegratedWslDistros: null`), so every pilot
bind resolved to an empty VM path. The Owner's infrastructure-only recovery authorization was
executed: the integration was restored through Docker Desktop's own settings API (pre-change
store backed up on `D:`), PostgreSQL and the application were recreated against the unchanged
`pilot-postgres-data` volume and the same eight read-only TLS/secret binds, and the egress
gateway was started in place. No named volume, image, certificate, credential or key was
changed, and no connector, session, QR or provider contact exists. The authoritative database
state was re-read in a `READ ONLY` transaction and is unchanged: `uncertain`, epoch 7, gap 7,
`reconciliation_required=true`, 28 audit rows. See
[G5A-DOCKER-RECOVERY-2026-11-10.md](docs/evidence/G5A-DOCKER-RECOVERY-2026-11-10.md).

## Post-recovery stabilization — 2026-11-10

**`G5A_POST_RECOVERY_SECURED_RECONCILIATION_READY`** — the Owner's post-recovery
security-and-preparation authorization was executed without touching the pilot. The private
backup set `D:\WSL-Backups` inherited `Authenticated Users:(M)` and `BUILTIN\Users:(RX)`; two
enabled `Codex*` sandbox accounts sit in `Users`, and `inspect-before.json` carried the
`zs_app` DSN password and `METRICS_TOKEN`, so those credentials were reachable by unintended
principals. Inheritance was removed and replaced by explicit `Admin`/`SYSTEM`/`Administrators`
grants, verified recursively over all 22 items with zero remaining `Users`/`Everyone`/`Codex`
ACEs; no data was moved or deleted. Rotation is warranted but was **not** performed. The
gateway, down since the 06:28:58Z host reboot because it has `restart: no`, was started in
place (same container ID, healthy, no tunnel). The local evidence commit `cfddd1c` was pushed
to `feat/shared-inbox` as a clean fast-forward with no rewrite. The fence was re-read in a
`READ ONLY` transaction and is unchanged (`uncertain`/7, gap 7, audit 28), and one exact
incident-bound request was prepared — `requestId 521bbecd-…`, body SHA-256 `709270a0…`,
`notSent: true` — awaiting an Owner UTC window. Storage and the unrelated workloads were
inspected read-only only. See
[G5A-POST-RECOVERY-STABILIZATION-2026-11-10.md](docs/evidence/G5A-POST-RECOVERY-STABILIZATION-2026-11-10.md).

## Credential rotation — 2026-11-10

**`G5A_CREDENTIALS_ROTATED_RECONCILIATION_READY`** — the two credentials exposed through the
2026-11-09 backup set were rotated inside the private pilot: the `zs_app` database password
(new 48-character URL-safe value) and `METRICS_TOKEN` (new 43-character value), independent of
each other and of every other credential. `pilot-db/secrets/app.pw`, `pilot-app/metrics.token`,
`pilot-app/app.env` and the connector env were replaced atomically, the application was
recreated from the reviewed image and is healthy, and the exposed values — read back from the
backup file itself — are now rejected (`password authentication failed` over
`sslmode=verify-full`; HTTP 401 for the old token) while the new ones are accepted (TLS
`verify-full`; HTTP 200). The `zs_owner` role, the pilot admin credential, the TLS material and
the session key were not touched, and no unrelated service credential was modified. The
exposed DSN password also authenticates the unrelated `zalo-shared-g2-postgres-1` stack; that
was reported and left for a separate decision. Two copies of the old values (the backup record
and one past subagent transcript) were rewritten byte-for-byte with same-length redaction
placeholders; a scan of 571 WSL files, 132 commits and 7,485 Windows text files found no other
copy, and the new values appear only in the three intended live consumer files. The control
state was re-read on a separate read-only connection and is unchanged (`uncertain` epoch 7,
owner `af5048a8-…`, gap 7, `reconciliation_required=true`, 28 audit rows, zero unresolved work,
zero advisory locks). `ops/local/reconcile-20261110.sh` prepares the single epoch-7
reconciliation around the reviewed driver, takes its window only from an Owner-supplied private
file (not yet created), and was **not executed**. See
[G5A-CREDENTIAL-ROTATION-2026-11-10.md](docs/evidence/G5A-CREDENTIAL-ROTATION-2026-11-10.md).

**Independent verification of the rotation — 2026-11-10 (addendum, supersedes two claims above).**
The follow-up directive required the rotation to be re-verified, not repeated; the private
marker and the reviewed script's own guard make a second run a no-op, so the live pilot and
`a49775f` were verified independently instead. **The g2 claim above is wrong as written:** a
password probe with the exposed value is **rejected** by the g2 `zs_app` role **and** the g2
`zalo_owner` role, while the same probe accepts that stack's own `zalo_owner` password, so the
method is sound; the earlier sentence came from comparing env files, not from authenticating.
The two stacks did share the value in their environment files, so rotating the pilot half
removed the pilot's copy, but no g2 credential was tested as accepted. **The copy inventory
above is also incomplete:** two further copies of the old values were found and redacted in
place, length-preserving — a stale `<PILOT_PRIVATE>/app.env` (1 password + 1 dead token, 552 B
unchanged, `6689abd2…` → `8bf1d3eb…`) that is *also* the g2 compose environment file, and one
past Qoder transcript (5 + 4 occurrences, 78,738,821 B unchanged, `8fb03fe5…` → `665f0bf7…`,
all 32,320 JSONL records still valid). Redacting that `app.env` changed the g2 compose
environment file; no g2 container was started, stopped, recreated or modified. After the
redaction a scan of the repository (working tree and all 132 commits), the private tree,
`D:\WSL-Backups`, the Qoder store and `%TEMP%` returns zero copies of either old value, and the
new values appear only in the four live consumer files. Everything else above was reproduced:
old DSN password rejected / new accepted over `verify-full`, `/metrics` 401 for the old token
and 200 for the new, application healthy as uid 65532 with one idle TLSv1.3 `zs_app` session,
gateway healthy with its last event still `startup`, the fence unchanged (`uncertain`/7,
`af5048a8-…`, `shutdown`, gap 7, `reconciliation_required=true`, audit 28 rows / 3
reconciliations, zero locks, zero unresolved work), the backup ACL still restricted and the
VHDX byte size and mtime unchanged. `ops/local/reconcile-20261110.sh` preflight was re-run
read-only from a temporary LF worktree at the same commit (the Windows checkout's CRLF endings
make its `pipefail\r` line invalid; no file was rewritten) and passed with
`app_quiesce_required=1`; no window file, no attempt marker and no new reconciliation record
exist. No reconciliation was executed. See
[G5A-CREDENTIAL-ROTATION-VERIFICATION-2026-11-10.md](docs/evidence/G5A-CREDENTIAL-ROTATION-VERIFICATION-2026-11-10.md).
**`G5A_CREDENTIALS_ROTATED_RECONCILIATION_READY`**

## Epoch-7 reconciliation — 2026-11-11

**`G5A_RECONCILIATION_PASS_AWAITING_BOOTSTRAP_DECISION`** — the Owner's single epoch-7
reconciliation was executed once inside the authorized UTC window
`2026-11-11T00:05:00.000Z`–`00:20:00.000Z` (reference
`OWNER-EPOCH7-RECONCILIATION-2026-11-11T0005Z-0020Z`). The wrapper ran at `eda6c18` with the
reviewed driver (`bb7a18cc…`) and preflight (`b3f3427…`) blobs and the unchanged application
image `sha256:989c6154…`; the prepared request was used unchanged (`521bbecd-…`, evidence
reference `G5A-OWNER-AUTH-2026-11-10-RECONCILIATION`, body SHA-256 prefix `709270a0…`). The
application was stopped, zero other database sessions and zero advisory locks were proved, and
the read-only preflight returned `ok:true` (13/13). One authenticated `POST
/api/provider/operations/reconcile` at `00:05:29.085Z` returned HTTP 200,
`alreadyApplied=false`, and applied `uncertain → idle`, epoch 7→8, gap 7→8,
`reconciliation_required=false`; the driver's 20/20 checks passed. The incident moved to the
fence baseline `af5048a8-…`/7 at `00:05:29.515344Z` with the earlier `7cc878cf-…`/5 history
preserved; audit grew 28 → 31 with exactly one `connector.reconciled` row (id 30) carrying the
request, plus the driver's login/logout pair. The gateway log is unchanged (`startup`, zero
tunnels, no provider contact), no connector or worker container exists, zero unresolved work
remains, and the application was restored healthy at `00:05:31Z`. Two disclosures: the
wrapper's own post-check failed after the successful request on an unbound counter and a `+1`
assumption (the driver writes three audit rows) and recorded a `verification-failed` attempt
marker even though the authoritative state was correct — fixed in `9eedf5c` without rewriting
the marker, keeping the single-attempt guard closed; and one earlier invocation was refused
`outside-window` before the window opened, stopping and sending nothing. The G2 shared-password
residual was not touched. No retry, replay, second request, direct SQL control-state mutation,
volume deletion, WSL shutdown, deployment or merge occurred. See
[G5A-RECONCILIATION-EXECUTION-2026-11-11.md](docs/evidence/G5A-RECONCILIATION-EXECUTION-2026-11-11.md).

## G5-A bootstrap attempt — 2026-11-11

**`G5A_BOOTSTRAP_FAIL`** — the Owner's one authorized QR bootstrap ran once inside
`2026-11-11T00:52:00Z–01:22:00Z` and failed closed at the provider handshake. Preflight was
fully green (`idle` epoch 8, `disconnected` gap 8, `reconciliation_required=false`, no
`session.enc`, no worker, zero unresolved work, app/gateway healthy, `verify-full`, four-host
boundary PASS, viewer session 1 interactive) and the grant
(`G5A-OWNER-AUTH-2026-11-11T0052Z`, `g5a-enroll-2026-11-11T0052Z`) was admitted offline against
`zalo-shared-connector:g5-ci-8d9e39d` (`sha256:220982a7…`, `sourceCommit 8d9e39d…`). The QR was
written at `00:54:36.927Z` and displayed automatically (399×399, session 1, topmost); the Owner
scanned at `00:54:43.171Z`. The gateway admitted `id.zalo.me` and then `jr.zaloapp.com` (the one
reviewed redirect); the provider then returned a **second** redirect from `jr.zaloapp.com` to
`jr.chat.zalo.me`, which the reviewed one-hop policy refused at `00:54:44.986Z` (`reason:
redirect-denied`, `redirect-after-hop`, `hops=1`). No tunnel to `jr.chat.zalo.me` opened. No UID
was obtained, no identity confirmation was requested, no `session.enc` was written and no
account data was touched. The attempt fenced ownership `uncertain` epoch 9
(`0280fd84-…`, `shutdown`, `00:54:44.993Z`), provider `disconnected` gap 9
`reconciliation_required=true`; audit grew 31 → 33 (`connector.reserved`, `connector.uncertain`)
with the `af5048a8-…`/7 fence history preserved. The viewer closed and the stale staged copy was
removed; the private manifest pointer was restored to the synthetic file. No retry, second
grant, second QR, allowlist/gateway change, reconciliation, deployment or merge occurred. See
[G5A-BOOTSTRAP-ATTEMPT-2026-11-11.md](docs/evidence/G5A-BOOTSTRAP-ATTEMPT-2026-11-11.md).

## Two-hop redirect remediation — 2026-11-11 (offline)

**`G5A_TWO_HOP_FIX_REVIEWED_AND_RECONCILIATION_READY`** — under an offline-only authorization,
the observed chain `id.zalo.me → jr.zaloapp.com → jr.chat.zalo.me` is implemented as a
chain-bound, single-use, at-most-two-hop redirect policy: hop 1 only from the exact reviewed
`checkSession` request, hop 1 destination only `jr.zaloapp.com:443`, hop 2 only from the authorized
hop-1 response, hop 2 destination only `jr.chat.zalo.me:443`, `redirect:"manual"` on every request,
and a direct request to the redirect host refused. A third redirect, a loop, a malformed or
downgraded `Location`, a direct destination request that skips the chain and a reused or stale
authorization all fail closed. No hostname was added: the chain reuses the four-host allowlist
(`id.zalo.me`, `wpa.chat.zalo.me`, `jr.chat.zalo.me`, `jr.zaloapp.com`; `chat.zalo.me` stays
excluded), and the network checker now asserts `maxHops: 2` and the same chain. Diagnostics keep the
closed vocabulary (adding `second-hop-denied`), label a direct redirect-host request `other` with
`direct-redirect-host`, and cap `hops` at 2. The QR staged-copy defect disclosed in the attempt
report is fixed: tri-state presence, confirmed-absence cleanup, exit 5 with `cleanup=FAILED`, a
termination guard that re-checks run ownership before every delete, and a launcher sweep of a stale
copy. Offline: typecheck clean, transport **178/178**, full suite **421/421**, SDK probe 2/2, both
builds PASS, network checker all assertions PASS; the QR rehearsal covered seven synthetic scenarios
and the guard's ownership semantics were re-tested directly. Independent review:
**APPROVE WITH CONDITIONS** — its Critical wrapper bug and High gateway-log gap were
fixed, the run-file heartbeat and `flock` were added, and the check-then-delete
window plus the double-kill sweep are disclosed residuals (§6). CI run `42943971343`
on `d6f8aec` succeeded (both jobs); artifact `pilot-connector-image` id `13822176119`,
archive `d2410cdb…`, image config `sha256:9923258e…`, staged as `g5-ci-d6f8aec` and
**not deployed**. The fenced control state
is unchanged and re-read read-only: ownership `uncertain` epoch 9 (`0280fd84-…`, `shutdown`,
`2026-11-11T00:54:44.993048Z`), last fenced `af5048a8-…`/7, provider `disconnected` gap 9
`reconciliation_required=true`, audit 33 rows with 4 prior reconciliations, 1 user, 1 active admin,
0 sessions, 0 advisory locks, 0 unresolved work and empty data tables. The epoch 9→10 reconciliation
is prepared around the reviewed driver/preflight blobs and the private `notSent` request
(`4203bde7-…`) and is **not executed**: no Owner window exists, and the wrapper refuses without one.
No QR, provider contact, reconciliation, live allowlist change, deployment or merge occurred. See
[G5A-TWO-HOP-REMEDIATION-2026-11-11.md](docs/evidence/G5A-TWO-HOP-REMEDIATION-2026-11-11.md).

## Two-hop deployment and QR viewer acceptance — 2026-11-11

**`G5A_TWO_HOP_DEPLOYED_RECONCILIATION_AWAITING_OWNER_START`** — under the Owner's
deployment authorization, the reviewed two-hop connector
`zalo-shared-connector:g5-ci-d6f8aec` (image id `d2a85b19…`, config `9923258e…`,
29 layers, archive `d2410cdb…`, scan 0 HIGH/CRITICAL, embedded `sourceCommit
d6f8aec…`) is named by the private pointer, with the exact four-host inventory
and `chat.zalo.me` excluded. The gateway was recreated once during the deployment
(a first start used the script default and was immediately corrected), so the
reconciliation wrapper binds a deployment baseline (same container id, image and
creation time, byte-identical log) instead of the pre-incident log, which is
preserved in evidence. The compiled policy inside the image is byte-identical to
the reviewed build (`MAX_HOPS=2`, `jr.zaloapp.com`, `jr.chat.zalo.me`,
`redirect:"manual"`). The QR viewer now binds one window per attempt, refuses
duplicates, refreshes in place, hands ownership over through a shared state lock,
and cleans up on close, timeout and forced kill; one controlled synthetic
rehearsal passed with exactly one visible window (duplicate 0 windows, refresh 0
windows, corrupt/truncated exit 4, timeout exit 3, forced kill `removed-staged`,
handover old-before-new, stale viewer refused), no copy remains and nothing is
scheduled to reopen it. Typecheck clean and transport **178/178** at HEAD.
Preflight at HEAD PASS: fence
`uncertain|9|0280fd84-…|shutdown|2026-11-11T00:54:44|af5048a8-…|7`, provider
`disconnected|9|true|shutdown`, audit 33 with 4 prior reconciliations, 0 advisory
locks, gateway log `be08a8a0…`, private state session-key-only; the database pool
session sampled 0/1 across runs, so `app_quiesce_required=1` is conditional.
Independent acceptance review: **APPROVE WITH CONDITIONS**, no blocking finding;
both documentation conditions are closed and five residuals are disclosed
(unsigned baseline, untracked `dist`, container-wide host admission,
duplicate-launch freshness windows, double kill/sweep). The epoch 9→10
reconciliation stayed prepared and unexecuted at this stage; it was executed
once later the same day (see the execution section below). No QR,
provider contact, reconciliation, additional provider host, production
deployment, PR merge or retry occurred. See
[G5A-TWO-HOP-DEPLOYMENT-2026-11-11.md](docs/evidence/G5A-TWO-HOP-DEPLOYMENT-2026-11-11.md).

## Epoch-9 single reconciliation executed — 2026-11-11

**`G5A_RECONCILIATION_PASS_AWAITING_BOOTSTRAP_DECISION`** — under the Owner's
single-window authorization (`G5A-OWNER-AUTH-2026-11-11-RECONCILIATION`,
`09:12:00Z–09:27:00Z` hard expiry) the prepared epoch-9 wrapper executed exactly
once at `09:12:08Z` at HEAD `973ea7e`. Preflight passed all 14 predicates
(ownership `uncertain` epoch 9 owner `0280fd84-…` fault `shutdown`; provider
`disconnected` gap 9 `reconciliation_required=true`; audit 33; `sessions=0`;
`session.enc` absent; zero unresolved work; zero advisory locks; DB TLS
`verify-full`; gateway healthy with four hosts and unchanged log `be08a8a0…`).
The application was quiesced and `other_sessions=0` was proved before the
request. Exactly one authenticated `POST /api/provider/operations/reconcile`
(request `4203bde7-f27e-4f5c-adda-e8f4e4eb62fe`) returned HTTP 200
`{"ok":true,"epoch":"10","gapVersion":"10","alreadyApplied":false}` at
`09:12:15.840Z`. Independent read-only verification: ownership `idle` epoch 10
owner null, last fenced `0280fd84-…`/9 at `2026-11-11T09:12:15.840Z`; provider
`disconnected` gap 10 `reconciliation_required=false`; audit 36 rows (33 prior
preserved) with exactly one new `connector.reconciled` row (id 35) bound to the
request id and evidence ref, plus one login (34) and one logout (36); all data
and queue tables 0; no connector; application `running healthy` since
`09:12:18.226Z`; gateway container and log unchanged; no provider contact. The
wrapper's own post-check also passed, so no verification-error distinction was
needed. Attempt marker `outcome=reconciled`, `exitCode=0`. No retry, replay,
direct SQL, alternative endpoint or window extension. See
[G5A-RECONCILIATION-EXECUTION-2026-11-11-EPOCH9.md](docs/evidence/G5A-RECONCILIATION-EXECUTION-2026-11-11-EPOCH9.md).

## Single bootstrap attempt `14:43Z` — QR expired unscanned — 2026-11-11

**`G5A_BOOTSTRAP_FAIL`** — in the Owner window `2026-11-11T14:43:00Z–15:13:00Z`
the sixth G5-A bootstrap used one fresh grant
(`G5A-OWNER-AUTH-2026-11-11T1443Z` / `g5a-enroll-2026-11-11T1443Z`) against the
deployed `zalo-shared-connector:g5-ci-d6f8aec` (image `d2a85b19…`, config
`9923258e…`, embedded `sourceCommit d6f8aec…`). All mandatory preflight checks
passed, including `idle` epoch 10, provider `disconnected` gap 10, zero sessions
and unresolved work, `verify-full` database TLS, the four-host boundary and an
offline grant preflight `ok:true`/`admitted`. The connector started at
`14:44:49.788Z`, acquired ownership (epoch 11), opened one `id.zalo.me:443`
tunnel and reached `qr-shown` at `14:44:50.757Z`; the automatic viewer logged
`session=1 topmost=True visible=True` at `14:44:51Z`. No `scanned` stage was
recorded, a second `id.zalo.me` tunnel at `14:46:30.985Z` was the expiry poll, and
the provider QR lifetime expired at `14:46:30.759Z`
(`gate=unavailable`, `reason=qr-expired`). No UID, display name, terminal
`confirm`, encrypted session or account data exists; `session.enc` and `qr.png`
are absent and no viewer or connector process remains. Disclosed observation: the
viewer wrote no close/timeout line and its guard removed the staged copy at
`14:44:52Z`, consistent with the window ending about one second after it
appeared when the background launcher shell exited; the QR would have expired
unscanned either way, and no second QR was generated. The fence is `uncertain`
epoch 11 (`1c6bebbb-…`, `shutdown`, `14:46:30.766Z`), provider gap 11
`reconciliation_required=true`, audit 36 → 38 with the prior rows intact. A new
Owner-authorized reconciliation (epoch 11 → 12) is required before another
bootstrap. No retry, alternate flow, provider allowlist change, PR merge or
production deployment occurred. See
[G5A-BOOTSTRAP-ATTEMPT-2026-11-11T1443Z.md](docs/evidence/G5A-BOOTSTRAP-ATTEMPT-2026-11-11T1443Z.md).

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
| `G5A_REDIRECT_DEPLOYED_AWAITING_OWNER_START` | **PASS (deployed, offline)** | [G5A-REDIRECT-DEPLOYMENT-2026-11-09.md](docs/evidence/G5A-REDIRECT-DEPLOYMENT-2026-11-09.md); the Owner's deployment authorization was executed on 2026-11-09T14:55Z: CI-built `zalo-shared-connector:g5-ci-8d9e39d` (`sha256:220982a7…`, archive `d416e76f…`, embedded `sourceCommit 8d9e39d…`) staged and the exact four-host allowlist (`id.zalo.me`, `wpa.chat.zalo.me`, `jr.chat.zalo.me`, `jr.zaloapp.com`; `chat.zalo.me` excluded) deployed through the byte-identical reviewed compose; the gateway was recreated healthy with no tunnel. 14/14 static, 48/48 deployed-network, 21/21 allow-path, 37/37 in-image redirect, 29/29 database TLS and 5/5 preflight checks PASS; scan 0 HIGH/CRITICAL; QR viewer rehearsal PASS with a synthetic fixture only. Control state unchanged (`uncertain` epoch 7, gap 7, `reconciliation_required=true`, 0 sessions, audit 28 rows), no connector container, no provider contact. The single reconciliation is prepared and awaits a separate Owner UTC window |
| `G5A_RECONCILIATION_REQUIRED_AWAITING_OWNER` | **CLEARED (reconciled 2026-11-11)** | The 2026-11-09 fence was confirmed read-only: ownership `uncertain` epoch 7 (`af5048a8-…`, `shutdown`), provider `disconnected` gap 7 `reconciliation_required=true`, zero unresolved work, audit 28 rows with the incident prefix intact, preflight `ok:true` with zero advisory locks and zero other sessions. The prepared single transition (`uncertain→idle`, epoch 7→8, gap 7→8) was executed once in the Owner's 2026-11-11 window; see the execution row below |
| `G5A_RECONCILED_20261111` | **PASS (reconciliation)** | [G5A-RECONCILIATION-EXECUTION-2026-11-11.md](docs/evidence/G5A-RECONCILIATION-EXECUTION-2026-11-11.md); executed once in the Owner window `2026-11-11T00:05–00:20Z` at reviewed HEAD `eda6c18` with the pinned driver/preflight blobs and image `sha256:989c6154…`: application quiesced, zero other sessions and zero advisory locks, read-only preflight `ok:true` (13/13), one authenticated request at `00:05:29.085Z` HTTP 200 (`alreadyApplied=false`), epoch 7→8, gap 7→8, `uncertain → idle`, driver 20/20, audit 28 → 31 with exactly one `connector.reconciled` row (id 30) carrying `521bbecd-…`, fence baseline `af5048a8-…`/7 with history preserved, gateway log unchanged (`startup`, zero tunnels), no connector, zero unresolved work, application healthy since `00:05:31Z`. Disclosed: the wrapper's post-check failed after the successful request on an unbound counter and a `+1` audit-row assumption (marker `verification-failed`, fixed in `9eedf5c`, marker not rewritten) and one earlier invocation was refused `outside-window` without stopping or sending. No retry, replay or second request |
| `G5A_BOOTSTRAP_FAIL_20261111` | **FAIL (`redirect-after-hop`)** | [G5A-BOOTSTRAP-ATTEMPT-2026-11-11.md](docs/evidence/G5A-BOOTSTRAP-ATTEMPT-2026-11-11.md); one authorized attempt in `00:52–01:22Z`: preflight fully PASS at `idle`/8, grant admitted against `g5-ci-8d9e39d` (`sha256:220982a7…`), QR shown automatically at `00:54:36.927Z` and scanned by the Owner at `00:54:43.171Z`; the gateway admitted `id.zalo.me` then `jr.zaloapp.com`, and the provider's second redirect `jr.zaloapp.com → jr.chat.zalo.me` was refused (`redirect-denied`, `redirect-after-hop`, `hops=1`) at `00:54:44.986Z`. No UID, no confirmation, no `session.enc`, no account data touched; ownership fenced `uncertain` epoch 9 (`0280fd84-…`, `shutdown`), provider gap 9 `reconciliation_required=true`, audit 31 → 33. Viewer closed, staged copy removed, synthetic manifest pointer restored. No retry or second QR |
| `G5A_TWO_HOP_FIX_REVIEWED_AWAITING_OWNER_DEPLOYMENT` | **PASS (offline)** | [G5A-TWO-HOP-REMEDIATION-2026-11-11.md](docs/evidence/G5A-TWO-HOP-REMEDIATION-2026-11-11.md); chain-bound two-hop policy (`id.zalo.me → jr.zaloapp.com → jr.chat.zalo.me`), `redirect:"manual"`, single-use authorization, direct-host refusal, no new hostname, diagnostics capped at 2 hops with `second-hop-denied`, QR cleanup fixed and rehearsed; typecheck clean, 178/178 transport, 421/421 full, SDK 2/2, both builds and the network checker PASS; independent review **APPROVE WITH CONDITIONS**, findings closed or disclosed on `d6f8aec`; CI run `42943971343` succeeded, artifact `pilot-connector-image` (archive `d2410cdb…`, image config `sha256:9923258e…`) staged as `g5-ci-d6f8aec`. Deployed to the private pointer on 2026-11-11T08:43Z; see the two-hop deployment row |
| `G5A_RECONCILIATION_REQUIRED_EPOCH9_AWAITING_OWNER` | **SUPERSEDED (executed 2026-11-11)** | Preparation record for the epoch-9 fence; superseded by the epoch-9 reconciliation execution row below |
| `G5A_TWO_HOP_DEPLOYED_RECONCILIATION_AWAITING_OWNER_START` | **PASS (deployed, offline; APPROVE WITH CONDITIONS)** | [G5A-TWO-HOP-DEPLOYMENT-2026-11-11.md](docs/evidence/G5A-TWO-HOP-DEPLOYMENT-2026-11-11.md); CI artifact `g5-ci-d6f8aec` (id `d2a85b19…`, config `9923258e…`, 29 layers, archive `d2410cdb…`, scan 0 HIGH/CRITICAL) deployed to the private pointer at 2026-11-11T08:43Z; four-host allowlist (`jr.zaloapp.com`, no `chat.zalo.me`), egress internal, uplink gateway-only, gateway healthy with one `startup` line and zero tunnels, no connector container. Compiled policy byte-identical to the reviewed build; QR viewer single-window rehearsal PASS; typecheck and 178/178 transport at HEAD; preflight PASS (`uncertain` epoch 9, gap 9, audit 33, 0 advisory locks, gateway log `be08a8a0…`). Independent review APPROVE WITH CONDITIONS, no blocking finding; both documentation conditions closed, five residuals disclosed. Reconciliation prepared, not executed; no window file |
| `G5A_RECONCILIATION_PASS_AWAITING_BOOTSTRAP_DECISION` | **PASS (reconciliation, independently verified)** | [G5A-RECONCILIATION-EXECUTION-2026-11-11-EPOCH9.md](docs/evidence/G5A-RECONCILIATION-EXECUTION-2026-11-11-EPOCH9.md); executed once in the Owner window `2026-11-11T09:12–09:27Z` at HEAD `973ea7e`: preflight 14/14, application quiesced with `other_sessions=0`, one authenticated request `4203bde7-…` at `09:12:15.840Z` HTTP 200 (`alreadyApplied=false`), epoch 9→10, gap 9→10, `uncertain → idle`, independent read-only check confirms owner null, `reconciliation_required=false`, audit 33 → 36 with exactly one new `connector.reconciled` row (id 35) bound to the request/evidence and prior rows preserved, fence `last_fenced` `0280fd84-…`/9 intact, zero sessions and zero unresolved work, no connector, application healthy, gateway log unchanged (`be08a8a0…`), no provider contact. Attempt marker `reconciled`/0. No retry, replay or second request; a new bootstrap needs a fresh Owner authorization bound to `d6f8aec…` |
| `G5A_BOOTSTRAP_FAIL_20261111T1443Z` | **FAIL (`qr-expired`)** | [G5A-BOOTSTRAP-ATTEMPT-2026-11-11T1443Z.md](docs/evidence/G5A-BOOTSTRAP-ATTEMPT-2026-11-11T1443Z.md); sixth authorized attempt in `14:43–15:13Z`: preflight PASS, grant `g5a-enroll-2026-11-11T1443Z` admitted (`lifetimeMs=1751645`), connector started `14:44:49.788Z` on `g5-ci-d6f8aec`, ownership epoch 11, one `id.zalo.me:443` tunnel, `qr-shown` `14:44:50.757Z`, viewer `session=1 topmost=True visible=True`; no `scanned` stage and no scan tunnels; provider QR expired `14:46:30.759Z` (`gate=unavailable`, `reason=qr-expired`). No UID, confirm, session or account data; `session.enc`/`qr.png` absent, viewer and connector gone, manifest pointer restored. Fenced `uncertain` epoch 11 (`1c6bebbb-…`), provider gap 11 `reconciliation_required=true`, audit 36 → 38. No retry, second QR or alternate flow |
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
| `WSL_DOCKER_PILOT_RECOVERED_RECONCILIATION_READY` | **PASS (infrastructure)** | [G5A-DOCKER-RECOVERY-2026-11-10.md](docs/evidence/G5A-DOCKER-RECOVERY-2026-11-10.md); WSL integration restored via Docker Desktop settings (backup on `D:`), PostgreSQL and the application recreated, gateway started in place; volumes, images, TLS and credentials untouched; database fence re-read read-only at `uncertain`/7/7/`true` with 28 audit rows; no connector, no session, no provider contact. Residual: `C:` 4.8G free, the `D:` VHDX copy fails its checksum comparison, the gateway restart policy is `no`, and three `deer-flow` containers were left down after the engine restart |
| `G5A_POST_RECOVERY_SECURED_RECONCILIATION_READY` | **PASS (security + preparation)** | [G5A-POST-RECOVERY-STABILIZATION-2026-11-10.md](docs/evidence/G5A-POST-RECOVERY-STABILIZATION-2026-11-10.md); private backup set restricted to owner/`SYSTEM`/`Administrators` after `Authenticated Users`/`Users` exposure was confirmed, credentials exposed but **not rotated** (Owner decision); gateway restarted in place after the 06:28:58Z reboot, healthy, no tunnel; `cfddd1c` pushed as a fast-forward; fence re-read read-only unchanged (`uncertain` epoch 7, gap 7, `reconciliation_required=true`, 28 audit rows, zero unresolved work, one idle application session); request prepared `521bbecd-…` / `709270a0…` and **not sent**. UNPROVEN: storage reclamation, restore-point inventory (needs elevation), WSL relocation, unrelated-workload restores — all prepared, none executed |
| `G5A_CREDENTIALS_ROTATED_RECONCILIATION_READY` | **PASS (rotation + preparation)** | [G5A-CREDENTIAL-ROTATION-2026-11-10.md](docs/evidence/G5A-CREDENTIAL-ROTATION-2026-11-10.md); `zs_app` password and `METRICS_TOKEN` rotated and applied atomically to `app.pw`, `metrics.token`, `app.env` and the connector env; application recreated healthy from `sha256:989c6154…`; exposed values rejected over `verify-full`/HTTP 401 and new values accepted/200; PostgreSQL and gateway healthy, app session TLSv1.3, no connector, no session or QR artefact; fence re-read read-only unchanged (`uncertain` epoch 7, `af5048a8-…`, gap 7, `reconciliation_required=true`, 28 audit rows, zero unresolved work, zero advisory locks); two copies of the old values redacted in place, no other copy found; `ops/local/reconcile-20261110.sh` prepared around the reviewed driver with an Owner-supplied window and **not executed**. Residual: the old pilot password remains valid on the unrelated `zalo-shared-g2-postgres-1` stack; no reconciliation, QR, provider contact or state change |

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

The reviewed two-hop connector is deployed and the fence is unchanged
(`uncertain` epoch 9, gap 9, `reconciliation_required=true`). Two Owner actions
remain, in order:

1. **Owner UTC window for the epoch 9→10 reconciliation.** Supply
   `reconcile-window-20261111.json` with `notBefore`, `notAfter` and an
   `authorizationRef` matching the prepared request (`4203bde7-…`). The wrapper
   refuses without it and executes once; there is no retry, replay or extension.
2. **A new G5-A authorization** after the reconciliation completes. It must name
   the stage, UTC start and automatic expiry, and be bound to the deployed
   `sourceCommit d6f8aec…`. The 2026-11-11 window is consumed and cannot be reused.
3. **The redirect chain remains UNPROVEN live.** Hop 2
   (`jr.zaloapp.com → jr.chat.zalo.me`) is proven offline against the pinned SDK
   only; a third redirect fails closed. A live attempt is the only way to
   establish finality.
4. **QR viewer.** One window per attempt opens automatically; the Owner only
   scans it. Do not launch a second viewer; duplicates are refused. The
   double-kill sweep and the sub-second handover overlap are disclosed residuals.

G5-B is not authorized. No retry, login, observe, send or media action is
permitted until a new authorization exists.

**STOP — `G5A_BLOCKED_REDIRECT_POLICY` (2026-11-07, historical; superseded by the deployed two-hop fix).** The 2026-11-07 `01:02–01:32Z` window was
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

**G5-A REDIRECT FIX DEPLOYED OFFLINE, RECONCILIATION PREPARED — `G5A_REDIRECT_DEPLOYED_RECONCILIATION_AWAITING_OWNER_START`.**
The Owner's deployment authorization was executed on 2026-11-09T14:55Z. The private pilot now
runs the CI-built `zalo-shared-connector:g5-ci-8d9e39d` (archive `d416e76f…`, local manifest
digest `sha256:220982a7…`, embedded `sourceCommit 8d9e39d…`, lock and `zca-js` integrity equal
to the run) with the exact four-host inventory `id.zalo.me,wpa.chat.zalo.me,jr.chat.zalo.me,jr.zaloapp.com`;
`chat.zalo.me` is excluded and appears nowhere as an admitted host or pin. The reviewed compose
is byte-identical to the private rendered copy, and the egress gateway
(`zalo-shared-egress-gateway:g5-patched-af2be54`) was recreated healthy — no tunnel, no published
port, `ip_forward=0`. Offline verification: 14/14 static, 48/48 deployed-network, 21/21 allow-path,
37/37 in-image redirect (including a refused second hop, a refused direct request to the redirect
host, a refused `chat.zalo.me` Location and malformed Locations), 29/29 database TLS
(`verify-full`, TLSv1.3), and 5/5 preflight checks where `bootstrap`/`observe`/`send-test` are
admitted and both an out-of-scope manifest and a manifest bound to a different commit are denied.
The scan reports 0 HIGH/CRITICAL, and the Windows QR viewer rehearsal PASSed with a synthetic
fixture only. No QR was generated and no provider was contacted. An independent read-only review
returned **PASS WITH RESIDUAL RISKS** with no Critical or High finding; its three Low dispositions
are recorded (extra query parameters still classify as `checkSession`; the hop bound is per
response, not per process; and the application's idle pool makes `other_sessions` flicker between
0 and 1). The fenced control state is unchanged — ownership `uncertain` epoch 7, provider
`disconnected` gap 7, `reconciliation_required=true`, zero sessions, zero unresolved work, audit
28 rows with three prior reconciliations — and no connector container exists. The single
reconciliation (`uncertain→idle`, epoch 7→8, gap 7→8) stays **prepared and unexecuted**: it needs a
separate explicit Owner UTC window, and the procedure now stops the application first so the
read-only preflight shows `other_sessions=0` immediately before the request. One assertion in
`ops/local/verify-pilot-db-tls.sh` was corrected and disclosed: the host postmaster start time
moves on every host reboot, so the provisioning-order comparison is now anchored by an optional
`PILOT_SESSION_START` (the original strict comparison applies when it is not supplied). No live
activation, no reconciliation, no send, no merge and no provider contact occurred. Evidence
[G5A-REDIRECT-DEPLOYMENT-2026-11-09](docs/evidence/G5A-REDIRECT-DEPLOYMENT-2026-11-09.md).
**G5A_REDIRECT_DEPLOYED_RECONCILIATION_AWAITING_OWNER_START**

**WSL2 host and Docker recovery (2026-11-09/10):** `WSL_DOCKER_RECOVERY_BLOCKED` — the disk-full
outage that blocked the 15:15–15:30Z reconciliation window is resolved at host level (R1 freed
4.68 GB, C: 5.56 GB free; R2 produced a 137.26 GB pre-start copy on D: with SHA-256
`a15c32e9…d69ef3`), the distro boots, the repository is clean at `a112327` and the fence was not
touched. The pilot stack could **not** be restored: after the crash Docker Desktop no longer
provisions WSL integration for `Ubuntu-24.04` (settings lost the distro list at 15:32Z, the
per-distro agent exited at 15:24:12Z, and the backend that has run since 18:25:25Z never re-added
one), so **every** bind mount from the distro resolves to an empty directory in containers — proved
with an existing pilot certificate and with a file created seconds before the test — not merely the
stale hashed references of the three pilot containers. `pilot-postgres` was recreated from the
reviewed provisioning recipe (same pinned digest, environment, command, health check, restart
policy and mounts; new container ID, volume `pilot-postgres-data` never removed or initialised —
63 MB, `PG_VERSION` 17 intact) and stops at TLS load because its certificate bind is empty; the
application and the egress gateway were not started. Fixing the integration needs a Docker Desktop
restart, which the authorization's §8 forbids, so no health, TLS, allowlist, egress or
authoritative database check was reached and the expected control state (`uncertain`, epoch 7,
gap 7, `reconciliation_required=true`, audit 28) is neither confirmed nor contradicted. No
reconciliation request, no QR, no provider contact, no database reset, no certificate or credential
regeneration, no image change, no network change, no VHDX move and no unrelated-container
restart occurred; the three volume-only containers of the other projects can be started on their
own authorization, while the zena application and Docker-based CI jobs share the pilot's blocker.
Evidence [WSL-DOCKER-RECOVERY-2026-11-09](docs/evidence/WSL-DOCKER-RECOVERY-2026-11-09.md).
**WSL_DOCKER_RECOVERY_BLOCKED**

**G5-A TWO-HOP FIX DEPLOYED, QR VIEWER ACCEPTED, RECONCILIATION PREPARED — `G5A_TWO_HOP_DEPLOYED_RECONCILIATION_AWAITING_OWNER_START` (2026-11-11).**
The Owner's deployment authorization was executed at `08:43Z`. The private pilot now names
`zalo-shared-connector:g5-ci-d6f8aec` (config `sha256:9923258e…`, archive `d2410cdb…`,
`sourceCommit d6f8aec…`, scan 0 HIGH/CRITICAL) with the exact four-host inventory
(`id.zalo.me`, `wpa.chat.zalo.me`, `jr.chat.zalo.me`, `jr.zaloapp.com`; `chat.zalo.me` excluded),
the compiled two-hop policy byte-identical to the reviewed build, `pilot-egress` internal with
the gateway as its only member, and no connector container. The gateway was recreated once
during deployment (a first start used the script default and was immediately corrected); the
reconciliation wrapper binds a deployment baseline of the same container, image, creation time
and a byte-identical log. The QR viewer was accepted with one controlled synthetic rehearsal:
one visible window, duplicate launches and refreshes opened none, and ordinary close, timeout
and forced kill each left no copy. Typecheck and transport 178/178 pass at HEAD; the preflight
passes with the fence `uncertain` epoch 9, gap 9, `reconciliation_required=true`, audit 33 and
0 advisory locks. Independent acceptance review returned **APPROVE WITH CONDITIONS** with no
blocking finding; both documentation conditions are closed in the evidence commit and five
residuals are disclosed. The epoch 9→10 reconciliation is prepared and **not executed**: the
Owner window file does not exist. No QR, provider contact, reconciliation, additional provider
host, production deployment, PR merge or retry occurred. Evidence
[G5A-TWO-HOP-DEPLOYMENT-2026-11-11](docs/evidence/G5A-TWO-HOP-DEPLOYMENT-2026-11-11.md).
**G5A_TWO_HOP_DEPLOYED_RECONCILIATION_AWAITING_OWNER_START**

**G5-A EPOCH-9 RECONCILIATION EXECUTED AND INDEPENDENTLY VERIFIED — `G5A_RECONCILIATION_PASS_AWAITING_BOOTSTRAP_DECISION` (2026-11-11).**
The Owner's single reconciliation authorization was used exactly once inside the
`09:12:00Z–09:27:00Z` window. The prepared wrapper ran at `09:12:08Z` at HEAD `973ea7e`:
preflight passed all 14 predicates, the application was quiesced with `other_sessions=0`,
and exactly one authenticated `POST /api/provider/operations/reconcile`
(`4203bde7-f27e-4f5c-adda-e8f4e4eb62fe`) returned HTTP 200
`{"ok":true,"epoch":"10","gapVersion":"10","alreadyApplied":false}` at `09:12:15.840Z`.
Independent read-only verification confirms ownership `idle`, epoch 10, owner null;
provider `disconnected`, gap 10, `reconciliation_required=false`; audit 33 → 36 with
exactly one new `connector.reconciled` row (id 35) bound to the request id and evidence
reference, one login and one logout, and all 33 prior rows preserved; fencing
(`last_fenced_owner_id` `0280fd84-…`, `last_fenced_epoch` 9, `last_fenced_at`
`09:12:15.840Z`) intact; zero sessions, zero unresolved work, zero advisory locks; no
connector container; application `running healthy`; gateway container, creation time and
log (`be08a8a0…`, zero tunnels) unchanged; no provider contact. Attempt marker
`outcome=reconciled`, `exitCode=0`; the wrapper's own post-check also passed. No retry,
replay, direct SQL, alternative endpoint or window extension occurred. A new G5-A
bootstrap is not authorized by this result and requires a fresh explicit Owner window
bound to the deployed source commit `d6f8aec…`. Evidence
[G5A-RECONCILIATION-EXECUTION-2026-11-11-EPOCH9](docs/evidence/G5A-RECONCILIATION-EXECUTION-2026-11-11-EPOCH9.md).
**G5A_RECONCILIATION_PASS_AWAITING_BOOTSTRAP_DECISION**

**G5-A BOOTSTRAP ATTEMPT `14:43Z` FAILED, QR EXPIRED UNSCANNED — `G5A_BOOTSTRAP_FAIL` (2026-11-11).**
The Owner's single bootstrap authorization for `14:43:00Z–15:13:00Z` was used
exactly once. All preflight predicates passed against the deployed two-hop build
(`g5-ci-d6f8aec`), the connector acquired ownership at epoch 11, opened only
`id.zalo.me:443` and reached `qr-shown` at `14:44:50.757Z`; the automatic viewer
reported an interactive, topmost, visible window at `14:44:51Z`. No `scanned`
stage occurred, and the provider QR lifetime expired at `14:46:30.759Z`
(`gate=unavailable`, `reason=qr-expired`). Disclosed: the viewer logged no
close/timeout line and its guard removed the staged copy at `14:44:52Z`,
consistent with the window ending about one second after appearing when the
launching background shell exited; the attempt fails on QR expiry regardless,
and no second QR was generated. No UID, display name, terminal `confirm`,
encrypted session or account data exists; the view directory is empty and no
viewer or connector process remains. The fence is `uncertain` epoch 11
(`1c6bebbb-…`, `shutdown`), provider gap 11 with `reconciliation_required=true`,
audit 36 → 38 with prior rows intact. A new Owner-authorized reconciliation
(epoch 11 → 12) is required before another bootstrap; no retry, alternate flow,
allowlist change, production deployment or PR merge occurred. Evidence
[G5A-BOOTSTRAP-ATTEMPT-2026-11-11T1443Z](docs/evidence/G5A-BOOTSTRAP-ATTEMPT-2026-11-11T1443Z.md).
**G5A_BOOTSTRAP_FAIL**

**QR VIEWER LIFETIME DEFECT FIXED AND REHEARSED (2026-11-11/12, `85cfea4`).**
The one-second window loss was reproduced: a viewer started directly from WSL dies
with the launching process tree, while a `Start-Process` (ShellExecute) child
survives it (2 vs 40 heartbeats). `ops/local/launch-qr-viewer.sh` now starts the
viewer detached through a short-lived PowerShell launch session, tracks liveness
through Windows `tasklist` because the viewer is no longer a child, and keeps the
launch lock out of the viewer's handle table. `ops/local/qr-viewer.ps1` hides its
own console on start; both are parser-checked and offline-tested. The rehearsal
gained a regression that kills the launching process group with `SIGKILL` and
then asserts the viewer is still alive and logging, followed by a clean
`source-cleared` close with no staged copy; the full rehearsal passes with exactly
one visible window and no residue. The procedure document records the new launch
semantics. This closes the fix required before any further G5-A attempt; it is
not a gate and authorizes no bootstrap, QR, provider contact or reconciliation.
Fix commits `d9bb8c7`, `85cfea4`; see step 4 of
[G5-LIVE-PILOT-PROCEDURE](docs/operations/G5-LIVE-PILOT-PROCEDURE.md) and
`ops/local/rehearse-qr-viewer.sh` §11.

**G5-A EPOCH-11 RECONCILIATION `12:10Z` WINDOW NOT EXECUTED — `G5A_RECONCILIATION_BLOCKED` (2026-11-12).**
The two independent blockers the authorization names both held. First, no reviewed
epoch-11 executor or incident-bound request exists: the only reconciliation
wrapper is `ops/local/reconcile-20261111.sh`, bound to the epoch-9 incident (owner
`0280fd84-…`, epoch 9, gap 9, post-state epoch 10) with a request already consumed
at `09:12Z` and a one-shot marker already present; `reconcile-pilot.sh` is the
epoch-5 binding; the private state has requests and windows only through
`2026-11-11`, and no `reconcile-request-2026-11-12.json` or
`reconcile-attempt-20261112.json`. Authoring a new owner/epoch/request binding
inside the window would itself be an unreviewed security binding. Second, the host
container runtime is down: `docker` is absent in WSL, `/var/run/docker.sock` does
not exist, `/mnt/wsl` holds only `resolv.conf`, the `docker-desktop` distro is
Stopped, Windows `com.docker.service` is Stopped and no Docker Desktop process is
running. Inside the window (`12:10:22Z`–`12:11:11Z`) the tree was clean at
`85cfea4`, the reviewed driver and preflight blobs still matched their pins
(`bb7a18cc…`, `b3f34274…`), the private tree held only `session.key` (no
`session.enc`, no QR, no quarantine), and no epoch-11 request or marker existed.
Every database, gateway, quiescence, lock, session and image predicate is
UNVERIFIED; the last verified control state remains `uncertain` epoch 11 (owner
`1c6bebbb-…`, `shutdown`), provider gap 11 `reconciliation_required=true`, audit
38, and this attempt neither confirms nor contradicts it. No request, container
action, marker, SQL write, host action, QR, provider contact, deployment or merge
occurred. Proceeding needs host-runtime recovery under its own authorization,
authoritative re-read of the epoch-11 rows, a reviewed epoch-11 wrapper and a new
Owner UTC window. Evidence
[G5A-RECONCILIATION-2026-11-12T1210Z-BLOCKED](docs/evidence/G5A-RECONCILIATION-2026-11-12T1210Z-BLOCKED.md).
**G5A_RECONCILIATION_BLOCKED**

**G5-A EPOCH-11 RECONCILIATION PREPARED — `G5A_EPOCH11_RECONCILIATION_READY_AWAITING_OWNER_START` (2026-11-13).**
After the host-runtime recovery the pilot stack was rebuilt from the reviewed
recipes (`pilot-postgres`, `zalo-shared-pilot-app-1` and the unchanged egress
gateway all healthy; TLS, internal network, four-host allowlist and LAN exposure
checks PASS) and the authoritative fence was re-read read-only: `uncertain`, epoch
11, owner `1c6bebbb-…`, fault `shutdown`, uncertain at `2026-11-11T14:46:30.766Z`,
last fenced `0280fd84-…`/9; provider `disconnected`, gap 11,
`reconciliation_required=true`; audit 38 rows, max 38, five reconciled, zero
fenced; no advisory lock. `ops/local/reconcile-20261113.sh` re-binds the reviewed
driver and preflight blobs (still `bb7a18cc…`/`b3f34274…`) to that incident with
post-state `idle|12|…|disconnected|12|false`, adds request-permission,
Owner-approval, `connector.fenced`-absence and deployed-image checks, and still
requires an Owner window file and a one-shot marker that do not exist. The
request (`notSent`, reference `G5A-OWNER-AUTH-2026-11-13-RECONCILIATION`) and the
renewed gateway baseline are private and in place. Offline evidence: 106/106
wrapper refusal assertions, the driver harness (window, expiry, DB lock, replay),
the disposable CSRF/auth suite 19/19, the application suite 421 tests, and the QR
rehearsal with a detached viewer that survived its launching process-group kill.
An independent review returned READY WITH OBSERVATIONS; its one text defect was
corrected. One rehearsal run failed a timing-sensitive handover assertion and the
next passed — recorded, not changed. Nothing was stopped, sent or reconciled; the
fence is unchanged and no bootstrap, QR, provider contact, observation, send,
deployment or merge is authorised. Evidence
[G5A-EPOCH11-READINESS-2026-11-13](docs/evidence/G5A-EPOCH11-READINESS-2026-11-13.md).
**G5A_EPOCH11_RECONCILIATION_READY_AWAITING_OWNER_START**
