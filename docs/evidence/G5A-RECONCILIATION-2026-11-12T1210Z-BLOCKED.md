# G5-A — Epoch-11 reconciliation attempt (`12:10Z` window): BLOCKED

**Date:** 2026-11-12
**Authorization:** exactly one administrative reconciliation of the fenced
2026-11-11 incident (`uncertain → idle`, epoch 11 → 12, gap 11 → 12,
`reconciliation_required` true → false), inside `2026-11-12T12:10:00.000Z` to
`2026-11-12T12:25:00.000Z`; no retry, extension or rescheduling.
**Verdict:** **`G5A_RECONCILIATION_BLOCKED`** — two independent blockers: no
reviewed epoch-11 executor or incident-bound request exists, and the container
runtime is not running. No mandatory predicate could be verified and nothing was
stopped, sent, marked or mutated.

## 1. Decision basis

The authorization directs: if an epoch-11 wrapper or request is not yet reviewed,
or any mandatory predicate differs, stop and report BLOCKED, and do not invent or
bypass security bindings to meet the window. Both conditions hold.

### 1.1 No reviewed epoch-11 procedure or request

Reviewed artifacts at `HEAD 85cfea4f75b095527fa9cb053d6573c951abc8ff` (clean tree):

| Artifact | Binding | Usable for epoch 11? |
| --- | --- | --- |
| `ops/local/reconcile-20261111.sh` | epoch-9 incident: owner `0280fd84-…`, epoch `9`, gap `9`, `prior_reconciliations=4`, request `reconcile-request-2026-11-11.json`, marker `reconcile-attempt-20261111.json`, post-state `idle\|10\|…` | **No** — wrong incident, wrong target epoch, request already consumed by the executed `09:12Z` run, and its one-shot marker already exists (the wrapper would refuse `already-attempted`) |
| `ops/local/reconcile-pilot.sh` | epoch-5 incident, `2026-11-07T00:54Z` window | **No** |
| `ops/local/reconcile-pilot-state.mjs` | incident-agnostic driver, expects incident bindings from the caller | reachable only through a wrapper |
| `ops/local/preflight-pilot-reconciliation.mjs` | incident-agnostic read-only preflight | reachable only through a wrapper |

The private state directory contains requests only for `2026-11-10` (epoch 7) and
`2026-11-11` (epoch 9), windows only for `20261110` and `20261111`, and attempt
markers through `reconcile-attempt-20261111.json`. There is **no**
`reconcile-request-2026-11-12.json`, **no** `reconcile-attempt-20261112.json`
and no epoch-11 wrapper. The reviewed driver and preflight blobs still match the
wrapper pins (`bb7a18cc…`, `b3f34274…`), so the reviewed *operation* is intact;
what is missing is the incident binding for epoch 11.

Creating the epoch-11 owner/epoch/gap constants, a fresh `requestId`/`evidenceRef`
and a new one-shot marker path inside the authorized window would be a new,
unreviewed security binding adopted under time pressure — exactly what the
authorization prohibits. It would also have to be written blind, because the
authoritative rows cannot be read (§2, §3).

### 1.2 Container runtime unavailable

The host container runtime is not running, so neither the wrapper nor a
read-only check of the pilot could execute:

| Probe (`2026-11-12T12:09:52Z`–`12:10:35Z`) | Result |
| --- | --- |
| `docker` on `PATH` (WSL `Ubuntu-24.04`) | absent |
| `/usr/bin/docker` | dangling symlink into `/mnt/wsl/docker-desktop/cli-tools/…` |
| `/var/run/docker.sock` | does not exist |
| `/mnt/wsl` contents | `resolv.conf` only |
| `wsl -l -v` | `Ubuntu-24.04` Running, `docker-desktop` **Stopped** |
| Windows `com.docker.service` | **Stopped** |
| Windows `Docker Desktop` processes | 0 |

Starting Docker Desktop or re-provisioning WSL integration is a host-level action
outside the reconciliation procedure; performing it inside the window to force a
run would be a second unauthorized action, so it was not taken.

## 2. Facts verified inside the window (read-only)

| Check | Time (UTC) | Result |
| --- | --- | --- |
| Authorized window state | `12:09:47Z` before open; `12:10:22Z`–`12:11:11Z` inside | window open, not expired |
| Reviewed source tree | `12:10:22Z` | clean at `85cfea4`, no changes under `server`, `connector`, `ops/local`, `dist` |
| Reviewed driver / preflight blobs | `12:10:22Z` | `bb7a18cc…`, `b3f34274…` — match the reviewed pins |
| Epoch-11 request file | `12:10:22Z` | absent |
| Epoch-11 one-shot marker | `12:10:22Z` | absent |
| Private `pilot/session.key` | `12:11:11Z` | present (expected) |
| Private `pilot/session.enc` | `12:11:11Z` | absent |
| Private `pilot/qr.png` | `12:11:11Z` | absent |
| Private `pilot/quarantine` | `12:11:11Z` | absent |

The four private-filesystem checks are the only preflight predicates that do not
need the container runtime; they passed. Every remaining predicate is UNVERIFIED.

## 3. Mandatory predicates not verifiable (UNVERIFIED)

- Ownership row: `phase=uncertain`, `epoch=11`, owner `1c6bebbb-…`, fault
  `shutdown`, `uncertain_at` `2026-11-11T14:46:30.759Z`.
- Provider row: `disconnected`, gap `11`, `reconciliation_required=true`, fault
  `shutdown`.
- Audit: exactly 38 rows as the authorization expects, with the
  `connector.reconciled` count re-read (the epoch-9 run left 5: four earlier
  events plus its own) and prior fencing history preserved.
- Zero other database sessions, zero advisory locks, zero unresolved delivery,
  outbox, media or provider work.
- No connector, bootstrap or worker container or host process.
- Egress gateway: container identity, creation time, health, byte-identical log
  against the deployment baseline.
- Deployed application: availability, health, and quiescence capability.
- Reviewed images and digests present (`zalo-shared:g5-patched-af2be54`
  `sha256:989c6154…`), and the gateway baseline file present.
- Admin credential file present and usable.

The last **verified** control state remains the 2026-11-11 `14:43Z` bootstrap
close-out: `uncertain`, epoch 11, provider gap 11,
`reconciliation_required=true`, audit 38. That is a historical observation, not a
current confirmation; this attempt neither confirms nor contradicts it.

## 4. Non-actions

- No reconciliation request was issued; no HTTP request of any kind was sent.
- No application was stopped or started; no container was created, started,
  stopped or removed.
- No one-shot marker, window file, request file, attempt marker or lock file was
  created or modified.
- No control row, audit row, provider row, gap or fence was written; no direct
  SQL was opened against the pilot database.
- No image was built, tagged or pulled; no container registry was contacted.
- No Zalo provider contact, no QR generation, no login, no observe, no send, no
  media action, no deployment and no PR merge.
- No credential, session, key rotation or quarantine artifact was created.
- No host-level action: Docker Desktop was not started, WSL was not restarted and
  no configuration was changed.

## 5. What is needed to proceed

1. **Host runtime recovery, separately authorized.** Restore the container
   runtime (start Docker Desktop / re-provision WSL integration for
   `Ubuntu-24.04`) and verify the pilot stack: `pilot-postgres` healthy with TLS,
   the egress gateway healthy with its expected identity, and no connector.
2. **Re-read the authoritative rows** and record the full stored owner identifier
   for epoch 11, the audit row count and the `connector.reconciled` count, and the
   gateway baseline. These values are required to bind the request and cannot be
   assumed from the `14:43Z` close-out.
3. **Review an epoch-11 wrapper** (owner `1c6bebbb-…`, epoch 11, gap 11, fault
   `shutdown`, post-state `idle|12|…|disconnected|12|false`) with its own
   request file, window file and one-shot marker path, committed and reviewed at
   a pinned HEAD before the window opens.
4. **A new Owner UTC window** bound to that reviewed commit and a fresh
   `requestId` / `evidenceRef`, with exactly one execution and no retry.

Until then the fenced state stands: no QR, no login, no observe, no send, no
media action, no bootstrap and no manual reset of either control row.

## 6. Evidence status and sanitisation

This is a BLOCKED report, not an execution record: there is no live execution
evidence because no execution occurred. The read-only probes above are
reproducible non-secret facts (times, exit statuses, file presence). This record
contains no passwords, cookies, tokens, session material, message content or
external provider addresses, and it prints no account identifier.
