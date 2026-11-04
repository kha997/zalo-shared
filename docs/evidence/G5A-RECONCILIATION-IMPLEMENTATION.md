# G5-A — Reconciliation implementation

**Date:** 2026-11-04
**Authorization:** `RECONCILIATION IMPLEMENTATION APPROVED` — implementation and
offline verification only
**Status:** implemented and offline-verified. **Not executed against the pilot
database. `connector_ownership` remains `uncertain` and `provider_state` remains
`reconciliation_required=true`.** No live provider contact, no QR, no session,
no observe/send, no deployment, no PR merge.

## 1. What this operation is for

The 2026-11-04 bootstrap left the fail-closed shutdown result in place:
`connector_ownership.phase='uncertain'` (owner fenced, fault `shutdown`) and
`provider_state.reconciliation_required=true`, `status='disconnected'`. No
reviewed path could clear that state, which is why every later G5-A preflight
refuses.

`reconcileUncertainOwnership` is a single-use, audited transition from that
exact fenced state back to `idle`, with both control rows moved consistently and
without touching delivery state. It is deliberately narrower than "reset the
flags": it requires the caller to name the incident it is closing (owner,
epoch, gap version, evidence), proves no connector is live, proves no unresolved
work exists, and refuses everything else.

## 2. State model it reads

| Row | Fields used |
| --- | --- |
| `connector_ownership` | `phase ∈ {idle,reserved,active,uncertain}`, `owner_id`, `owner_label`, `epoch bigint`, `uncertain_at`, `fault_code`, `last_fenced_owner_id/epoch/at` |
| `provider_state` | `status`, `reconciliation_required`, `fault_code`, `gap_version bigint` |
| `provider_events` | `state='held'`, `variant_overflow`, `variant_evidence_missing`, unresolved `conflict` |
| `provider_media_jobs` | `status ∈ {held,pending,processing}` |
| `outbox` / `messages` | `pending`, `processing`, `unknown` |
| `delivery_parts` | `pending`, `processing`, `unknown` |
| `audit` | append-only; `connector.reconciled` rows and their `metadata` |

`gap_version` is monotonic. The new value is always `old + 1`, computed by
`nextGapVersionSql` from `server/provider-faults.ts`, and the operation refuses
to run at the terminal `MAX_GAP_VERSION`. A gap is never reset to zero.

## 3. Operation contract

- **Entry point:** `reconcileUncertainOwnership(db, actor, input)` in
  `server/connector-operations.ts` (line 401).
- **HTTP route:** `POST /api/provider/operations/reconcile` in
  `server/connector-operations-http.ts` (line 332), inside the authenticated
  admin scope. The existing session check requires an active admin, the CSRF
  token on non-GET requests, and the shared staff-change advisory lock.
- **Request (strict; unknown keys are a 400):**

  ```json
  {
    "requestId": "<uuid>",
    "expectedOwnerId": "<uuid of the fenced owner>",
    "expectedOwnerEpoch": "<decimal string>",
    "expectedGapVersion": "<decimal string>",
    "evidenceRef": "<bounded reference, e.g. Owner message id>",
    "confirmOwnerApproved": true,
    "localState": { "sessionFile": "absent", "quarantine": "absent" }
  }
  ```

- **Response:** `{ ok: true, epoch, gapVersion, alreadyApplied }`.
- **Errors:** `400` malformed input; `403` not an active admin; `409` any
  precondition or lock mismatch. No other shape is returned.

## 4. The ten safeguards

| # | Safeguard | Implementation | Verified by |
| --- | --- | --- | --- |
| 1 | Exact expected ownership epoch and state | The read locks the ownership and provider rows; the fresh path requires `phase='uncertain'`, `owner_id=expectedOwnerId`, `epoch=expectedOwnerEpoch`, `reconciliation_required=true`, `status='disconnected'`, `gap_version=expectedGapVersion`. Every mismatch is `409` | `connector-reconciliation.test.ts` — epoch/owner/gap/phase/provider-status mismatch tests |
| 2 | No active connector or competing ownership | `workerLock` takes the worker try-lock `73001`; the operation takes the session try-lock `73002`, which the bootstrap holds for its entire life. A live connector or worker makes the call `409` | "a live connector or worker lock prevents recovery" |
| 3 | No valid local `session.enc` or unresolved session/quarantine material | `localState.sessionFile`/`quarantine` must be the literal `"absent"` and are recorded in the audit. On the database side, any held/unresolved provider event or media job blocks recovery. The filesystem itself is not readable from the DB transaction, so absence is an explicit, audited attestation — not an implicit assumption | "unresolved provider, media, outbox and part work blocks recovery"; malformed-input tests |
| 4 | No unreviewed provider activity | `provider_events` with `state='held'`, variant overflow/missing evidence, or unresolved conflict; `provider_media_jobs` held/pending/processing; both `409` | same test |
| 5 | No pending/unknown outbound that could become dispatchable | `outbox`/`messages`/`delivery_parts` in `pending`, `processing` or `unknown`; `409` | same test |
| 6 | Strict Owner authorization binding | Active admin session + CSRF + literal `confirmOwnerApproved: true` + a bounded `evidenceRef` that names the Owner authorization. The invocation is tied to one `requestId` in the audit. This is an authorization attestation, not a cryptographic signature; the pilot has one account and one Owner | HTTP tests — missing CSRF `403`, `confirmOwnerApproved:false` `400`; backend — non-admin and deactivated admin `403` |
| 7 | Transactional / failure atomic | The route runs inside the app's `transaction()` (`BEGIN`, advisory locks, fresh session re-read, `COMMIT`/`ROLLBACK`). `protect()` maps unexpected failures to `409`. Ownership and provider updates are separate conditional statements in that one transaction with a post-update consistency read | "the reconciliation route requires admin, CSRF and the exact fenced epoch"; happy path leaves both rows consistent |
| 8 | Audit without secrets | One append-only `connector.reconciled` row with `requestId`, `evidenceRef`, owner id, epoch before/after, gap before/after, prior fault codes and the two local-state attestations. No session, cookie, UID, QR or provider text | "reconciles one fenced incident exactly once"; metadata assertions |
| 9 | Idempotent duplicate handling | The operation looks up `connector.reconciled` by `metadata->>'requestId'`. A retry with the same request and evidence returns `alreadyApplied:true` **only** if the live state equals the state the first application produced; different evidence, a changed incident or a mismatched state is `409`. Nothing is written twice | replay/idempotency test: one audit row, `alreadyApplied:true`, different evidence `409`, same id on a new incident `409` |
| 10 | Fail-closed on any mismatch | Every precondition, lock, `rowCount` and post-check failure is `409`; the transaction rolls back | mismatch and terminal-version tests |

## 5. What it deliberately does not do

- It never writes `messages`, `outbox`, `delivery_parts`, provider events or
  media jobs. No message status is reset, replayed or resent.
- It does not delete or rewrite history: `audit` is append-only, and
  `last_fenced_owner_id/epoch/at` records the owner and epoch that were
  reconciled. `reserved_at` and `heartbeat_at` are left untouched.
- It does not reset `gap_version`; it increments it strictly (`<= MAX_GAP_VERSION`).
- It does not create a session, contact the provider, or start a connector.
- It does not accept a caller-supplied target state; the only reachable state is
  `idle` + `disconnected` with the computed epoch/gap.

## 6. Files

| File | Change |
| --- | --- |
| `server/connector-operations.ts` | `counter()` helper; `reconcileUncertainOwnership()` (from line 401) |
| `server/connector-operations-http.ts` | strict `reconcile` schema (line 288); `POST /api/provider/operations/reconcile` (line 332) |
| `tests/backend/connector-reconciliation.test.ts` | 8 tests, disposable database |
| `tests/backend/connector-operations-http.test.ts` | one appended end-to-end route test |

## 7. How the Owner would execute it later (not done here)

Execution against the pilot database is an **Owner execution decision** and is
not performed by this work. When authorized, the reviewed path is:

1. Run the G5-A preflight; capture `owner.phase='uncertain'`,
   `owner.ownerId`, `owner.epoch`, `provider_state.gap_version`.
2. Confirm on the host that `session.enc` and the quarantine material are absent
   (the request attests this).
3. `POST /api/provider/operations/reconcile` with the exact values and an
   `evidenceRef` naming the Owner authorization. `409` means the state moved;
   re-read, never retry blindly.
4. Verify the response and re-run the preflight: ownership `idle`, no
   reconciliation required, gap incremented by one.

The execution environment (which app instance points at the pilot database) is
part of the Owner execution gate; no deployment was performed.

## 8. Limitations and UNPROVEN items

- Not exercised against the pilot database; only a disposable database.
- `localState` is an attestation by the caller; the database cannot read the
  host filesystem. The audit records exactly what was attested.
- No operator UI; the operation is an API call.
- Owner authorization is session/literal/evidence based, not a signature.
- The terminal `MAX_GAP_VERSION` case is covered synthetically, not observed in
  production.

**STOP — `G5A_RECONCILIATION_IMPLEMENTED_AWAITING_OWNER_EXECUTION`. No
reconciliation was executed, no flag was cleared and no live action was taken.**