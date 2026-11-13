# G5-A — Epoch-11 reconciliation readiness

**Date:** 2026-11-13
**Directive:** continue G5-A after the host-runtime recovery: verify the runtime
and the pilot stack, read the authoritative control state, prepare the
epoch-11 → 12 single-use reconciliation, test it offline, review it, and stop
before any live execution.
**Verdict:** **`G5A_EPOCH11_RECONCILIATION_READY_AWAITING_OWNER_START`** — the
wrapper, request and baseline are prepared and rehearsed; no Owner window exists,
so nothing was stopped, sent or reconciled.

## 1. Runtime and pilot stack (VERIFIED)

Docker Desktop's WSL integration is live again from the Windows side: `docker`
resolves through `/mnt/wsl/docker-desktop/cli-tools`, the engine socket exists and
reports server `29.6.2`. The pilot stack was then brought back from the reviewed
recipes:

| Component | State | Identity |
| --- | --- | --- |
| `pilot-postgres` | running, healthy | `postgres:17-bookworm@sha256:858bb5e9…` |
| `zalo-shared-pilot-app-1` | running, healthy | `zalo-shared:g5-patched-af2be54` = `sha256:989c6154…` |
| `zalo-shared-pilot-egress-gateway-1` | running, healthy | `421984c5…`, created `2026-11-11T08:43:37.768858461Z` |
| network `zalo-shared-pilot-db` | `internal=true`, `172.16.30.0/24` | members: postgres, app |
| volume `pilot-postgres-data` | intact | data predates this session |

Checks: `verify-pilot-db-tls.sh` PASS (TLS `verify-full`, runtime-role grants,
foreign-CA refusal, dump/restore, host-cluster timing), `check-pilot-network.sh`
PASS (gateway address, four-host allowlist, `ip_forward=0`), and
`check-lan-exposure.sh` with the pilot overrides 10/10 PASS (the script's defaults
target the stopped G2 stack).

**Recovery disclosures.** The Docker Desktop restart stopped unrelated workloads;
`nhd-study-*`, `zs-pg-test` and `zalo-shared-g2-*` remain `Exited` and were not
restarted. `pilot-postgres` and the pilot app were recreated from
`ops/local/provision-pilot-db.sh` and `ops/local/deploy-pilot-app.sh` because
their bind mounts still referenced pre-restart translation paths (the postgres
container could not read its TLS key, the app its CA); the data volume was
preserved. The gateway restarted **in place** — same container, image and creation
time — so its log gained `shutdown`/`startup` lines but no tunnel lines, which
required renewing the baseline (§4). `verify-pilot-db-tls.sh` restarted
`pilot-postgres` once and removed its own synthetic rows, as designed.

## 2. Authoritative control state (READ-ONLY)

Read with `SET default_transaction_read_only=on`:

| Field | Value |
| --- | --- |
| `connector_ownership` | `uncertain`, epoch `11`, owner `1c6bebbb-3605-4bb6-957d-798951bf73bb`, fault `shutdown` |
| `uncertain_at` | `2026-11-11T14:46:30.766352Z` |
| fencing | last fenced `0280fd84-9026-4c91-bda2-7e16013ee7dd`, epoch `9` |
| `provider_state` | `disconnected`, gap `11`, `reconciliation_required=true`, fault `shutdown` |
| `audit` | 38 rows, max id 38, five `connector.reconciled`, zero `connector.fenced` |
| advisory locks / other sessions | 0 / 0 |

This is exactly the fence the preparation is bound to.

## 3. Prepared wrapper

`ops/local/reconcile-20261113.sh` (commit `2bf8484`, test-path overrides in
`91e7d05`) is the epoch-9 wrapper re-bound to the epoch-11 incident:

- owner `1c6bebbb-…`, epoch `11`, gap `11`, fault `shutdown`, uncertain prefix
  `2026-11-11T14:46:30`, last fenced `0280fd84-…`/`9`, five prior reconciliations;
- post-state assertion `idle|12||<owner>|11|disconnected|12|false`;
- the reviewed driver and preflight blobs are pinned (`bb7a18cc…`, `b3f34274…`)
  and still match at HEAD;
- added guards: the request file must be `0600` and owned by the invoking user,
  the body must carry `confirmOwnerApproved`, no `connector.fenced` audit row may
  exist, and the **deployed** application container must be the reviewed image;
- the window is never hardcoded: it must come from
  `$PILOT_PRIVATE_DIR/pilot-admin/reconcile-window-20261113.json`, which **does
  not exist**;
- the single-attempt marker `reconcile-attempt-20261113.json` **does not exist**.

Order of a run: identity → request → stale connectors → gateway baseline →
private filesystem → fence/provider/audit (read-only) → locks/sessions →
`preflight` exits here → confirm flag → window validation → single-attempt marker
(noclobber) → only then `docker stop`, quiescence, the read-only preflight
container, one loopback-only app container, exactly one POST, removal, restart of
the deployed app and an independent read-only verification.

Preflight output at `2bf8484`+:

```
fence=uncertain|11|1c6bebbb-…|shutdown|2026-11-11T14:46:30|0280fd84-…|9
provider=disconnected|11|true|shutdown audit_rows=38 audit_max=38
advisory_locks=0 db_sessions=0
preflight=pass preflight-only: nothing stopped, nothing sent
```

## 4. Prepared request and renewed gateway baseline

`pilot-admin/reconcile-request-2026-11-13.json` (0600): `notSent: true`,
`requestId b1722f5e-d79d-4df3-91f8-f724d6f78f96`, owner/epoch/gap as above,
`confirmOwnerApproved: true`, evidence reference
`G5A-OWNER-AUTH-2026-11-13-RECONCILIATION`. The Owner authorization must use
exactly that reference, because the wrapper requires the window's
`authorizationRef` to equal the request's.

`pilot-admin/reconcile-gateway-baseline-20261113.json` (0600) pins the gateway
container id, image, creation time and the SHA-256 of the full container log
(`a1d9d1af…`, 7 lines) as of `2026-11-13T00:13Z`. The log contains exactly two
`sni_allow` lines, both from the failed attempt of 2026-11-11, and none after
them; any restart, recreation or tunnel changes the hash and fails the wrapper.

## 5. Safeguards (offline evidence)

**CSRF and admin authentication** — `verify-disposable-admin-http.sh` on the
disposable database: 19/19 checks PASS, including invalid credentials 401, admin
login 200 with a 43-byte CSRF token, a state-changing POST without CSRF 403, a
foreign `origin` 403, an unconfirmed body 400, a non-admin 403, one applied
transition, an idempotent replay (`alreadyApplied: true`, still one audit row),
logout and no surviving session.

**Driver window, lock and replay** — `verify-reconcile-driver.sh`: all assertions
PASS. Outside-window and expired windows exit 2 and send nothing; the DB
single-flight lock refuses a concurrent driver; a reused request id is refused
before any request; one apply advances the state exactly once. The harness's
host-lock and duplicate-marker fixtures were pointing at lock/marker names the
legacy orchestration script no longer uses, so those two refusals had not been
executed since the script was rebound; `9b08f11` corrects the fixture names and
both refusals now pass.

**Wrapper refusals** — `ops/local/verify-reconcile-20261113-refusals.sh`,
committed as `867953c`: 106/106 assertions PASS across fifteen cases — missing
confirmation, missing window file, expired window (exit 2 plus the expiry token),
not-yet-open window, mismatched authorization reference, held host lock,
pre-existing attempt marker, six tampered request fields (owner, epoch, gap,
`notSent`, approval, request id), and a request file with permissions `0644`.
After every case the deployed app was still `running`, the fence and the audit
table were unchanged, no real attempt marker existed and no one-shot container
was left. The one-shot mount was also proved to expose the credential to the
invoking uid, so the `0700`/uid-1000 state directory is readable by the
`--user 1000:1000` containers the wrapper starts.

**Application suite** — `tests/backend` + `tests/transport` with the disposable
database: 421 tests, 0 failures.

## 6. QR viewer

`rehearse-qr-viewer.sh` passes with exactly one visible window and no residue;
the detached-lifetime section reports `survivedProcessGroupKill: true`,
`close: source-cleared`, `cleanup: final`. **Observation:** the first run failed
one timing-sensitive assertion — in the attempt-handover section the superseded
viewer refreshed to the new attempt's bytes (`viewer-refreshed … run=…-old`) about
one second before it logged `viewer-close superseded` — and the second run passed.
The viewer's tick reads the owner file and then the source; a tick that starts
just before the ownership change can therefore display the new bytes briefly
before the next tick closes the window. Presentation only, no provider contact;
recorded rather than changed, because the viewer was just fixed and rehearsed and
this directive authorises no viewer change.

## 7. Independent review

An independent read-only review reported **READY WITH OBSERVATIONS**: blob pins
match, no mutation precedes the window/marker, all bindings match the
authoritative state, and the gateway baseline fails closed on recreation,
restart or tunnel. Observations and dispositions:

| Observation | Disposition |
| --- | --- |
| Baseline `reason` text said no log line followed the 2026-11-11 tunnels | corrected: the log ends with the `2026-11-13T00:08:00Z` startup line and has no `sni_allow`/`sni_deny` after the two attempt lines |
| Env overrides make the window and marker paths caller-selectable | the caller already owns `$state`; point a production run at the committed wrapper with a clean environment |
| Driver exit code is not part of the wrapper verdict; success is derived from the DATABASE state | inherited from the reviewed epoch-9 wrapper; the wrapper re-verifies the fence, audit increment and residual work independently |
| `cleanup` removes a `pilot-reconcile-app` container even in preflight | unreachable in practice: preflight refuses first if such a container exists |
| Window expiry is checked when the driver starts, not immediately before the POST | inherited from the pinned, reviewed driver; the Owner must size the window generously |

## 8. CI

CI on `5562617` (the commit before this preparation) succeeded. The preparation
commits `2bf8484`, `91e7d05`, `9b08f11` and `867953c` were pushed; the run on
`867953c` was cancelled by the branch's cancel-in-progress rule when this evidence
commit was pushed, after its `pilot` job had already succeeded. The run on this
commit (`54dc729`, run `43337778478`) passed both the `test` and `pilot` jobs.

## 9. Posture and non-actions

- No reconciliation was executed, no POST was sent, no QR was generated, no
  provider was contacted, nothing was observed or sent, no deployment or merge
  occurred, and PR #3 remains a draft.
- No destructive Docker change was made to unrelated workloads; only the two
  pilot containers were recreated from the reviewed recipes, and only after their
  mounts were proven broken by the runtime restart.
- No database write was made to the pilot database; every pilot query ran
  read-only. The disposable instance was used for the HTTP, driver and suite
  tests.
- No secret, session, QR, account identifier or provider address appears in this
  record.

## 10. What is needed to start

1. An Owner authorization naming the incident (owner `1c6bebbb-…`, epoch `11`,
   gap `11`) and the reference `G5A-OWNER-AUTH-2026-11-13-RECONCILIATION`, with a
   UTC window wide enough to cover quiescence, the preflight container, one POST
   and the restart — the whole chain is bounded by `timeout 420`.
2. The window file written to
   `~/pilot-private/zalo-shared/pilot-admin/reconcile-window-20261113.json`
   (0600) with `notBefore`, `notAfter`, `authorizationRef` and optionally the
   reviewed commit as `head`.
3. Then, once: `PILOT_RECONCILE_CONFIRM=ONE_SHOT bash ops/local/reconcile-20261113.sh execute`.

Until that window exists, the control state stays `uncertain`/`reconciliation_required=true`
and no bootstrap, QR, observation, send or media action is authorised.
