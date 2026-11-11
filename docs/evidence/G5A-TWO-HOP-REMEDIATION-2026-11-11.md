# G5-A two-hop redirect remediation (2026-11-11)

**Date:** 2026-11-11
**Authorization:** `OFFLINE TWO-HOP REDIRECT REMEDIATION AND PREPARATION ONLY`
**Base HEAD:** `347f06b0615f7b7ecc906d800a8d1d8320595cc3`
**Live action:** none. No QR, no provider contact, no reconciliation, no deployment,
no live allowlist change, no observe/send-test, no merge and no retry.

## 1. What the 2026-11-11 attempt established

The authorized attempt followed the one admitted redirect and then met a second
one: `id.zalo.me` → `jr.zaloapp.com` → `jr.chat.zalo.me`. The reviewed one-hop
policy refused the second Location (`redirect-after-hop`, `hops=1`) before any
socket to `jr.chat.zalo.me` opened, and fenced ownership `uncertain` at epoch 9.
See [G5A-BOOTSTRAP-ATTEMPT-2026-11-11.md](G5A-BOOTSTRAP-ATTEMPT-2026-11-11.md).

This mission implements exactly that observed two-hop chain, offline, under the
12 policy requirements in the Owner directive. It does not assume the second
redirect is the provider's final step: a third Location, a loop, a direct
request to either redirect host, or a reused authorization fails closed.

## 2. Policy change

`adapters/zalo/redirect-policy.ts` now admits a chain of at most two hops:

| Check | Behaviour |
| --- | --- |
| Hop 1 source | only the exact reviewed `checkSession` GET/undefined request on `id.zalo.me` |
| Hop 1 destination | only `https://jr.zaloapp.com:443` (absolute, no userinfo, no IP literal, no trailing dot, no backslash, port empty or 443) |
| Hop 2 source | only the authorized hop-1 response (`pending.hop === 1`) |
| Hop 2 destination | only `https://jr.chat.zalo.me:443`, the same grammar |
| Authorization | `pending` is a single-use, chain-bound `{href, hop}` and is spent before the request is dispatched |
| Third redirect | `redirect-after-hop` (`MAX_HOPS = 2`), no request follows |
| Direct requests | `jr.zaloapp.com` is never a request target (`direct-redirect-host`); a direct request to `jr.chat.zalo.me` while hop 2 is pending is `stale-hop`. A direct `jr.chat.zalo.me` request at any other time stays an ordinary `provider-direct` call — the SDK's own `/jr/userinfo` needs it — and it never receives hop authorization |
| Bypass / loop | a direct provider request clears `pending`, so a stale Location cannot authorize a later request |
| Malformed | non-absolute, downgraded, ported, userinfo, IP literal, wildcard, lookalike, trailing-dot, backslash and unparseable Locations are refused before the socket |
| Manual redirect | `redirect: "manual"` is set on every request; the wrapper is the only thing that can authorize a second request |
| TLS / routing | unchanged: end-to-end verification at the connector, gateway host pinning to `172.16.29.10:443` |
| Hostnames | no new hostname: the chain reuses the already-admitted `jr.zaloapp.com` and `jr.chat.zalo.me` |

`ops/pilot-egress-allowlist.json` and `ops/local/check-pilot-network.sh` now name
the same chain (`maxHops: 2`, `chain: ["jr.zaloapp.com", "jr.chat.zalo.me"]`,
every chain host already admitted); the four-host allowlist is unchanged:
`id.zalo.me`, `wpa.chat.zalo.me`, `jr.chat.zalo.me`, `jr.zaloapp.com`.

## 3. Diagnostics (§5)

The closed vocabulary keeps its shape and adds `second-hop-denied` for a hop-2
refusal. Request categories remain `check-session`, `provider-direct`,
`redirect-follow`, `other`. Two corrections from review:

- a direct request to the redirect host is recorded as `other` with
  `direct-redirect-host` (previously `redirect-follow`); only a request that
  actually spends an authorization is a `redirect-follow`;
- `normalizeDiagnosticDetail` caps `hops` at 2 (`server/pilot-diagnostic.ts`),
  matching the policy instead of the former 8.

The recorded fields are unchanged — stage, reason, request, redirect class,
source and destination hostnames, hop count, UTC time, correlation id — and no
full URL, path, query, `Location` value, cookie, token, QR content, UID, phone
number or credentials can reach the sink. The first-hop refusal, second-hop
refusal, third-hop attempt, incorrect source/destination, direct-host bypass and
stale/reused authorization are each distinguishable by the closed pair
(`request`, `redirect`).

## 4. QR staged-copy cleanup (§6)

The 2026-11-11 defect: the Windows staged copy `C:\Users\Admin\pilot-private-qr\qr.png`
survived `viewer-close source-cleared` and was removed by hand at about 01:00Z.

Fixes in `ops/local/qr-viewer.ps1`, `ops/local/qr-viewer-guard.ps1` and
`ops/local/launch-qr-viewer.sh`:

- presence is read by directory enumeration and reported tri-state; an unreadable
  directory is never mistaken for "absent";
- `Remove-Staged` retries until both oracles agree the copy is gone; a refusal
  that cannot confirm removal exits 5 with `cleanup=FAILED`, while a refusal that
  did clean up keeps its own code (timeout 3, invalid input 4) and clears the run id;
- the guard re-reads ownership (by run id) immediately before every delete and
  fails closed: a missing or unreadable run file, or another run's id, means it
  does not delete;
- a copy that was seen and deleted is confirmed by one absent reading; a copy that
  was never seen is only believed absent after 12 consecutive samples (about 3 s),
  and `$null` samples reset that window;
- a live viewer heartbeats its run file each poll, so a display lasting longer
  than a minute is never mistaken for a dead run;
- the launcher serialises launches with `flock` and sweeps a stale `qr.png` (run
  file older than one minute) before starting a new run, so a crash that outlived
  both viewer and guard cannot leave a copy for the Owner to find;
- `docs/operations/G5-LIVE-PILOT-PROCEDURE.md` documents the viewer, the guard,
  the exit-5 contract and the sweep.

Rehearsed with synthetic fixtures only (no real QR): a seven-scenario run
completed at 01:38:47–01:39:17Z on the viewer as it stood then, covering valid
fixture, corrupt PNG, truncated PNG, source-cleared close, forced viewer kill,
timeout and bounded display; every path ended with the staged copy gone. The
00:54:45Z incident log, by contrast, records `viewer-close source-cleared` with no
removal line: the old code closed as if clean without deleting the copy, while the
rehearsed code logs `viewer-form-closing staged-copy-removed` before
`viewer-closed cleanup=final`. The cleanup-hardening edits were made about ten
minutes later, so they are covered by
the direct guard tests below and by independent review, not by a second window
rehearsal: no further viewer window was opened. A duplicate invocation interrupted
before staging left no copy; the stage directory contains no `qr.png`, and no
viewer or guard process exists.

The Owner saw several of those rehearsal windows appear in quick succession and
reported that the code was repeated and did not look like a Zalo login QR. That is
expected: every window in the rehearsal displayed the synthetic fixture
(`sha256 2dab0568…`, 480×600), generated locally, and the viewer contacts no
network. It is not a provider QR and no image or scan data was transmitted. The
duplicate invocation logged at 01:39:18Z reached only `viewer-start` — no staging,
no window, no copy — and the stage directory now holds neither `qr.png` nor a run
file. No viewer, guard or launcher process is running and nothing is scheduled to
reopen one.

The guard's ownership semantics were additionally exercised directly in a
temporary stage directory (dummy bytes, dead PID, no window), re-run against the
final script bytes before this record was committed:

| Case | Result |
| --- | --- |
| run id matches, copy present | `removed-staged`, copy and run file gone, exit 0 |
| a newer run id owns the stage | `superseded`, copy preserved |
| no run file | `superseded`, copy preserved (the launcher's next start sweeps it) |

## 5. Offline verification

| Check | Result |
| --- | --- |
| `npm run typecheck` | PASS (clean) |
| `npm run test:transport` | **178/178 PASS** |
| `npm test` (disposable PostgreSQL) | **421/421 PASS** |
| `npm run test:sdk` (pinned `zca-js@2.2.0`) | 2/2 PASS |
| `npm run build` / `npm run build:connector` | PASS |
| `ops/local/check-pilot-network.sh` | all assertions PASS (4 hosts, 2-hop chain, pins, topology) |

Typecheck and the transport suite were re-run on the committed tree `d6f8aec`
after the last edits: clean and **178/178**.

The redirect suites cover the valid chain, invalid hop order, a direct destination
request, a third redirect, loops, malformed/Lookalike/downgraded Locations, reused
and stale authorizations, a non-3xx `Location`, and an environment that withholds
`jr.zaloapp.com`; the real pinned SDK drives the policy so the assertions exercise
the code path the connector runs. No test opens a socket, resolves a name or
contacts the provider.

## 6. Independent review

The change was reviewed before commit by an independent reviewer with read access
to the pinned SDK, the policy, the diagnostics and the wrapper. An earlier
background review attempt stalled and was stopped without a verdict; no finding
is attributed to it. The foreground review covered the 12 policy requirements and
the wrapper/cleanup code and returned:

**VERDICT: APPROVE WITH CONDITIONS.**

What it confirmed: no request path exists outside the observed chain; the
authorization is spent before dispatch; a third hop, loop, direct-host bypass,
reused/stale permission and malformed or downgraded Location each fail before a
socket; the diagnostics cannot carry a full URL, `Location`, cookie, token, QR
content or UID; the viewer removes its copy on every close path it can reach.

| Finding | Severity | Disposition |
| --- | --- | --- |
| `$gateway_last` read in the post-check but never assigned under `set -u`; the wrapper would have failed after the database mutation | Critical | **Closed** — the pre-fence assignment is restored and compared |
| a gateway restart erases the pre-incident log, so "nothing after the fence" could pass on an empty log | High | **Closed** — the predicate fails on `startup` after the fence, on untimestamped events, and on a container created at/after the fence |
| run-file mtime was the run start, so a display longer than a minute could be swept as stale | Medium | **Closed** — the live viewer heartbeats the run file each poll (`Touch-RunId`) |
| two launches could race the same stage directory | Medium | **Closed** — the launcher serialises with `flock` |
| check-then-delete between guard and a new run | Medium | **Disclosed residual** — mitigated by the re-read before every delete, the launcher lock and a single operator; not eliminated |
| evidence overstated the exit-5 paths and the 12-sample rule | Low | **Closed** — §4 corrected |
| evidence implied the 01:38 rehearsal reproduced the incident log | Low | **Closed** — §4 now states the old 00:54 code logged no removal line |

Condition: commit the reviewed bytes and rebuild them through CI. Met by
`d6f8aec2197bc8249b91bd9d4595e36f3129c0b4` (§7); typecheck and the transport
suite were re-run on the final tree, and the three guard ownership cases were
re-run against the final guard bytes.

Two residuals are disclosed rather than fixed: the check-then-delete window
above, and the fact that a double kill (viewer and guard together) is covered only
by the launcher's next-start sweep. Neither can leave a copy that the Operator
would have to hunt for in the rehearsed failure modes; the sweep is the last
resort and has not been exercised end-to-end on the final bytes (§9).

## 7. CI artifact and deployment preparation (§8)

The reviewed commit `d6f8aec2197bc8249b91bd9d4595e36f3129c0b4` was pushed to
`feat/shared-inbox` and built by the `CI` workflow on PR #3 (draft, still open):

| Field | Value |
| --- | --- |
| Run / attempt | `42943971343` / 1, `pull_request`, `refs/pull/3/merge` |
| `pilot` job | success (connector image built from the reviewed commit) |
| `test` job | success (build, full suite, browser/load, recovery, monitoring, container smoke) |
| Source commit | `d6f8aec…` (asserted by the workflow's "Build inputs are the reviewed commit") |
| `lockSha256` | `17dcd254…` — equals `sha256sum connector/package-lock.json` |
| `sdkIntegrity` | `sha512-pBU0T0…` — equals `zca-js@2.2.0` in the connector lock |
| Artifact | `pilot-connector-image`, id `13822176119`, 166,080,000 bytes |
| Archive SHA-256 | `d2410cdb…` — re-hashed after download, equals the workflow record |
| Image id (config) | `sha256:9923258e6c0195f8cdc4485b1abbb47dbc364e8e0e027d7a61544b18e57ca653` |
| Loaded image | local containerd store reports `sha256:d2a85b19…` (the platform-manifest digest); the OCI manifest's config is `9923258e…` and all 29 rootfs layers equal the manifest's layer digests, so the content is the recorded image |
| Runtime shape | uid `65532:65532`, entrypoint `/nodejs/bin/node --require=/app/egress-guard.cjs`, `NODE_ENV=production` |
| Staged tag | `zalo-shared-connector:g5-ci-d6f8aec` (local only) |

The image is staged by local tag for the private deployment, not deployed: the
private image pointer still names `g5-ci-8d9e39d`, and no compose file, gateway or
allowlist was changed. The four-host allowlist is byte-for-byte the reviewed set
(`id.zalo.me`, `wpa.chat.zalo.me`, `jr.chat.zalo.me`, `jr.zaloapp.com`).

## 8. Reconciliation readiness (§9)

Read-only verification at the committed HEAD `d6f8aec` (identical to the base-HEAD
values recorded before the commit):

| Field | Value |
| --- | --- |
| `connector_ownership` | `uncertain`, epoch 9, owner `0280fd84-9026-4c91-bda2-7e16013ee7dd` (`pilot-enrollment`), `shutdown`, `2026-11-11T00:54:44.993048Z` |
| Last fenced pair | `af5048a8-41c7-46b3-920c-310855d6c911` / 7 |
| `provider_state` | `disconnected`, gap 9, `reconciliation_required=true`, `shutdown` |
| Audit | 33 rows, max id 33, 4 prior `connector.reconciled` |
| Identities / sessions | 1 user, 1 active admin, 0 sessions |
| Advisory locks / unresolved work | 0 / 0 |
| Data tables | messages, outbox, delivery parts, provider events, media jobs, attachments, conversations all 0 |
| Connector | no container, no host process |
| Application / gateway | `running healthy` / `running healthy` |
| Gateway log | two allowed tunnels (`id.zalo.me`, `jr.zaloapp.com`) from the attempt; four pre-incident synthetic denials from 2026-11-09; nothing after the fence |

`ops/local/reconcile-20261111.sh preflight` at `d6f8aec`: **PASS** — head, driver
and preflight blobs, image digest and uid all match; the prepared request is
`notSent` and bound to owner/epoch/gap 9; the fence, provider state and audit are
unchanged; the gateway is unchanged; the private state is session-key-only;
`advisory_locks=0 db_sessions=0`. Nothing was stopped, sent or written outside the
private lock file. Preflight-only: the application was not quiesced.

Prepared, not executed: `ops/local/reconcile-20261111.sh` (one-shot wrapper,
`uncertain → idle`, epoch 9→10, gap 9→10) bound to the fenced owner/epoch/gap, the
fence prefix, the reviewed driver/preflight blobs, the unchanged application image
`sha256:989c6154…`, and the private request
`reconcile-request-2026-11-11.json` (`requestId 4203bde7-…`, `notSent: true`). A
window file with the matching `authorizationRef` does not exist, so the wrapper
cannot execute; it refuses without one. Two review findings in the wrapper were
fixed before any execution: the pre-check predicate bound to "no traffic after the
fence" (the log now ends with the authorized attempt's tunnels), and the
post-execution check no longer references an unset variable — it compares the
gateway log's last line before and after the run. The predicate also fails on an
untimestamped event, on any `startup` event after the fence, and on a gateway
container created at or after the fence, so erasing the log by recreating the
container cannot hide contact.

## 9. Remaining uncertainty

1. The chain is proven offline against the pinned SDK and synthetic responses,
   not live. Whether the provider's hop-2 response is the final step is UNPROVEN;
   a third redirect fails closed.
2. The seven-scenario window rehearsal ran at 01:38–01:39Z, before the final
   cleanup edits; those edits are validated by the direct guard tests and review,
   not by a new window rehearsal (deliberately: no further viewer windows were
   opened). The staged copy is absent and no viewer process remains. UNPROVEN:
   the end-to-end window close path on the exact final bytes.
3. The read-only preflight observed zero database sessions on this run; if the
   idle application holds a pool session it reports `app_quiesce_required=1`
   instead. The execute path stops the application and proves zero other sessions
   before sending, either way.
4. The deployment remains a separate Owner-authorized step: the private image
   pointer still names the deployed `g5-ci-8d9e39d` artifact.
5. `chat.zalo.me` stays excluded; no admission was widened beyond the observed
   chain.

## 10. Terminal verdict

**G5A_TWO_HOP_FIX_REVIEWED_AND_RECONCILIATION_READY**

The two-hop policy is reviewed, committed (`d6f8aec`) and built through CI
(`42943971343`, both jobs succeeded) on that commit. The CI-origin connector
artifact is verified by archive hash, source commit, lockfile, SDK integrity and
image config/layer identity, and is staged locally as `g5-ci-d6f8aec`; it is not
deployed and the live pointer still names `g5-ci-8d9e39d`. The QR staged-copy
defect is fixed, the fix was rehearsed with synthetic fixtures, and the guard was
re-tested against its final bytes; no copy remains and nothing is scheduled to
reopen the viewer. Online state is unchanged: `uncertain` epoch 9, gap 9,
`reconciliation_required=true`, zero sessions, no connector, gateway unchanged.
The epoch 9→10, gap 9→10 reconciliation is prepared and bound but not executed;
without the Owner window file the wrapper refuses.

Remaining uncertainty: hop 2 is proven offline only (the pinned SDK and synthetic
responses); a third hop is refused, not observed, so whether hop 2 is the
provider's final step stays UNPROVEN. The cleanup edits were validated without a
window, so the end-to-end window close on the exact final bytes is UNPROVEN. The
check-then-delete race and the double-kill sweep are disclosed residual risks.

No real QR, provider contact, reconciliation execution, live allowlist change,
observe/send-test, production deployment, PR merge or automatic retry occurred.
