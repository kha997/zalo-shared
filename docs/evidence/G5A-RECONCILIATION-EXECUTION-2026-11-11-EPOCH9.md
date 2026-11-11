# G5-A epoch-9 single reconciliation — execution evidence (2026-11-11)

**Date:** 2026-11-11
**Authorization:** `OWNER AUTHORIZATION: ONE G5-A ADMIN RECONCILIATION, EPOCH 9 → 10, WITHIN THE SPECIFIED UTC WINDOW`
**Authorization reference:** `G5A-OWNER-AUTH-2026-11-11-RECONCILIATION`
**Owner window:** `2026-11-11T09:12:00.000Z` – `2026-11-11T09:27:00.000Z` (hard expiry)
**Verified HEAD:** `973ea7e` (working tree clean)
**Mode:** one administrative reconciliation through the reviewed admin API. No
provider contact, no connector launch, no QR, no send or media action.

## 1. Scope

The Owner authorized exactly one reconciliation of the fenced 2026-11-11
incident: ownership `uncertain → idle`, epoch `9 → 10`, gap `9 → 10`,
`reconciliation_required=true → false`, using the existing reviewed epoch-9
wrapper and the prepared request. Retry, rescheduling, extension, direct SQL
mutation, an alternative endpoint and provider contact were prohibited. The
authorization expired absolutely at `09:27:00Z`.

## 2. Prepared inputs (not regenerated)

| Input | Value |
| --- | --- |
| Wrapper | `ops/local/reconcile-20261111.sh` at `973ea7e` (driver blob `bb7a18cc…`, preflight blob `b3f34274…`) |
| Request id | `4203bde7-f27e-4f5c-adda-e8f4e4eb62fe` (prepared `2026-11-10T21:26Z`, `notSent` before this run) |
| Evidence ref | `G5A-OWNER-AUTH-2026-11-11-RECONCILIATION` |
| Incident binding | owner `0280fd84-9026-4c91-bda2-7e16013ee7dd`, epoch 9, gap 9, fault `shutdown`, fence prefix `2026-11-11T00:54:44`, last fenced `af5048a8-…`/7, 4 prior reconciliations |
| Window file | created `09:10Z` at `pilot-admin/reconcile-window-20261111.json`, mode `0600`, `notBefore`=`09:12:00.000Z`, `notAfter`=`09:27:00.000Z`, `head`=`973ea7e` |
| Attempt marker | absent before the run; written by the wrapper at completion |
| Confirmation gate | `PILOT_RECONCILE_CONFIRM=ONE_SHOT` |

The request id, evidence reference, incident identity and request body were not
invented, regenerated or altered. The wrapper re-verifies the driver/preflight
blobs, the reviewed image digest (`zalo-shared:g5-patched-af2be54`,
`sha256:989c6154…`, uid `65532:65532`) and the absence of a prior attempt marker.

## 3. Mandatory preflight (read-only)

Run immediately before the request at `~09:10–09:12Z`:

| # | Predicate | Result |
| --- | --- | --- |
| 1 | UTC inside window | PASS (`09:10Z`, start awaited) |
| 2 | Ownership `uncertain` epoch 9 | PASS |
| 3 | Exact owner `0280fd84-…` | PASS |
| 4 | Fault `shutdown` | PASS |
| 5 | Provider `disconnected`, gap 9, `reconciliation_required=true` | PASS |
| 6 | Audit intact, 33 records | PASS (33 rows, max 33) |
| 7 | No authenticated session / `session.enc` | PASS (`sessions=0`; `session.enc` absent) |
| 8 | Zero unresolved provider/message/delivery work | PASS (all queues 0) |
| 9 | No active connector or conflicting owner | PASS (no connector/worker container) |
| 10 | No advisory locks | PASS (0) |
| 11 | DB TLS `verify-full`, rotated credentials | PASS |
| 12 | Gateway healthy, four reviewed hosts | PASS (`running healthy`, 4 hosts) |
| 13 | Exact deployed image and gateway baseline | PASS (image digest; container `421984c5…`, created `08:43:37.768858461Z`, log SHA `be08a8a0…`) |
| 14 | No unexpected provider contact or deployment drift | PASS |

The application's idle PostgreSQL pool was quiesced by the reviewed procedure:
the deployed app was stopped and `other_sessions=0` was proved before the
request. No predicate failed, so execution proceeded.

## 4. Execution (single attempt)

| Time (UTC) | Event |
| --- | --- |
| 09:12:08 | Wrapper started (`flock` acquired; attempt marker armed) |
| 09:12:08 | App stopped; `quiescence=zero-other-sessions app=stopped` |
| 09:12:14 | Read-only preflight container: 13/13 checks PASS |
| 09:12:15.732 | Admin `auth.login` (audit 34) |
| 09:12:15.840 | Single `POST /api/provider/operations/reconcile` → HTTP 200 |
| 09:12:15.840 | `connector.reconciled` (audit 35), fence `last_fenced_at` updated |
| 09:12:15.884 | Admin `auth.logout` (audit 36) |
| 09:12:15 | Driver exit 0; one-shot container removed |
| 09:12:18.226 | Deployed application restarted, `running healthy` |
| 09:12:25 | Wrapper finished; attempt marker `outcome=reconciled`, `exitCode=0` |

Response body (sanitized):

```json
{"ok":true,"epoch":"10","gapVersion":"10","alreadyApplied":false}
```

Exactly one request was issued. There was no retry, no replay and no second
request after any error. The request id, incident identity, epoch/gap binding
and single-flight guard were enforced by the reviewed route; no direct SQL
mutation and no alternative endpoint were used.

## 5. Independent post-verification (separate read-only connection)

| Check | Independent result |
| --- | --- |
| Ownership | `idle`, epoch `10`, `owner_id` NULL |
| Fencing preserved | `last_fenced_owner_id` `0280fd84-…`, `last_fenced_epoch` 9, `last_fenced_at` `2026-11-11T09:12:15.840Z`, `fault_code` NULL |
| Provider | `disconnected`, gap `10`, `reconciliation_required=false`, `fault_code` NULL |
| Exactly one new reconciliation event | audit id 35 `connector.reconciled`, metadata `requestId` `4203bde7-…`, `evidenceRef` `G5A-OWNER-AUTH-2026-11-11-RECONCILIATION`, `epochBefore` 9 / `epochAfter` 10, `gapVersionBefore` 9 / `gapVersionAfter` 10, `ownerId` `0280fd84-…`, `localSessionFile` absent, `localQuarantine` absent |
| Prior evidence preserved | rows 1–33 unchanged (including `connector.uncertain` id 33 at `2026-11-11T00:54:44.993Z`); audit 36 rows, max 36, 5 `connector.reconciled` total |
| Auth rows | exactly one `auth.login` (34) and one `auth.logout` (36) for this attempt |
| Sessions / unresolved work | `sessions=0`; `provider_events`, `provider_ledger`, `provider_media_jobs`, `outbox`, `delivery_parts`, `messages`, `pilot_part_ledger`, `pilot_send_budget` all 0; advisory locks 0 |
| Private state | `session.key` present; `session.enc`, `qr.png`, `quarantine` absent |
| Connector / worker | none present |
| Application | `running healthy` (restarted `09:12:18.226Z`) |
| Gateway | same container `421984c5…`, created `08:43:37.768858461Z`, log SHA-256 `be08a8a0…` unchanged (zero tunnels) |
| Provider contact | none; no tunnel line in the gateway log |

The wrapper's own post-verification also passed. The independent queries were
executed on a separate read-only session (`default_transaction_read_only=on`),
so the transition is proved by database evidence rather than by the wrapper's
report alone. No wrapper verification error occurred.

## 6. Residual risks and notes

- The wrapper's post-check ran inside the same host process as the request; the
  independent read-only queries above are the authoritative evidence.
- The deployed application's idle pool means `other_sessions` can never be
  measured as 0 without quiescence; the reviewed procedure stops the app first,
  and the zero-session proof was taken while it was stopped.
- The reconciliation clears the fence state only; it does **not** authorize a
  new bootstrap. A new G5-A attempt requires a fresh, explicit Owner
  authorization bound to the deployed source commit `d6f8aec…`.
- No live handshake has ever completed: the phone-side outcome of any bootstrap
  remains UNPROVEN.

## 7. Verdict

The single authorized epoch 9 → 10 reconciliation executed once inside the
window, through the reviewed admin API, with preflight and independent
post-verification passing. State is `idle` at epoch 10, gap 10,
`reconciliation_required=false`, fencing and audit history preserved, zero
sessions and zero unresolved work, and no provider contact.

**`G5A_RECONCILIATION_PASS_AWAITING_BOOTSTRAP_DECISION`**
