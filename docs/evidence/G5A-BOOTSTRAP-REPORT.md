# G5-A bootstrap report

**Current verdict:** `G5A_BOOTSTRAP_FAIL` — the 2026-11-04 live enrollment did not
complete; no session was persisted and no UID binding was established (§9).
**Attempt history:** 2026-11-03 02:00Z `G5A_BLOCKED` (§1–§7) · 2026-11-03
14:56Z `G5A_BLOCKED` (§8) · 2026-11-04 00:46Z `G5A_BOOTSTRAP_FAIL` (§9).
**Report date:** 2026-11-03, extended 2026-11-04
**Owner authorization:** G5-A only, `2026-11-03T02:00:00.000Z` – `2026-11-03T02:30:00.000Z` (09:00–09:30 Vietnam time)
**Verified baseline:** `f726a780283a3108cbde6b196c32b3fee423bbc1`
**Connector artifact source:** `6d199162e8b00d7b4968b6b1fd82450b4387f4df`
**Connector image:** `zalo-shared-connector:g5-6d199162`, local digest `sha256:6b1f0100017d067f24d18eee53ffbfcffe7562ac3f79fd98283097ef1938d781`

## 1. Outcome (first attempt, 2026-11-03 02:00Z window)

No live action occurred. The connector was not started, no SDK was imported for
authentication, no QR was generated or displayed, no session was written, and no
message was observed or sent.

Mandatory preflight found two blocking conditions before the authorized window
opened:

1. **Host-level controlled egress could not be established or verified.** Windows
   Firewall is enabled on all profiles and default inbound is closed, but the
   WSL2 host has no `iptables`, `nft`, `ufw` or equivalent egress-filtering
   tooling. Default outbound is unrestricted. There is no reviewed, scoped
   allowlist that limits the connector to DNS and provider TLS. Proceeding would
   leave unrestricted outbound access, contrary to the mandatory preflight and
   the G4 isolation assumption.
2. **A local application credential entered the private session transcript.**
   During read-only environment inspection, the G2 application container's
   `DATABASE_URL` (a local `zs_app` database role) was printed unmasked. It is
   not a Zalo credential, UID, QR or session value, and it was not written to the
   repository, GitHub or CI, but it violates the "no live credentials in logs or
   transcripts" preflight requirement. The credential must be rotated before any
   live authentication.

The authorized window was therefore not entered for authentication. This report
is the terminal G5-A outcome for this authorization.

## 2. Preflight results

Checked at `2026-11-03T01:45:01.582Z`, before the authorized start.

| Check | Result | Evidence |
| --- | --- | --- |
| UTC time inside approved window | PASS (preflight only, before start) | `date -u` returned `2026-11-03T01:45:01.582Z`; no live command was run before `02:00:00Z` |
| Source, lockfile and image identity | PASS | Baseline `f726a78`; embedded source `6d19916…`; local lock SHA-256 `17dcd254…` and SDK integrity match the image build identity |
| Approved Windows/WSL host | PASS | Windows 11 Pro build 26100; WSL2 Ubuntu 24.04.4 LTS; kernel `6.6.87.2-microsoft-standard-WSL2` |
| Firewall and localhost-only inbound | PARTIAL | Windows Firewall enabled on Domain/Private/Public; default inbound not configured (block); no inbound allow rules for 5432, 2026, 3100 or 46245. Mirrored WSL networking means the Windows profile applies. LAN isolation was not tested from a second host |
| Controlled egress | **FAIL** | Default outbound not configured (allow); no host firewall tooling in WSL to add a scoped allowlist; unrestricted outbound would remain |
| Private files, key and UID 65532 | PASS | `session.key` 32 bytes, mode 0600, owner 65532; state directories 0700 owner 65532; image runtime UID 65532 |
| Account-specific manifest and consent binding | NOT EXECUTED | Only synthetic G5 manifests exist; a live enrollment manifest was not created because blocking conditions were found first |
| Owner and dedicated phone present | OWNER DECLARED | Owner authorization and direct participation declared; phone presence not independently verified and no QR was produced |
| Exclusive connector ownership | PASS | No connector container; `connector_ownership.phase='idle'`, epoch 0; `provider_state.status='disconnected'` |
| Emergency stop and session revocation ready | READY | Procedure documented; no session exists to revoke |
| Observe/send workers and media disabled | PASS | G2 application runs `PROVIDER_MODE=disabled`, `MOCK_ENABLED=false`; bootstrap constructs no dispatcher; G5 policy refuses media before egress |
| No live credentials/UID/QR/session in logs or artifacts | **FAIL** | Local G2 `DATABASE_URL` app-role credential was printed into this private session transcript; no Zalo credential, UID, QR or session value was involved |

Unrelated host services were observed listening on `0.0.0.0:5432` and `*:2026`.
Windows Firewall default inbound blocking is the only control shown; LAN
reachability from a second host was not verified. This is recorded as a
host-hardening residual, not as pilot-specific exposure: the pilot connector was
never started and publishes no ports.

## 3. Required G5-A outcomes

| Required outcome | Result |
| --- | --- |
| Correct QR enrollment for Zalo A | NOT ATTEMPTED — blocked |
| Exact account UID binding | NOT ATTEMPTED — blocked (no UID exposed) |
| Encrypted session persistence | NOT ATTEMPTED — no session written |
| Official phone remains usable | NOT TESTED — no enrollment occurred |
| Safe connector shutdown | NOT APPLICABLE — connector never started |
| Sanitized evidence and definitive verdict | COMPLETE — this report, `G5A_BLOCKED` |

## 4. Evidence boundary

This report contains **synthetic/offline and host-preflight evidence only**. It
contains no live provider evidence. No Zalo account was authenticated, no phone
coexistence was observed, and no delivery, session renewal or platform behaviour
was exercised. The account alias `Zalo A` is the only account reference; no UID,
phone number, QR, cookie, token, message body or key appears here.

## 5. Residual risks

- The G2 application database role credential exposed in the private transcript
  remains valid until rotated. Risk is limited to a local, unpublished database,
  but the credential must be treated as compromised.
- Host outbound traffic remains unrestricted by default. A future live stage
  must not start until a reviewed egress allowlist is enforced and verified.
- LAN inbound isolation for the unrelated `0.0.0.0` listeners was not
  independently tested from a second host.
- No live Zalo behaviour has been proven; provider authentication, QR
  interoperability, phone coexistence, delivery and account risk remain
  **UNPROVEN**.

## 6. Remediation required before a new G5-A authorization

1. Rotate the local `zs_app` database role password, update the private
   environment and the G2 application, and confirm the old credential no longer
   works. Treat any transcript or log containing it as compromised private data.
2. Establish and verify a scoped host egress policy for the pilot: only DNS and
   the provider's required TLS endpoints, with all other outbound traffic
   dropped. Use reviewed tooling and record the exact rules; do not rely on an
   undocumented host condition.
3. Verify LAN inbound isolation from a second host, not only from localhost, for
   any listening service on the pilot host.
4. Create the live enrollment manifest and consent binding for the exact
   authorized window and run the offline `preflight` for the `bootstrap` stage.
5. Request a new explicit G5-A authorization with a fresh UTC window. This
   authorization cannot be reused.

## 7. Next-stage recommendation

Do not proceed to G5-B. The requested state after this report is
`G5B_AWAITING_SEPARATE_OWNER_AUTHORIZATION`, but G5-B is **not authorized** and
must not start from a blocked G5-A. A new G5-A authorization is required after
the remediation above.

**STOP — `G5A_BLOCKED`. No live authentication, observation, sending, media,
production deployment or PR merge is authorized.**

## 8. Second authorization attempt — 2026-11-03 14:56–15:26Z

**Authorization:** `G5A_LIVE_BOOTSTRAP_ONLY`, window
`2026-11-03T14:56:00Z`–`2026-11-03T15:26:00Z`
**Verified baseline:** `c38afce`; connector image `zalo-shared-connector:g5-local`
`sha256:9bced3eb…c8427998` (embedded identity `2dff06e`); gateway
`zalo-shared-egress-gateway:g5-local` `sha256:bfde5c7a…85ad4e75`
**Verdict:** `G5A_BLOCKED`
**Live Zalo action:** none — no provider connection, QR, session or ownership change

The window was valid: `2026-11-03T14:57:07Z` at the authorization check and
`2026-11-03T14:59:52Z` at the last preflight query, both inside the window. The
flow stopped on a control failure before the hard expiry, not on expiry.

### Preflight

| Control | Result | Observation |
| --- | --- | --- |
| Reviewed source identity | PASS | `HEAD` is `c38afce`; `git diff 2dff06e..HEAD` over `adapters/`, `connector/`, `ops/Dockerfile.connector`, `server/`, `tools/`, the connector lock and `tsconfig.connector.json` is empty |
| Connector and gateway image identity | PASS | digests above; the embedded build identity matches `2dff06e`, the connector lock (`17dcd254…`) and the SDK integrity (`sha512-pBU0T0/…`) |
| No competing connector or SDK process | PASS | no `pilot-connector`, `pilot-runtime`, `zca-js` or `egress-gateway` process; no connector container running |
| Private state permissions | PASS | state and view `0700`, `session.key` and manifest `0600`, UID 65532 |
| Database credential effective | PASS | the private URL authenticates; `pilot_send_budget`, `pilot_part_ledger`, `connector_ownership`, `messages` and `outbox` exist |
| Database transport for a non-loopback URL | **FAIL** | the pilot Postgres reports `ssl = off` and the private URL has no `sslmode`; `requireTlsDatabaseUrl` admits only `require`, `verify-ca` or `verify-full` for a non-loopback host, so every live connector command refuses this database |
| Kernel-enforced boundary active | **FAIL** | no `pilot-db`, `pilot-egress` or `pilot-uplink` network exists and no gateway container is running |
| Approved bootstrap hosts enforced live | **FAIL** | the reviewed list exists only in `ops/pilot-compose.example.yml`; there is no running gateway to admit it |
| Live enrollment grant | **FAIL** | the private manifest is an explicit template (`<OWNER_CONSENT_REF>`, `<OWNER_GRANT_ID>`, placeholder timestamps) with a build block for `8d40c0f`, so it cannot match the reviewed `2dff06e` image |
| Observe, send-test and media disabled | PASS | no pilot command running; only bootstrap was contemplated |

### Why no live start

1. **Database TLS is unsatisfiable as provisioned.** Closing it requires enabling
   TLS on the pilot Postgres and issuing an `sslmode=require` URL — a change to
   shared pilot infrastructure outside the reviewed bootstrap sequence. Neither
   relaxing the gate nor improvising that change inside a live-account window is
   acceptable, and the connector would refuse the database at startup regardless
   of any grant or topology work.
2. **The boundary is not deployed**, so it could not be confirmed active.
3. **There is no live grant**; the only manifest is a placeholder template bound
   to a superseded artifact.

Generating the grant and starting the reviewed topology are authorized steps,
but they do not cure the database gate, and doing all remediation ad hoc would
leave the first-ever live enrollment outside the reviewed sequence.

### State left behind

No provider connection, QR generation, scan, session write, ownership
acquisition or database write occurred. `session.key` and the view directory are
unchanged (last modified 2026-11-02). No pilot network or container exists; the
temporary container used to read the embedded build identity was removed. No
host-wide firewall, routing or daemon setting was changed. PR #3 remains Draft;
its head was `c38afce` throughout the attempt and this record is the only commit
added on top of it.

### Added remediation

4. Decide and review the pilot database transport: enable TLS on the pilot
   Postgres with an `sslmode=require`/`verify-full` URL, or provision a dedicated
   pilot database that satisfies `requireTlsDatabaseUrl`. Do not relax the gate.
5. Deploy the reviewed topology and confirm with
   `ops/local/verify-pilot-network.sh` that `pilot-db` and `pilot-egress` are
   `internal=true`, the gateway is the only workload on `pilot-uplink`, and the
   connector has no usable default route.
6. Generate the live `enroll-session` grant against the reviewed image with
   consent terms equal to the Owner authorization, admit it with the offline
   preflight, and rehearse the private QR handoff before requesting a new window.

**STOP — `G5A_BLOCKED` for this window as well. No live authentication,
observation, sending, media, production deployment or PR merge is authorized.**

## 9. Third authorization attempt — live bootstrap, 2026-11-04 00:46–01:16Z

**Authorization:** `G5A_LIVE_BOOTSTRAP_ONLY`, window
`2026-11-04T00:46:00Z`–`2026-11-04T01:16:00Z` (07:46–08:16 Vietnam time),
scope: one private Zalo A QR enrollment, Owner physically present.
**Verdict:** `G5A_BOOTSTRAP_FAIL` — the single authorized bootstrap ran and
produced a QR, but the enrollment did not complete: no session was written and
no UID binding was established. **Specific abort cause: UNPROVEN** (the console
stdout of the one container was not retained).
**Attempts started:** two launcher invocations, of which only the second reached
the connector or the provider. The first exited in ~3 s on a command-path error
inside the reviewed image and made no provider contact (no gateway event, no
ownership change, no QR). It is a launcher defect record, not a QR retry.

### Verified identity at the attempt

| Item | Value |
| --- | --- |
| Repository HEAD at attempt | `3ceac2b8203ac63a082fd7ded0d9cfaadcf7a705` |
| Connector sources | unchanged since reviewed `2dff06e063b87d6abf5e25e4a1ca9c369ba7236e`; between `2dff06e` and HEAD only `ops/` tooling and evidence documents differ |
| Connector image | `zalo-shared-connector:g5-local`, image id `sha256:9bced3eba32ae900d427542a03c06275a39acd91e8caa284e433d0ebc8427998` |
| Embedded build identity | sourceCommit `2dff06e…`, lock `17dcd254…030c9b`, SDK integrity `sha512-pBU0T0/…Ox4pgA==`; `sourceCommitMatches`, `lockMatches`, `sdkMatches` all true |
| Runtime user | UID 65532 |

### Preflight (mandatory, before grant creation)

Run `00:46:58Z`–`00:47:18Z`. The first pass reported one failing check from a
UUID/text type error in the checker's ownership query; the query was corrected
and the preflight re-run before any grant existed. Final result rc=0, **22/22
PASS**:

- UTC time inside the authorized window;
- `zalo-shared-pilot-db` `Internal=true`, `zalo-shared-pilot_pilot-egress`
  `Internal=true`, `zalo-shared-pilot_pilot-uplink` `Internal=false`;
- `egress-gateway` running, healthy, UID 65532, no published port,
  `ip_forward=0`, attached only to egress+uplink and the sole uplink member;
- gateway allowlist exactly `id.zalo.me,wpa.chat.zalo.me,jr.chat.zalo.me`;
- no connector container and no host `pilot-connector`/SDK process;
- ownership `idle` with no owner; no provider state requiring reconciliation;
- private modes: base `0700` UID 1000, `pilot` `0700` UID 65532, `session.key`
  `0600` UID 65532, `state` `0700` UID 65532, CA `0644` UID 0;
- no pre-existing `session.enc`; consent scope `enroll-session` only, null
  account, zero peers; reviewed allowlist file admits exactly the three hosts.

### Grant

`issuedAt` `2026-11-04T00:48:43Z`, `expiresAt` `2026-11-04T01:14:00Z`,
consent `notAfter` `2026-11-04T01:16:00Z`, purpose `enroll-session`,
`expectedAccountId` null, `allowedPeerIds` empty, `maxPartsPerDay` 10,
`minIntervalMs` 2000. The in-image `preflight`, run with no network namespace,
returned `"gate":"admitted"` with `"purpose":"enroll-session"`. The grant is
still in the private directory and is inert after `01:14:00Z`; it was used once.

### Timeline (UTC, 2026-11-04)

| Time | Event |
| --- | --- |
| 00:47:18 | mandatory preflight complete, 22/22 PASS |
| 00:48:43 | enrollment grant issued |
| 00:48:46 | offline in-image preflight admitted the live grant (no network namespace) |
| 00:49:33 | first launcher invocation — command-path error in the reviewed image, exit after ~3 s, no provider contact |
| 00:53:05 | offline compose `preflight` through the same console/TTY path reported `tty stdin=yes stdout=no`, confirming the confirmation prompt would have a TTY; no provider contact |
| 00:54:29 | corrected launcher start (`bootstrap --acknowledge-pilot-risk`, one instance) |
| 00:54:31.547 | ownership `reserved`, epoch 1, label `pilot-enrollment`; audit `connector.reserved` |
| 00:54:32.247 | gateway `sni_allow id.zalo.me:443` (49.213.95.230) from the connector address — the only gateway event of the attempt |
| 00:54:33 | `qr.png` written `0600` in the `0700` view directory and copied to the Owner's Windows-visible private path; never transmitted, screenshot or uploaded |
| ~00:55 | local QR copy present; whether the Owner opened or scanned it is **UNPROVEN** |
| 00:56:01.670 | ownership invalidated to `uncertain` (fault `shutdown`); audit `connector.uncertain` |
| 00:56:02 | connector process ended, exit code 1 (launcher status file) |
| 00:56:0x | view directory cleared by the connector; no `session.enc`, no quarantine record |
| 00:57–01:00 | post-exit verification: no connector container or process, gateway healthy, no further egress |

### Required G5-A outcomes

| Required outcome | Result |
| --- | --- |
| Correct QR enrollment for Zalo A | **FAIL** — QR emitted `00:54:33Z`, enrollment not completed |
| Exact account UID binding | **NOT ESTABLISHED** — no UID was read or confirmed; no UID appears in this report |
| Encrypted session persistence | **NONE** — no `session.enc` and no `*.quarantine-*`; `session.key` unchanged |
| Official phone remains usable | **UNPROVEN** — not confirmed by the Owner; no session exists to revoke |
| Safe connector shutdown | **PASS (containment)** — single process, exit 1, ownership fenced `uncertain`, no residual container/process, QR cleared |
| Provider contact confined to the reviewed allowlist | **PASS** — one `sni_allow` for `id.zalo.me`; zero denials, zero other destinations |
| Observe, send-test, media, contact discovery | **NOT STARTED** — not authorized and not invoked |
| Sanitized evidence and definitive verdict | **COMPLETE** — this section, `G5A_BOOTSTRAP_FAIL` |

### Failure analysis

- `connector_ownership.fault_code='shutdown'` is the generic label the reviewed
  ownership store writes when any process closes; it does not identify the abort
  cause.
- The container ran with `--rm` and its stdout/stderr went only to the console
  window, which was not captured to a file. The exact abort reason is therefore
  **UNPROVEN**; no claim is made that Zalo rejected the scan, that the QR
  expired, or that the Owner's confirmation failed.
- In the reviewed adapter, a non-zero exit before a session install can follow
  the QR-expiry event, a decline, an invalid callback, ownership loss, the 120 s
  deadline, a view failure, a refused or mismatched identity confirmation, or an
  SDK/API failure. The observed elapsed time (93 s from launcher start) is inside
  the 120 s deadline, but that alone does not distinguish the other paths.
- No session record and no quarantine artifact exist, so either the session
  write never started or it failed before install. No credential was written.
- The QR was emitted at `00:54:33Z` and the Windows-visible copy existed by
  ~`00:55Z`, leaving less than the full QR lifetime for the scan and the terminal
  `confirm` prompt. This is an observation, not an established cause.

### State left behind

- `connector_ownership`: phase `uncertain`, epoch 1, fault `shutdown`, last
  reservation `00:54:31Z`. `provider_state`: `disconnected` with
  `reconciliation_required=true`, fault `shutdown`. Both are the fail-closed
  result of the close path and were **not** reset: the next G5-A preflight will
  refuse until the Owner decides how to reconcile them.
- No `session.enc`, no quarantine file, no QR image. `/home/zen/qr-live.png` was
  deleted, and every temporary QR helper script was removed; the private view
  directory is empty `0700` UID 65532.
- `pilot_send_budget` and `pilot_part_ledger` are empty; no message was sent,
  observed or queued. No observe/send-test workflow ran.
- The gateway, `pilot-postgres` and the reviewed topology remain running and
  healthy. No host firewall, routing or Docker daemon setting was changed and the
  provider allowlist was not expanded.
- The launcher status file records `start=00:54:29Z end=00:56:02Z exit=1`.
  The preflight and launcher scripts remain on the private host for
  reproducibility (SHA-256 `ba6ea247…24c0b` and `0f5b7c7b…7d00e`).

### Residual risks and required changes before a new G5-A authorization

1. **Unattributable abort.** Persist the connector's stdout/stderr to a `0600`
   private log on any future run, with secrets still excluded by the adapter, so
   the abort reason can be recorded rather than inferred. This is the single
   most important change; without it a second failure would again be
   un-attributable.
2. **QR handoff timing.** Pre-open the local viewer before starting and rehearse
   reaching the terminal `confirm` prompt; the QR lifetime did not fit the
   observed handoff copy latency.
3. **Owner decision on control state.** `connector_ownership` is `uncertain` and
   `provider_state` requires reconciliation. Reusing the connector requires an
   Owner-approved, reviewed reset; this report does not do it.
4. **Phone state.** The Owner must confirm the official phone is still logged in
   and operational. No session was created, so there is nothing to revoke.
5. **Unsigned images and runtime-only hosts** remain as previously recorded
   residuals. Phone coexistence, QR interoperability and live provider behaviour
   remain **UNPROVEN**.

### Evidence boundary

§9 is live evidence for one provider contact, one QR emission and one fenced
shutdown on the Owner's machine. It contains no account UID, peer UID, phone
number, QR image or data, cookie, token, key or message body, and no console
transcript of the connector. It does not establish Zalo account behaviour,
phone coexistence or production readiness. G5-B and G5-C remain **not
authorized**.

**STOP — `G5A_BOOTSTRAP_FAIL`. The authorization is consumed and must not be
reused or extended. No retry, observe, send-test, media, production deployment
or PR merge is authorized; a new G5-A authorization is required.**
