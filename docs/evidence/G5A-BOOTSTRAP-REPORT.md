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
produced a QR, the Owner scanned and confirmed it on the official phone, but the
connector did not complete: no session was written and no UID binding was
established. **Abort cause: the SDK's post-confirmation handshake was refused
locally, not by the provider; the exact handshake step is UNPROVEN** because the
one container's console output was not retained. §10 narrows the candidate to the
`checkSession` redirect after the phone confirmation and records the Owner's
device-history evidence.
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
| 00:53:05 | offline compose `preflight` through the same console path admitted the grant; its `tty` line is not usable because the diagnostic redirected its own stdout |
| 00:54:29 | corrected launcher start (`bootstrap --acknowledge-pilot-risk`, one instance) |
| 00:54:31.547 | ownership `reserved`, epoch 1, label `pilot-enrollment`; audit `connector.reserved` |
| 00:54:32.247 | gateway `sni_allow id.zalo.me:443` from the connector — the only gateway event of the attempt (no network address is recorded in this repository) |
| 00:54:33 | `qr.png` written `0600` in the `0700` view directory and copied to the Owner's Windows-visible private path; never transmitted, screenshot or uploaded |
| ~00:55 | local QR copy present; the Owner scanned it with the official phone and completed the confirmation on the phone (Owner attestation; exact time not recorded) |
| 00:56:01.670 | ownership invalidated to `uncertain` (fault `shutdown`); audit `connector.uncertain` |
| 00:56:02 | connector process ended, exit code 1 (launcher status file) |
| 00:56:0x | view directory cleared by the connector; no `session.enc`, no quarantine record |
| 00:57–01:00 | post-exit verification: no connector container or process, gateway healthy, no further egress |

### Required G5-A outcomes

| Required outcome | Result |
| --- | --- |
| Correct QR enrollment for Zalo A | **FAIL (local)** — QR emitted `00:54:33Z` and the Owner scanned and confirmed it on the phone; the connector still exited 1 without persisting a session, so no local enrollment exists |
| Exact account UID binding | **NOT ESTABLISHED** — the connector did not complete its UID confirmation step; no UID was recorded and none appears in this report |
| Encrypted session persistence | **NONE** — no `session.enc` and no `*.quarantine-*`; `session.key` unchanged |
| Official phone remains usable | **CONFIRMED BY OWNER** — the official phone remains logged in and operational (Owner attestation, not instrumented) |
| Safe connector shutdown | **PASS (containment)** — single process, exit 1, ownership fenced `uncertain`, no residual container/process, QR cleared |
| Provider contact confined to the reviewed allowlist | **PASS** — one `sni_allow` for `id.zalo.me`; zero denials, zero other destinations |
| Observe, send-test, media, contact discovery | **NOT STARTED** — not authorized and not invoked |
| Sanitized evidence and definitive verdict | **COMPLETE** — this section, `G5A_BOOTSTRAP_FAIL` |

### Owner attestation

After the window closed, the Owner confirmed two facts that this report did not
have when §9 was first written: the QR **was scanned and the confirmation was
completed on the official phone**, and the phone **remains logged in and
operational**. Both are Owner attestations, not instrumented observations. They
move phone coexistence from UNPROVEN to confirmed, and they localise the failure
to the connector's own steps after the provider login resolves.

### Failure analysis

- `connector_ownership.fault_code='shutdown'` is the generic label the reviewed
  ownership store writes when any process closes; it does not identify the abort
  cause.
- The container ran with `--rm` and its stdout/stderr went only to the console
  window, which was not captured to a file. The specific abort reason therefore
  remains **UNPROVEN**, but the candidate set is now small.
- Because the Owner scanned and confirmed, the provider-side login resolved.
  After that point the reviewed SDK can still reject inside its own
  post-confirmation handshake (`checkSession`, `getUserInfo`, the
  stored-credential login) before `loginQR` resolves; in that case event type 4
  never fires and the adapter exits before its UID prompt. Once `loginQR`
  resolves, the adapter can fail only at one of these fail-closed gates, in
  order: the UID read and shape check (the grant expects a null account, so a
  mismatch is impossible), capture of `imei`/`userAgent` (populated only by
  event type 4), `PrivateQrFileView.confirmIdentity`, the cookie-jar snapshot,
  grant freshness/ownership re-assert, or the encrypted session write. Each
  throws to the same generic `unavailable`, exits 1 and writes no credential.
  §10 separates the two groups.
- `defaultConfirm` (server/private-pilot-files.ts:394-417) requires **both**
  `process.stdin.isTTY` and `process.stdout.isTTY`, then an answer whose trimmed
  text is exactly `confirm`. It is the only gate that depends on the launch
  environment rather than on the provider.
- **An unanswered prompt is excluded.** The process exited at `00:56:01.670Z`,
  twenty-seven seconds before the 120 s deadline (`00:56:29Z`). A displayed
  prompt waiting for input would have blocked until the deadline. The failure
  was therefore a gate that threw or returned `false` immediately after the
  phone confirmation: a rejection inside the SDK's own handshake before event
  type 4, the `imei`/`userAgent` capture, a post-confirm cookie validation, or
  the session write.
- **The earlier TTY reading is withdrawn.** `tty stdin=yes stdout=no` was
  measured inside a `{ ... } >log 2>&1` block, so it measured that diagnostic's
  own redirection. A fresh offline check on the same console launch path
  (`2026-11-04T05:35:04Z`, after the window, with no manifest, grant, SDK or
  provider contact and zero gateway events) reported host `stdin=yes
  stdout=yes` and container `stdin`, `stdout` and `stderr` all TTY, compose
  rc=0. The confirmation gate was therefore satisfiable by this launch method,
  and TTY is no longer a leading candidate; the failed run's exact environment
  remains unrecoverable.
- **A plain stdout capture would not fully attribute the next failure.**
  `tools/pilot-connector.ts:374-383` collapses every bootstrap failure into one
  `"gate":"unavailable"` line. A capture would show whether the UID prompt was
  reached, but not which gate failed afterwards.
- No session record and no quarantine artifact exist, and the cookie is read
  only after `confirmIdentity`, so no credential was persisted or handled on
  disk. The provider may nevertheless hold a session created by the successful
  phone confirmation; it must be revoked from the phone.
- The QR was emitted at `00:54:33Z` and the Windows-visible copy existed by
  ~`00:55Z`; the handoff left less than the full QR lifetime for the scan, and
  the terminal confirmation was a second, separate step.

### State left behind

- `connector_ownership`: phase `uncertain`, epoch 1, fault `shutdown`, last
  reservation `00:54:31Z`. `provider_state`: `disconnected` with
  `reconciliation_required=true`, fault `shutdown`. Both are the fail-closed
  result of the close path and were **not** reset: the next G5-A preflight will
  refuse until the Owner decides how to reconcile them.
- No `session.enc`, no quarantine file, no QR image. `/home/zen/qr-live.png` was
  deleted, and every temporary QR helper script was removed; the private view
  directory is empty `0700` UID 65532. No cookie or session material was read or
  written: the adapter reads the cookie jar only after identity confirmation.
- The phone confirmation completed a provider-side login, so a provider session
  or device entry may exist even though nothing was persisted locally. The
  Owner's device history (§10.1) reports that entry already logged out; §10.4
  records the reconciliation that is still required before another attempt.
- `pilot_send_budget` and `pilot_part_ledger` are empty; no message was sent,
  observed or queued. No observe/send-test workflow ran.
- The gateway, `pilot-postgres` and the reviewed topology remain running and
  healthy. No host firewall, routing or Docker daemon setting was changed and the
  provider allowlist was not expanded.
- The launcher status file records `start=00:54:29Z end=00:56:02Z exit=1`.
  The preflight and launcher scripts remain on the private host for
  reproducibility (SHA-256 `ba6ea247…24c0b` and `0f5b7c7b…7d00e`).

### Residual risks and safe recovery path

1. **Confirm the provider session is gone (Owner).** On the official phone,
   confirm in the sessions/devices list that the entry created around the
   attempt is logged out, and use the provider's own logout control if any entry
   remains. The Owner's device history (§10.1) already reports login and logout
   in the same minute. No local session will be reused regardless.
2. **Attribute the abort.** Implemented in §10.3: reviewed, non-secret abort
   reason codes and a `0600` private diagnostic sink. The next attempt must also
   capture the connector's console output to a `0600` private log (never
   committed; the confirmation prompt prints the UID).
3. **Prove the confirmation path offline before another live run.** Implemented
   in §10.3: the real `promptConfirmation` is now covered by unit tests (non-TTY
   refusal, literal `confirm` only) and the adapter is covered end to end with
   the real private view and encrypted store, for both a confirmed and a
   refused answer. The in-image fixture replay belongs to the next authorized
   build.
4. **Rehearse the terminal confirmation.** The phone confirmation and the
   console prompt are two separate steps; the prompt accepts only the literal
   word `confirm` and any other answer cancels. Print that instruction before the
   QR appears and rehearse it in the fixture run.
5. **Owner decision on control state.** `connector_ownership` is `uncertain` and
   `provider_state` requires reconciliation. Reusing the connector needs an
   Owner-approved, reviewed reset; this report does not do it.
6. **QR handoff rehearsal.** Pre-open the local viewer before starting and
   rehearse reaching the terminal `confirm` prompt within the QR lifetime; the
   observed handoff copy latency consumed a large part of that lifetime.
7. **New G5-A authorization.** A fresh explicit UTC start and expiry for
   bootstrap only; this window is consumed. Unsigned images and runtime-only
   provider hosts remain as previously recorded residuals; live account
   behaviour and production readiness stay **UNPROVEN**.

### Evidence boundary

§9 is live evidence for one provider contact, one QR emission and one fenced
shutdown on the Owner's machine, plus the Owner's attestation of the phone scan
and phone state. It contains no account UID, peer UID, phone number, QR image or
data, cookie, token, key or message body, and no console transcript of the
connector. It does not instrument phone coexistence, establish Zalo account
behaviour or production readiness. G5-B and G5-C remain **not authorized**.

**STOP — `G5A_BOOTSTRAP_FAIL`. The authorization is consumed and must not be
reused or extended. No retry, observe, send-test, media, production deployment
or PR merge is authorized; a new G5-A authorization is required.**

## 10. Owner follow-up — post-acceptance analysis and reconciliation gate

**Status of this section:** offline analysis plus code and test work done after
the window closed at `2026-11-04T01:16:00Z`. **No provider contact, no QR, no
observe, no send, no image build, no deployment and no state reset occurred
while §10 was written.** The authorization in §9 remains consumed. The report
stops at the Owner Reconciliation Gate (§10.5).

### 10.1 Owner device-history evidence

The Owner inspected the login-device list on the official Zalo A account and
reported exactly one entry that coincides with the attempt:

| Field | Owner-reported value |
| --- | --- |
| Device | `Firefox - Windows` |
| Login | `2026-11-04 07:56` Vietnam time |
| Method | QR |
| Last activity | `2026-11-04 07:56` |
| Logout | `2026-11-04 07:56` |
| Phone | still logged in and operating normally |

No IP address, device identifier, account UID, phone number or other personal
data is reproduced here or anywhere else in this repository. The provider
account's device label is quoted only because it is the identifier the Owner
used to locate the entry.

What this proves and what it does not:

- **Proves:** the provider accepted the QR confirmation and created a login
  session for this connector; that session ended within the same minute it was
  created and never showed later activity; the phone session was unaffected.
- **Does not prove:** that the SDK ever received a usable session, that
  `checkSession` succeeded, or that the connector wrote or attempted to write a
  credential. A provider session that is created and closed in the same minute
  is also exactly what a client-side handshake that never completes looks like.
- It confirms the local forensic record rather than changing it: the connector
  exited 1 at `00:56:02Z`, i.e. `07:56:02` Vietnam time, matching the reported
  logout minute.
- It makes the "QR was never accepted" explanation impossible and leaves a
  narrow local window: everything after the phone confirmation and before the
  encrypted session write. That is the window §10.2 analyses.

### 10.2 What happened after the provider accepted the QR

The reviewed adapter's post-confirmation path, in order, is: SDK `loginQR`
resolves → SDK emits event type 4 (`GotLoginInfo`) carrying `imei`/`userAgent` →
facade reads the UID and checks its shape against the grant → `confirmIdentity`
(terminal `confirm`) → cookie-jar snapshot → session-write. Any failure in that
sequence throws the single generic `unavailable`, exits 1, writes no credential,
and leaves the ownership row fenced as `uncertain`.

The strongest code-grounded candidate, unchanged since §9 and now cross-checked
against the Owner's device history:

1. The provider accepted the confirmation, so `loginQR` is the call that decides
   the outcome. Before it can resolve, zca-js 2.2.0 calls `checkSession`
   (`dist/apis/loginQR.js:194-210`), which requests
   `https://id.zalo.me/account/checksession?continue=https%3A%2F%2Fchat.zalo.me%2Findex.html`
   with `redirect: "manual"`.
2. A response with a `Location` header is followed by zca-js's own request
   helper (`dist/utils.js:289-298`), which recurses on any `Location` value
   without consulting the reviewed allowlist.
3. `chat.zalo.me` — the `continue` target in that URL, and the most likely
   redirect destination — is **excluded** from
   `ops/pilot-egress-allowlist.json` and classified as an unadmitted
   `redirect-target`. `docs/evidence/G5A-PROVIDER-ENDPOINT-POLICY.md:102,138`
   states the reviewed intent: an unexpected redirect aborts the bootstrap.
4. The local guard (`ops/pilot-egress-guard.cjs`) throws at
   `net.Socket.prototype.connect` for any target it cannot classify. The
   connection never forms, so the gateway never sees it and logs no denial —
   which is consistent with the attempt's **single** `sni_allow id.zalo.me:443`
   gateway event and **zero** denials.
5. `checkSession` swallows its own failure (`.catch(logger(...).error)`), returns
   `undefined`, and `loginQR` rejects with "Cannot get session, login failed".
   Event type 4 never fires, so `loginCookie` (`wpa.chat.zalo.me`) and
   `getUserInfo` (`jr.chat.zalo.me`) are never reached. That is also why the
   gateway never saw those two hosts, even though the allowlist admits them.
6. The facade maps the rejection to `login-failed` (new, §10.3), the process
   exits 1, and the provider closes the login it had just created — inside the
   same minute, as the device history now shows.

This is a hypothesis, not a proof. The redirect was never observed, the console
output was not retained, and an alternative SDK-internal rejection between
`loginQR` and event type 4 would produce the same external symptoms. What the
evidence does rule out is the provider refusing the login, an expired QR, an
unanswered terminal prompt (exit was 27 s before the 120 s deadline), an
ownership conflict (the reservation and fence are clean) and a session write
(no `session.enc`, no quarantine file).

The next authorized attempt can settle it: the diagnostic sink in §10.3 records
stages, so the log would show whether `login-resolved` was reached and, if it
was not, that the abort happened inside `loginQR` — with the reason code
`login-failed` and the absence of any `wpa`/`jr` tunnel confirming the position.

### 10.3 Shutdown did not end the provider session; attribution is now possible

**Owner question — did the connector's shutdown terminate the provider session?
No. It could not have.**

- zca-js 2.2.0 exposes no logout API at all: there is no `logout` occurrence
  anywhere in the installed SDK's `dist`.
- The facade holds the SDK instance in `resolvedApi`, which is assigned only
  after `loginQR` resolves. On this run `loginQR` rejected, so `resolvedApi` was
  never set and `disposeApi` never ran.
- `disposeApi` in any case only stops a listener that was never started on this
  run; the adapter's `cleanUp()` only aborts a local abort controller and clears
  a local timeout.
- The facade then calls the ownership store's `close`, which fences
  `connector_ownership` and `provider_state` **locally**. That is a database
  transition, not a provider API call.

So the provider session ended because the client's handshake never completed,
not because the connector signed it out. Corroborating: the reported logout is in
the same minute as the login and there is no later activity — a deliberately
signed-out session would normally show the same, so the distinguishing evidence
is the code path, which has no way to sign out.

**Attribution work completed offline (no live run):**

| Change | Where | Purpose |
| --- | --- | --- |
| Closed reason vocabulary (26 codes, 15 stages) | `server/pilot-reasons.ts` | one shared list so adapter, CLI and diagnostic sink cannot drift or emit free text |
| `PilotBootstrapError` with a closed `code` | `adapters/zalo/qr-bootstrap.ts:30` | every fail-closed gate now fails with a specific non-secret code instead of one generic error |
| Per-gate codes | `adapters/zalo/qr-bootstrap.ts` | input, grant, scope, SDK load, SDK shape, `login-failed`, `qr-missing`, `view-failed`, `uid-invalid`, `uid-mismatch`, `login-info-invalid`, `identity-declined`, `cookie-invalid`, `session-write-failed`, `grant-expired`, quarantine |
| Stage context on the error | `qr-bootstrap.ts` (`onStage`) | tells the operator which reviewed stage was reached without revealing identity |
| CLI `reason` field | `tools/pilot-connector.ts:93,393-397` | `gate` stays coarse for compatibility; `reason` is emitted only when it is in the closed set |
| Private diagnostic sink | `server/private-pilot-files.ts:538` | opt-in `PILOT_DIAGNOSTIC_FILE`; absolute path inside a trusted `0700` parent; `0600`, `O_NOFOLLOW`, append, fsync, 1 MiB cap; validates stage and reason against the closed sets; writes one JSON line `{at,stage,reason?}` and nothing else |
| Real prompt coverage | `server/private-pilot-files.ts:402` (`promptConfirmation`) | the production gate is now directly testable; still requires both stdio streams to be TTY and the trimmed answer to be exactly `confirm` |

Why the vocabulary is closed: a free-text abort reason is a channel for provider
or account data to reach a log. Both the sink and the CLI reject anything
outside the reviewed list, so a future bug cannot leak a UID, phone number,
cookie or URL through a "reason" field.

**Regression coverage added (synthetic, offline — never proof of a live
outcome):** every gate reports a closed, non-secret reason code (17 cases); a
provider rejection never reaches the error text; a grant that expires between
confirmation and the write is refused before any write; stage reports carry no
identity; the **real** private view and encrypted store persist only a confirmed
session and write nothing on a decline; the diagnostic log records stages only;
the interactive confirmation fails closed and accepts only the literal word
`confirm`; the production view refuses when stdio is not interactive; and the
CLI surfaces `reason` without provider detail.

**Verification at this commit:** typecheck clean; connector build clean; both
changed suites pass in full; the full backend suite passes except one
intermittently failing test in `tests/backend/pilot-egress-guard.test.ts`, which
passes in isolation on this tree **and** on unmodified `HEAD` in a scratch
worktree, so it is an environmental flake and not a regression introduced here.

**Still missing, and deliberately not done:** the diagnostic sink is only useful
once the connector image is rebuilt, and rebuilding or re-running the connector
is a live action that needs a new authorization. The in-image replay of a
synthetic QR through the real container also belongs to that next authorized
build, not to this section.

### 10.4 Reconciliation plan (prepared, not executed)

Two independent states have to be reconciled, and they have different owners.

**Provider side (Owner).** The device history already reports the entry as
logged out in the same minute it was created, so there may be nothing left to
revoke. The Owner step is therefore confirmation, not cleanup: verify in the
phone's sessions/devices list that no entry for the attempt remains active, and
if one does, use the provider's own logout control on the phone. This must be
done from the official phone, not from the connector. No local session exists or
will be reused either way.

**Local control state (requires a reviewed change).** The attempt left:

- `connector_ownership`: phase `uncertain`, epoch 1, fault `shutdown`;
- `provider_state`: `disconnected`, `reconciliation_required=true`, `gap_version`
  bumped.

Neither reviewed path can move this state:

- Re-acquisition (`acquireConnectorOwnership`) reserves only from
  `phase='idle'`, so a second bootstrap is refused by design;
- The gap-acknowledgement operation (`server/connector-operations.ts:320-381`)
  requires `phase IN ('idle','active')` **and** the matching owner id/epoch, so
  it correctly refuses an `uncertain` row.

So reopening the connector needs a new, reviewed operation. Proposed shape, for
Owner approval — **not implemented and not run**:

1. Explicit Owner approval recorded before execution, with an evidence reference
   and a statement of what is being reconciled (the §9 attempt, provider side
   confirmed by the Owner).
2. Preconditions checked by the operation, not by the operator: no
   `session.enc` and no quarantine artifact; no unknown/processing outbox rows;
   provider entry confirmed inactive; ownership row is `uncertain` with the
   expected epoch and fault.
3. Transition `uncertain → idle` with a **new** epoch, and clear
   `reconciliation_required` in the same transaction, so any stale holder or
   stale token is fenced out by the epoch change.
4. Mandatory audit rows in both directions (`connector.reconciled` and the
   resulting reservation), and no automatic expiry — a missed approval means the
   row stays `uncertain`.
5. A test that proves the operation refuses on wrong epoch, on a dirty outbox,
   on a present session file and without approval.

I am **not** implementing this now. It is authorization logic, which the Owner
reserves, and executing it is a separate decision from investigating the
failure. Until it exists and is approved, any bootstrap preflight will correctly
refuse.

**Then, in order:** reviewed reconciliation operation → rebuilt image containing
the reason codes and diagnostic sink → a **new** G5-A authorization with fresh
UTC bounds (the §9 window is consumed and must not be reused) → one bootstrap
with the console captured to a `0600` private log and `PILOT_DIAGNOSTIC_FILE`
set, which will attribute this specific abort instead of leaving it inferred.

### 10.5 Evidence boundary and stop

§10 is **offline analysis plus code and test work**. It contains no provider
contact, no QR, no session, no account or device identifier beyond the Owner's
device label, and **no network address**. It does not prove a live outcome, does
not establish Zalo account behaviour, and does not improve the production
readiness status, which stays **UNPROVEN**.

The control state has **not** been reset: `connector_ownership` remains
`uncertain` and `provider_state` still requires reconciliation.

**STOP — `G5A_AWAITING_OWNER_RECONCILIATION`.** No further live action is
authorized: no QR retry, no `run-observe`, no `run-send-test`, no media, no
contact discovery, no image rebuild for a live run, no provider contact, no
production deployment, no PR merge, and no reset of `uncertain`. The next step
is an Owner decision on the reconciliation operation in §10.4 and, separately, a
new G5-A authorization.

## 11. Second bootstrap attempt — 2026-11-06 23:40–00:10Z

**Authorization:** `G5A_LIVE_BOOTSTRAP_ONLY`, one QR attempt, window
`2026-11-06T23:40:00Z`–`2026-11-07T00:10:00Z`. **Verdict:**
`G5A_BOOTSTRAP_FAIL` — reason `qr-expired`. The phone-side scan is reported by
the Owner but its provider-side outcome is UNPROVEN.

### Preflight (23:38–23:42Z, all before provider contact)

| Control | Observed |
| --- | --- |
| HEAD / image | `5cb0202`; `zalo-shared-connector:g5-ready-6d9c0e9`, digest `sha256:97513c22…168c84` |
| Embedded identity | `sourceCommit 6d9c0e9…9609`, `lockSha256 17dcd254…030c9b`, SDK integrity equal to the lock |
| Gateway / networks | healthy; `GATEWAY_ALLOW_HOSTS` exactly `id.zalo.me,wpa.chat.zalo.me,jr.chat.zalo.me,chat.zalo.me`; db and egress networks `Internal=true` |
| Database | `verify-full` admitted over TLS 1.3 as `zs_app`; a URL without `sslmode` refused |
| Control state | ownership `idle`, epoch 2, no owner; provider `disconnected`, `reconciliation_required=false`, gap 2; no session, empty view |
| Work | outbox, parts, provider events and sessions all 0; no connector container or process |
| Offline preflight | in-image and compose paths both `"gate":"admitted"`, `purpose enroll-session`, `accountBound:false`, `peerCount:0`, lifetime 1 612 600 ms |

Grant: `consentRef`/`grantId` bound to the window, `issuedAt`
`2026-11-06T23:42:07Z`, `expiresAt` `2026-11-07T00:09:00Z`, `expectedAccountId`
null, zero peers, `maxPartsPerDay` 10, `minIntervalMs` 2000 — inside the Owner
window and under the 60-minute cap.

### Timeline (UTC)

| Time | Event |
| --- | --- |
| 23:42:52 | single `compose run` launcher started; console captured to a `0600` private log |
| 23:42:53.647 | ownership reserved, epoch 3, label `pilot-enrollment` |
| 23:42:54.325 | gateway `sni_allow id.zalo.me:443` |
| 23:42:54.537 | `qr.png` written `0600` in the `0700` view directory; copy opened locally, never uploaded |
| 23:44:34.560 | `stage:"failed"`, `reason:"qr-expired"` |
| 23:44:34.618 | second and last gateway `sni_allow id.zalo.me:443`; no other host, no denial |
| 23:44:35 | connector exited 1; view directory cleared; ownership fenced `uncertain`, epoch 3 |

The console showed the fixed pre-QR instructions and then
`{"ok":false,"gate":"unavailable","reason":"qr-expired"}`. The terminal `confirm`
step was never reached, so no account UID was displayed, confirmed or recorded.

### Required G5-A outcomes

| Required outcome | Result |
| --- | --- |
| Successful QR login | **UNPROVEN** — the Owner reports the phone scan succeeded, but the connector's QR window closed at 23:44:34Z; whether the provider accepted the confirmation is not observable locally |
| SDK post-login handshake | **NOT REACHED** — no `wpa`/`jr`/`chat` contact; the redirect admission was never exercised |
| Exact UID and identity binding | **NONE** — no UID displayed, no binding |
| Owner console confirmation | **NOT REACHED** |
| Encrypted session persistence | **NONE** — no `session.enc`, `session.key` unchanged |
| Official phone functional | **UNPROVEN** — Owner confirmation pending |
| Safe connector shutdown | **PASS** — single process, exit 1, ownership fenced, no residual container, QR deleted (private view and Windows copy) |
| Allowlist confinement | **PASS** — two `sni_allow` for `id.zalo.me` only, zero denials, zero other destinations |
| Observe, send-test, media, discovery | **NOT STARTED** — not authorized and not invoked |

### Failure analysis

The QR was live for exactly 100 seconds. The scan and the terminal confirmation
competed with that bound and the connector failed closed on it. No redirect
failure, network denial or SDK error was observed, so this attempt says nothing
about the redirect hypothesis either way. Because the provider side may have
recorded a login the connector never captured, the Owner was asked to confirm
phone state and to revoke any new pilot device session from the official phone;
the connector has no logout capability.

### Reconciliation of this incident

Executed once on Owner approval in window
`2026-11-06T23:52:00Z`–`2026-11-07T00:12:00Z` by the reviewed driver bound to
this incident (commit `ae8a77f`). 13/13 read-only preflight checks, one
authenticated request, HTTP 200, epoch 3→4, gap 3→4, phase `idle`, owner and
fault null, `reconciliation_required=false`, audit id 14 `connector.reconciled`,
all 21 post-checks PASS, no retry or replay. Details:
[G5A-RECONCILIATION-EXECUTION-2026-11-06.md](G5A-RECONCILIATION-EXECUTION-2026-11-06.md).

**STOP — `G5A_RECONCILED_AWAITING_NEW_START_AUTHORIZATION`.** The single
authorized attempt is consumed and cannot be retried. A further bootstrap
requires a new explicit UTC Owner window, a fresh grant, and — given the 100-second
QR lifetime — a scan performed immediately after the QR appears.

## 12. Third bootstrap attempt — 2026-11-07 00:00–00:20Z

**Authorization and grant.** The Owner selected a new UTC window
`2026-11-07T00:00:00Z`–`00:20:00Z` and stated the phone was ready. A fresh
single-use `enroll-session` grant `g5a-enroll-2026-11-07T0000Z`
(`consentRef G5A-OWNER-AUTH-2026-11-07T0000Z`, `issuedAt 00:02:20.084Z`,
`expiresAt 00:18:00.000Z`, same reviewed build identity) was created outside the
repository and mounted `0600` as UID 65532.

**Preflight.** Reviewed image digest `sha256:97513c22…` and embedded
`sourceCommit 6d9c0e9`, `lockSha256` and `sdkIntegrity` matched the grant; the
gateway was `running healthy` with exactly
`id.zalo.me,wpa.chat.zalo.me,jr.chat.zalo.me,chat.zalo.me`; both Docker networks
were `internal=true`; the connector database URL carried `sslmode=verify-full`;
ownership was `idle`, epoch 4, owner null, gap 4; `provider_state` was
`disconnected` with `reconciliation_required=false`; messages, outbox, delivery
parts, media jobs and the part ledger were all zero; no `session.enc` existed and
`sessions=0`; no connector container ran; the diagnostic sink was writable.
In-image preflight returned `ok:true`, `gate:admitted`, `lifetimeMs 939916`.

**Attempt.** Launched once under `tmux` through the reviewed private compose file
with a PTY console logged `0600`.

| Event | UTC |
| --- | --- |
| start | 00:04:14.707Z |
| ownership-acquired (epoch 5) | 00:04:14.776Z |
| sdk-loaded / login-requested | 00:04:15.243Z |
| qr-shown (single `sni_allow id.zalo.me`) | 00:04:15.547Z |
| scanned (Owner: phone reported success) | 00:05:05.668Z |
| failed `redirect-denied`, exit 1 | 00:05:07.348Z |

**Outcome.**

| Item | Result |
| --- | --- |
| QR emission and local display | PASS (QR inside the private view, displayed locally, deleted after) |
| Phone scan / approval | PASS as reported by the Owner; provider-side approval UNPROVEN |
| Post-scan SDK handshake | **FAIL — `redirect-denied`** |
| UID / display name | NONE (never reached) |
| Encrypted session (`session.enc`) | NONE (`sessions=0`) |
| Provider destinations contacted | only `id.zalo.me` (one admitted tunnel at `00:04:15.381Z`); zero gateway denials |
| Phone coexistence | UNPROVEN |
| Safe shutdown and fencing | PASS (`uncertain`, epoch 5, `fault_code=shutdown`) |
| QR cleanup | PASS (private view and Windows copy removed) |
| Reconciliation | **REQUIRED** (`reconciliation_required=true`, gap 5); not executed |

**Failure analysis.** The denial came from the connector's own redirect policy,
not from the deployed gateway: the gateway logged exactly one admitted tunnel
(`id.zalo.me`, `00:04:15.381Z`) and no tunnel, deny, connect or other SNI after
the scan. After the phone approved, the SDK requested a redirect that did not
match the single reviewed `checkSession` hop, so the wrapper refused it and
exited before any further egress. The offending target is not recorded (the
console and diagnostic file carry only closed stage and reason codes), so the
unreviewed destination remains UNPROVEN. This is the stop condition the
authorization defined: the attempt ended at the redirect gate, no allowlist or
firewall change was made, and no retry was attempted. Audit rows moved 15 → 17
(ownership lifecycle only); all workload rows remain zero.

**STOP — `G5A_BOOTSTRAP_FAIL`.** The third authorization is consumed. Ownership is
fenced `uncertain` at epoch 5 and must be reconciled through the reviewed
operation under a new Owner approval; a further bootstrap requires a new explicit
UTC Owner window and an Owner decision on the post-scan redirect policy. The QR,
console log and all private material stay outside the repository.

### Reconciliation of this incident

Executed once on Owner approval in the window
`2026-11-07T00:54:00Z`–`01:14:00Z` by the reviewed driver rebound to this
incident (commit `353bf02`): 13/13 read-only preflight checks, one authenticated
request, HTTP 200 with `alreadyApplied=false`, epoch 5→6, gap 5→6,
`uncertain → idle`, owner and fault null, `reconciliation_required=false`,
`last_fenced_*` preserving `7cc878cf-…`/5, audit id 19 `connector.reconciled`
(request `a646b408-…`, `evidenceRef` this section), 21/21 post-checks, no retry
or replay, and the gateway log unchanged. Details:
[G5A-RECONCILIATION-EXECUTION-2026-11-07.md](G5A-RECONCILIATION-EXECUTION-2026-11-07.md).

**STOP — `G5A_RECONCILIATION_PASS_AWAITING_BOOTSTRAP_DECISION`.** The incident is
closed and ownership is `idle` at epoch 6 with zero unresolved work. A further
bootstrap requires a new explicit UTC Owner window, a fresh grant, and an Owner
decision on the post-scan redirect policy; the unreviewed redirect target remains
UNPROVEN. No retry exists and no control state may be reset by hand.
