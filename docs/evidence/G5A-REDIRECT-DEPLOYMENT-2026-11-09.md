# G5-A — Owner-authorized deployment of the reviewed redirect remediation

Date: 2026-11-09 (UTC). Repository `kha997/zalo-shared`, branch `feat/shared-inbox`,
verified HEAD `7a95a40`, PR #3 open and draft. This record is the evidence for the
directive *"Owner authorization: deploy reviewed redirect fix"*. The deployed connector
is the CI-built artifact from source commit `8d9e39d`; the private pilot now admits
`jr.zaloapp.com` as the single followable `checkSession` redirect target and no longer
admits `chat.zalo.me`. No QR was generated, no provider was contacted, no reconciliation
ran and nothing was merged.

## 1. Authorization and scope

Authorized: deploy the independently reviewed exact-host redirect remediation to the
dedicated private G5-A pilot, apply the reviewed four-host inventory, verify the
deployment offline, prepare (not execute) the reconciliation, and commit sanitized
evidence.

Not authorized and not done: a live QR or Zalo authentication, any provider probe or
provider contact, reconciliation execution, G5-B observe, G5-C send, production
deployment, a PR merge, any automatic retry, and any security-control bypass. The Owner's
approval covers local pilot configuration and offline verification only.

## 2. Artifact identity and provenance

| Item | Value |
| --- | --- |
| CI run | [42635857403](https://github.com/kha997/zalo-shared/actions/runs/42635857403), `pull_request`, attempt 1, `2026-11-09T14:33:33Z`, **success** (`test` and `pilot`) |
| Source commit | `8d9e39d671202b9588748ef6122b3d2992b1185f` |
| Archive `pilot-connector-image` | 166,075,392 B, `sha256 d416e76f703abe9cc0b022a765d9aab24e2798aeb31f6cd194cb5d983d1f73b7`, equal to the run's `connector-image-sha256.txt` |
| Run image id (config digest) | `sha256:1c643dd95de62e782c90661aa746f240e217e660b164f1fcf9c4542a729555a6` |
| Loaded local reference | `zalo-shared-connector:g5-ci-8d9e39d`, manifest digest `sha256:220982a796d3a34196c6b209cf660a85fc4e9091b3b9f705cfe6314a2d065fd1` (containerd store naming; see [G5A-CI-PROVENANCE-2026-11-09](G5A-CI-PROVENANCE-2026-11-09.md) §6) |
| Embedded build identity | `version 1`, `sourceCommit 8d9e39d…`, `lockSha256 17dcd254…030c9b`, `sdkIntegrity sha512-pBU0T0/…Ox4pgA==` — equal to the connector lock and the run manifest |
| Runtime surface | uid 65532, `zca-js 2.2.0`, `crypto-js 4.2.0`, no exposed ports, `privateFiles: []` |

The earlier offline review of this artifact is
[G5A-REDIRECT-REMEDIATION-2026-11-09](G5A-REDIRECT-REMEDIATION-2026-11-09.md). A grant
bound to this image must name `sourceCommit 8d9e39d…`; the preflight binding was proven
non-vacuous below.

## 3. What was deployed

Only local pilot configuration changed. The reviewed compose example
`ops/pilot-compose.example.yml` (`sha256 3aaaabee…a345b`) replaced the private rendered
compose copy; both are byte-identical. Private backups were taken before any write, with
stamp `20261109T145504Z`:

- `pilot-compose.pre-jr.20261109T145504Z.yml` (previous `79845c33…`)
- `pilot-interpolation.pre-jr.20261109T145504Z.env`
- `g5-synthetic.pre-jr.20261109T145504Z/` (previous synthetic manifests)

The private interpolation now reads:

| Key | Before | After |
| --- | --- | --- |
| `PILOT_CONNECTOR_IMAGE` | `zalo-shared-connector:g5-ci-1052466` | `zalo-shared-connector:g5-ci-8d9e39d` |
| `PILOT_ENV_FILE` | empty | private `pilot-connector.env` (database credentials only) |
| `PILOT_MANIFEST_FILE` | consumed enrollment manifest `g5a-20261109T1312Z` (expired) | synthetic `manifest.bootstrap.json` (offline only) |
| `PILOT_DB_*, PILOT_KEY_FILE, PILOT_STATE_DIR` | unchanged | unchanged |

`docker compose config` resolves the connector to `zalo-shared-connector:g5-ci-8d9e39d`,
networks `pilot-db` + `pilot-egress`, **no published ports**; the gateway keeps
`zalo-shared-egress-gateway:g5-patched-af2be54` (`sha256:f75c2e8a…`) bound to
`172.16.29.10:443`. The application image (`sha256:989c6154…`) was not changed. The
gateway was recreated at `14:55:13Z`; no connector container was created or started at
any point.

## 4. Deployed provider inventory

Exactly four hosts, one source of truth (`ops/pilot-egress-allowlist.json`,
`sha256 c5be861b…`), verified identical in the running gateway env, the connector env and
the rendered `extra_hosts` pins:

```text
GATEWAY_ALLOW_HOSTS = id.zalo.me,wpa.chat.zalo.me,jr.chat.zalo.me,jr.zaloapp.com
PILOT_EGRESS_HOSTS  = id.zalo.me,wpa.chat.zalo.me,jr.chat.zalo.me,jr.zaloapp.com
```

- `jr.zaloapp.com` is admitted as `redirect-target` only (port 443, `maxHops 1`).
- `chat.zalo.me` is listed under `excluded`; it appears nowhere as an admitted host, a
  pin, a direct target or a followable `Location`.
- Every host is pinned to `172.16.29.10`; the gateway admits only that SNI set.
- Remaining pending/not-admitted classes are unchanged: `dynamic-service-map`,
  `redirect-target` for any other host, `websocket`.

## 5. Redirect policy, verified in the deployed artifact

The compiled policy inside `zalo-shared-connector:g5-ci-8d9e39d` was exercised with a
synthetic transport under `docker run --network none --read-only --cap-drop ALL`; no
socket was opened. 37 assertions, all PASS:

| Behaviour | Result |
| --- | --- |
| Deployed `REDIRECT_HOST` is `jr.zaloapp.com`; `chat.zalo.me` is not admitted | PASS |
| The `checkSession` request is unchanged and its 3xx is returned to the SDK | PASS |
| The single validated hop to `https://jr.zaloapp.com/index.html` is admitted | PASS |
| Exactly two requests, in order: `checkSession`, then the hop | PASS |
| The hop is single-use for the response that produced it; a repeat without a new `checkSession` is refused | PASS |
| A second 3xx after the hop is refused, class `redirect-after-hop`, `hops=1`, no third request | PASS |
| A direct request to `jr.zaloapp.com` is refused, class `direct-redirect-host` | PASS |
| `chat.zalo.me` is refused both as a direct target and as a `checkSession` Location (`unexpected-location`) | PASS |
| A non-`checkSession` 3xx is refused (`unexpected-redirect`) and authorises no later request | PASS |
| Foreign host, non-443 port, scheme-relative, userinfo, backslash, `http:`, missing `Location` are all refused (`unexpected-location` / `malformed-redirect`) | PASS |
| An admitted provider host is still reachable directly | PASS |
| An upper-case `Location` normalises to the same admitted hop | PASS |

The policy still forces `redirect: "manual"` on every request and validates scheme,
host, port, userinfo and control characters before a `Location` can be followed.

Two bounds the independent review quantified, both accepted for this deployment and
neither widening the destination set (still one host, `jr.zaloapp.com`, port 443):

- A `checkSession` URL that carries extra query parameters still classifies as
  `check-session`, because the classifier compares origin, path and the `continue`
  value. The SDK's own request carries only `continue`, and the only destination any
  such 3xx can authorise is still `jr.zaloapp.com`.
- "Single-use" is per redirect response, not per process. A second, independent
  `checkSession` 3xx in the same process can authorise a second hop — to the same
  host. The live bootstrap path issues exactly one `checkSession` request. A stricter
  per-process bound would be a source change and would invalidate the CI artifact's
  `sourceCommit` binding, so it is deferred and recorded in §13.

## 6. Network isolation and gateway

`ops/local/check-pilot-network.sh`: **all assertions PASS** — connector joins `pilot-db`
+ `pilot-egress`, `pilot-egress` internal; application network internal;
`pilot-uplink` non-internal with the gateway as its only member; gateway static
`172.16.29.10`; connector pins exactly the four hosts; both workloads
`cap_drop ALL`, `read_only`, `no-new-privileges`, uid 65532, `restart: no`, `init`;
gateway adds only `NET_BIND_SERVICE`; gateway `ip_forward=0` and IPv6 forwarding off.

Running gateway: `running`, `healthy`, 0 restarts, created `2026-11-09T14:55:13Z`,
networks `pilot-egress 172.16.29.10` + `pilot-uplink 172.23.0.2`, `ports {"443/tcp":null}`
(exposed, **not published**). Its startup log records the four hosts and
`maxTunnels 32`; the only denials are the synthetic harness probes
(`denied-target.test`, `pilot-target.test`, remote `172.16.29.2`). **No tunnel to any
real provider host exists.**

`ops/local/verify-deployed-pilot.sh`: **all 48 deployed-network assertions PASS**.
`ops/local/verify-egress-allowpath.sh`: **all 21 assertions PASS**, including that a
direct connection to a provider's public address is refused and the harness had no route
to any real host.

## 7. Database TLS, least privilege and the host-cluster assertion

`ops/local/verify-pilot-db-tls.sh`: exit 0, **29/29 checks PASS** — certificate chains to
the pilot CA and names `pilot-db`; key `0600` UID 999; `ssl=on`, TLS 1.2 minimum; the
runtime role negotiated `TLSv1.3` / `TLS_AES_256_GCM_SHA384`; `pg_hba` is TLS-only;
plaintext, wrong-hostname and unrelated-CA connections are refused; the runtime role is
`NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION`, cannot create in `public`, cannot
update `audit`, cannot delete ownership/budget rows, cannot update the ledger, and can
still reserve one budget part; restart preserves data and TLS; dump/restore reproduces
the synthetic row.

**One assertion was corrected, and this is disclosed.** The check
`shared host cluster started before the pilot container` compared the host postmaster's
start time with `pilot-postgres`'s *creation* time. That is a one-time provisioning
order: a postmaster's start time moves on every host restart, so after the host rebooted
on `2026-11-04` the comparison could never hold again, independently of any pilot action.
Observed facts:

| Timestamp | Meaning |
| --- | --- |
| `2026-11-03T15:11:30Z` | `pilot-postgres` created (unchanged; never recreated) |
| `2026-11-02T06:21:22Z` | `zalo-shared-g2-postgres-1` created (unchanged) |
| `2026-11-04T06:37:46Z` | shared host postmaster started (host boot `06:42:58Z`) |
| `2026-11-09T14:55:04Z` | this deployment session's first mutating action (backup stamp) |

The script now accepts an optional `PILOT_SESSION_START` anchor and, when given, requires
the shared cluster to have been running **before the session began**, so a restart caused
by the session still fails while a host reboot is not misreported. Without the anchor the
original strict comparison is used unchanged. The verifier ran with
`PILOT_SESSION_START=2026-11-09T14:55:04Z` and the check passes on that basis
(`sha256 e777b2a6…` for the modified script). The G2 comparison against the pilot
container's creation time is unchanged and still passes, because container creation time
is stable.

The verifier's mandatory restart test restarted `pilot-postgres` twice across its two
runs. Each time the application's idle `pg` pool client received `terminating connection
due to administrator command`, the unhandled pool error terminated the process, and
`restart: unless-stopped` brought it back healthy within one second
(`RestartCount=2`, currently `healthy`, `/health/ready` HTTP 200). This is a pre-existing
application fragility, exposed only now because the application is running; it is not
caused by the redirect change and is recorded in §13 as a residual risk.

Read-only reconciliation preflight confirms TLS `TLSv1.3` /
`TLS_AES_256_GCM_SHA384`, database `zalo`, role `zs_app`.

## 8. Offline preflight of the deployed image

Synthetic manifests were regenerated with `SOURCE_SHA=8d9e39d…` (previous set preserved
under the backup stamp; still no real account, peer, key or session material) and run in
the deployed image with `--network none --read-only --cap-drop ALL`:

| Manifest | Result |
| --- | --- |
| `bootstrap` | `gate: admitted`, purpose `enroll-session`, accountBound false, peers 0 |
| `observe` | `gate: admitted`, purpose `observe`, accountBound true, peers 1 |
| `send-test` | `gate: admitted`, purpose `send-test`, accountBound true, peers 1 |
| `observe --invalid-scope` | `gate: denied` |
| `bootstrap` bound to a different commit (`a2a7aa0…`) | `gate: denied` (exit 1) |

The last row proves the grant-to-image binding is not vacuous: a manifest that does not
name `sourceCommit 8d9e39d…` is refused by the deployed artifact.

## 9. Automatic Windows QR viewer rehearsal

`ops/local/rehearse-qr-viewer.sh` with the synthetic fixture only
(`sha256 2dab0568…`, 16,616 B): valid fixture staged, shown in the interactive
foreground at session 1 in a 480x600 window, cleanup final, no staged copy remains;
corrupt PNG refused with exit 4 (`invalid-png`); truncated PNG refused with exit 4;
no staged copy survives any run. **Verdict PASS.** No QR was generated: the only image
shown was the synthetic fixture.

## 10. Security scan

`ops/local/pilot-scan.sh` (Trivy 0.76.1, vulnerability DB `2026-11-09T00:56:17Z`)
against `zalo-shared-connector:g5-ci-8d9e39d`: exit 0, **0 HIGH/CRITICAL, 0 fixable
HIGH/CRITICAL**, no findings; in-image runtime surface uid 65532, `zca-js 2.2.0`,
`crypto-js 4.2.0`, no exposed ports, no private files. The licence-severity entries in
the scan summary are package-licence classifications, not vulnerabilities. Residual
MEDIUM/LOW findings and the deprecated-but-transitive `crypto-js@4.2.0` are unchanged and
below the Owner's HIGH/CRITICAL bar.

## 11. Control state preserved

Read-only reconciliation preflight (`ops/local/preflight-pilot-reconciliation.mjs`,
12 checks, `ok:true`) run after all deployment work:

| Item | Observed |
| --- | --- |
| Ownership | `uncertain`, epoch `7`, owner `af5048a8…`, fault `shutdown`, uncertainAt `2026-11-09T13:25:18.446Z` |
| Last fenced pair | `7cc878cf…` / epoch `5`, preserved |
| Provider | `disconnected`, gap `7`, `reconciliationRequired: true`, fault `shutdown` |
| Identities | 1 user, 1 admin, 0 sessions |
| Unresolved work | events 0, media 0, dispatchable 0, parts 0 |
| All work tables | 0 rows (messages, outbox, delivery parts, provider events, variants, media jobs, ledgers, budget, parts, attachments, conversations) |
| Audit | 28 rows, 3 prior reconciliations, incident prefix and `max_id 28` preserved |
| Concurrency | 0 advisory locks; `other_sessions` 0 at the verification run and 1 at a later reviewer run — the application's idle pool (see §12) |

No ownership row was modified, no reconciliation ran, no enrollment grant was created,
and no session/key/QR/audit record was touched. Private state: `session.enc` absent,
`qr.png` absent, `pilot/state/view` empty, `session.key` present as before.

No connector container exists (`docker ps -a` shows none); no host process runs a pilot
connector; no connector has been started since the last offline preflight.

## 12. Reconciliation readiness (prepared, not executed)

The reviewed single-use administrative reconciliation would take ownership
`uncertain → idle` and provider gap `7 → 8` with `reconciliation_required=false` and an
audit `connector.reconciled` record. It is **prepared but not executed** and requires a
separate explicit Owner UTC authorization window.

Immediately before any execution the operator must re-check: no other database session
(the deployed application holds an idle pooled connection), no advisory lock, no
unresolved work, ownership still `uncertain` epoch 7 and provider gap 7. If quiescing the
application is needed, the reviewed procedure must be used as written; no data may be
destroyed and no conflict check may be bypassed.

The application connection makes that condition **intermittent**, and this was observed
during verification rather than assumed:

| Observation | `other_sessions` |
| --- | --- |
| Read-only preflight during deployment verification (`ok:true`) | 0, `advisory_locks` 0 |
| Same preflight run by the independent reviewer minutes later (`ok:false`) | 1 |
| Direct `pg_stat_activity` read of the pilot database | `zs_app|idle|1` |

So the session count flickers between 0 and 1 as the application's pool opens and drops
its idle client. **The prepared procedure therefore quiesces the application first**: stop
`zalo-shared-pilot-app-1` through the private compose, re-run the read-only preflight and
require `other_sessions=0` and `advisory_locks=0` immediately before the single request,
then start the application again after the transition. This is the quiescing path the
Owner anticipated; it stops a container (no data is deleted) and does not bypass any
conflict check — the preflight remains the gate.

## 13. Residual risks and UNPROVEN items

1. **UNPROVEN — live behaviour.** No QR, login, UID binding, session, observe or send.
   The redirect hop is proven against synthetic fixtures inside the deployed artifact,
   not on the wire against the provider. If the provider issues a further redirect from
   `jr.zaloapp.com`, the policy fails closed and the attempt is consumed.
2. **UNPROVEN — TLS to `jr.zaloapp.com`.** Verification is end-to-end, so a bad chain
   fails hard, but no live handshake has been attempted. Host-level attribution rests on
   certificate-transparency evidence, not a live probe.
3. **No cryptographic attestation.** The trust anchor is the CI run's record; the artifact
   was re-hashed against it and its identity read back, but there is no cosign/SLSA
   signature. A compromised CI runner would not be detectable from the artifact alone.
4. **Application fragility (new observation).** The application process terminates on an
   unhandled `pg` pool error when the database is administratively restarted, then
   recovers under `restart: unless-stopped`. Unrelated to this change; a follow-up should
   handle pool errors without process exit.
5. **Container-wide admission.** `PILOT_EGRESS_HOSTS` is container-wide, so once admitted
   `jr.zaloapp.com:443` is reachable for the whole connector process, not only during
   bootstrap. Only the bootstrap path installs the redirect policy; observe and send-test
   use the SDK facade's transport. This is the same shape as the retired `chat.zalo.me`
   admission, not worse.
6. **`crypto-js@4.2.0`** remains deprecated and transitively required by `zca-js@2.2.0`.
7. **App/gateway images are local builds**; they are not grant-bound and this record does
   not claim CI provenance for them.
8. **Stale-assertion correction.** The DB verifier's host-cluster check was changed (§7).
   The change is disclosed, keeps the fail-closed comparison when no session anchor is
   supplied, and the underlying property is separately evidenced by the container
   creation times and the session anchor.
9. **Hop bound is per response, not per process** (§5). A second independent
   `checkSession` 3xx in one process can authorise a second hop to the same host. The
   destination set is unchanged and the live path issues one `checkSession`; a stricter
   bound is a source change deferred to a future artifact.

## 14. Independent deployment review

A separate read-only reviewer (no file changes, no container lifecycle action, no
external host contacted; all image work under `--network none`) verified the eight
deployment claims independently.

**Verdict: PASS WITH RESIDUAL RISKS.** No Critical or High finding.

| Item | Independent result |
| --- | --- |
| Artifact identity | PASS — `sha256:220982a7…`, `/app/build-identity.json` returns `sourceCommit 8d9e39d…`, lock and SDK integrity exact; no cryptographic attestation |
| Allowlist consistency | PASS — JSON, gateway env, connector env and `extra_hosts` are byte-identical; `chat.zalo.me` appears only in comments / the `continue` parameter; static checker exit 0 |
| Redirect policy | PASS — compiled and source policies semantically identical; the `zca-js` polyfill hook is the SDK transport; probes for trailing dot, userinfo, backslash, downgrade, non-443 and foreign host all denied; no host-confusion bypass. Two claim-level bounds recorded in §5 |
| Network isolation | PASS — `pilot-db` and `pilot-egress` internal, `pilot-uplink` non-internal with gateway only; gateway on two networks; `PortBindings {}`; effective `ip_forward=0`; no connector container |
| Database TLS | PASS — preflight `TLSv1.3` / `TLS_AES_256_GCM_SHA384`; `sslmode=verify-full` in both the application and connector configuration |
| Security scan | PASS — `highCriticalCount 0`, `findings []`; residual licence-only noise and deprecated `crypto-js` |
| Fenced control state | PASS on every value; the reviewer's preflight returned `ok:false` solely because the application held one idle session (see §12) |
| No provider contact | PASS — gateway log contains only startups, shutdowns and the synthetic `denied-target.test` / `pilot-target.test` denials; no tunnel; no `session.enc`, QR or view files |

Dispositions:

- **Low — extra query parameters still classify as `checkSession`.** Accepted; the only
  destination remains `jr.zaloapp.com:443`, the SDK sends only `continue`, and the
  classifier is unchanged by this deployment. Recorded for a future policy revision.
- **Low — single-use is per response, not per process.** Accepted and documented (§5,
  §13); a stricter bound would change source and invalidate the artifact binding.
- **Low — transient `other_sessions=1`.** Resolved operationally: the reconciliation
  procedure quiesces the application and requires `0` immediately before the request
  (§12).
- **Info — `HostConfig.Sysctls` is empty.** The checker reads the effective value from the
  gateway's network namespace (`ip_forward=0`, IPv6 forwarding 0), not from config.
- **Info — application edge posture.** The application still joins the accepted
  non-internal `pilot-edge` bridge for its `127.0.0.1:3100` publish; its image contains no
  `zca-js` and no connector code. Unchanged from the Owner-accepted posture.
- **Info — scan record `ImageID` vs local id.** `1c643dd9…` is the CI config digest and
  `220982a7…` the local manifest digest; the link is the tag, the identical embedded
  build identity and the creation time, as recorded in §2.
- **Info — working-tree edit to the DB verifier.** Now exercised and disclosed in §7; it
  is part of this record's commit.

UNPROVEN per the reviewer, matching §13: that the image is the artifact of run
42635857403 without a signature; the provenance of the running application image
(`zalo-shared:g5-patched-af2be54`, local build); that no container other than the
gateway opened outbound sockets (only gateway logs cover egress); and the exact cause of
the extra database session beyond it being the application's `zs_app` idle pool.

## 15. Prohibitions observed

No live QR or Zalo authentication; no provider probing or contact; no reconciliation
execution; no G5-B observe; no G5-C send; no production deployment; no PR merge (PR #3
stays draft); no automatic retry; no security-control bypass; no ownership row modified;
no grant created; no credential, QR, session or UID committed.

## 16. Evidence index

- This record; `PILOT-GATE-STATUS.md`.
- Artifact and scan: `connector-g5-ci-8d9e39d-image-inventory.json`,
  `connector-g5-ci-8d9e39d-image-scan-summary.json`,
  `connector-g5-ci-8d9e39d-container-vulnerabilities.json`.
- Prior review: [G5A-REDIRECT-REMEDIATION-2026-11-09](G5A-REDIRECT-REMEDIATION-2026-11-09.md);
  CI provenance: [G5A-CI-PROVENANCE-2026-11-09](G5A-CI-PROVENANCE-2026-11-09.md).
- Original failure: [G5A-BOOTSTRAP-ATTEMPT-2026-11-09](G5A-BOOTSTRAP-ATTEMPT-2026-11-09.md);
  database baseline: [G5A-DB-TLS-VERIFICATION](G5A-DB-TLS-VERIFICATION.md).
- Tool local outputs (not committed): `/tmp/jr-db-tls.log`,
  `/tmp/jr-redirect-inimage.log`, `/tmp/jr-deployed.log`, `/tmp/jr-allowpath.log`,
  `/tmp/jr-scan.log`.
