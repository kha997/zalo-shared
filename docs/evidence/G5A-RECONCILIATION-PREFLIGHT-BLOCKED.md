# G5-A — Controlled reconciliation preflight: BLOCKED

**Date:** 2026-11-04
**Authorization:** `G5A_RECONCILIATION_ONLY` — one audited reconciliation of the
failed G5-A bootstrap control state; no login, QR, provider communication,
observation, send, media, deployment or merge.
**Verdict:** **`G5A_RECONCILIATION_BLOCKED`** — precondition 8 (authorization,
admin authentication, CSRF protection, single-use request identity) cannot be
independently verified. The reviewed operation was **not invoked** against the
pilot database. The pilot rows are unchanged.

## 1. Why it is blocked

The reviewed path requires an authenticated active **admin**:

- `POST /api/provider/operations/reconcile` is wrapped in `secured(...)`
  (`server/connector-operations-http.ts:122-126`), which runs `admin(req)`
  (`server/app.ts:175-177`) inside a transaction. The global preHandler resolves
  a live staff session and requires the `x-csrf-token` header
  (`server/app.ts:145-170`).
- `reconcileUncertainOwnership` independently re-checks the actor inside the
  transaction: `authorize()` selects an `active` `role='admin'` user for the
  account (`server/connector-operations.ts:56-77`).

The dedicated pilot database contains **no users and no sessions**:

| Table | Rows |
| --- | --- |
| `users` | 0 |
| `sessions` | 0 |

There is only the `public` schema (17 tables) and only `public.users`; no hidden
staff table or account. No pilot-admin provisioning procedure exists in
`ops/` or `docs/`, and the only private `ADMIN_*` material on the host belongs
to the separate G3 environment, not the pilot database. Consequently:

- no admin can be authenticated;
- no CSRF token can be obtained;
- the request cannot be bound to an authenticated staff identity;
- the authorization token `G5A_RECONCILIATION_ONLY` names the operation but is
  not a substitute for authentication.

Creating an admin identity would itself be a control-state mutation and a new
credential, neither of which this authorization permits. The reviewed operation
was proven to fail closed in exactly this situation: with the exact pilot rows
and no admin, it returns **403** and writes nothing (§5, case A).

**Owner decision required:** either authorize provisioning of a dedicated pilot
admin identity (with a credential delivered out of band) or supply an existing
authenticated admin session for the pilot environment, then issue a fresh
preflight/execution instruction. Do not reset either control row manually.

## 2. Reviewed identity

- Branch `feat/shared-inbox`, working tree clean, `HEAD`
  `dedcf6e854e351febfa9f8c60356e30613982b09`.
- Reviewed blobs at that commit:

| File | Blob |
| --- | --- |
| `server/connector-operations.ts` | `01e249aad193cf2509851af3fac8a080fa946f1a` |
| `server/connector-operations-http.ts` | `a2cd0b7157bdc724167a10920fe18185464c69a8` |
| `server/app.ts` | `8646de43aceb6799fe01174ad153b4d15f74a2c0` |
| `server/db.ts` | `cb44d29cbfd8e2e9b2a598213c23fedd510436e0` |
| `server/provider-schema.ts` | `0dcdc44f0f768d24daa02a0a4c98ee7abe3e3463` |
| `ops/local/migrate-pilot-db.sh` | `041403c81e1288075f0b4dafbaa65790f93bfb43` |

- **Migration identity.** A fresh schema was built with the reviewed
  `migrate()` at this commit on the disposable database and compared
  component-by-component (columns, constraints, indexes, triggers) with the live
  pilot schema. They are identical except for one object: the
  `pilot_budget_monotonic` trigger on `pilot_send_budget`. That trigger is the
  reviewed pilot hardening in `ops/local/migrate-pilot-db.sh:60-68`; its live
  function body matches the reviewed text exactly, and the runtime-role revokes
  it applies are present:

  | Runtime check (`zs_app`) | Result |
  | --- | --- |
  | `SELECT` on `messages` | true |
  | `UPDATE` on `audit` | false |
  | `DELETE` on `connector_ownership` / `provider_state` / `pilot_send_budget` / `pilot_part_ledger` | false |
  | `UPDATE` on `pilot_part_ledger` | false |
  | `CREATE` in `public` | false |

  The live schema is therefore the reviewed schema, not drift.

## 3. The ten preconditions

| # | Precondition | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Exact reviewed code and migration identity | **PASS** | §2; fingerprint comparison |
| 2 | Dedicated pilot host and database | **PASS** | `pilot-postgres` is the only member of the internal `zalo-shared-pilot-db` network; TLS `verify-full`; no published port; the G2 app uses its own `postgres` host on separate networks; the host-local 5432 listener is an unrelated container |
| 3 | No connector, SDK or provider worker active | **PASS** | no `pilot-connector`, no bootstrap container, no host connector/SDK process; `pilot-egress` and `pilot-uplink` have no members; zero advisory locks; zero other database sessions |
| 4 | Expected ownership, owner, phase, gap, provider state | **PASS** | `uncertain`, owner `d4729725-5302-42d6-a4ee-ff55971fbdbb`, epoch `1`, fault `shutdown`; `disconnected`, `reconciliation_required=true`, gap `1`, provider fault `shutdown` |
| 5 | Private filesystem: no session, quarantine or unresolved material | **PASS** | only `pilot/session.key` (key material, expected); `pilot/state/view/` empty; no `session.enc` or quarantine artifact anywhere under the private tree or repository |
| 6 | No unresolved outbox, message, part, media or provider work | **PASS** | all four reviewed blocking predicates return 0; `outbox`, `messages`, `delivery_parts`, `provider_events`, `provider_media_jobs`, ledgers, budget, attachments and conversations are all empty |
| 7 | Provider session logged out; no newer conflicting evidence | **PASS (Owner evidence)** | device history records login/logout at 07:56 local (00:56Z); local audit `connector.uncertain` at 00:56:01.67Z, bootstrap status end 00:56:02Z/exit 1; the last gateway event is a single `sni_allow id.zalo.me` at 00:54:32Z and **nothing after it**; no session file and no connector. The device history is the Owner-supplied evidence the authorization directs us to use |
| 8 | Authorization, admin authentication, CSRF, single-use request identity | **BLOCKED** | token present, but `users=0`, `sessions=0`; reviewed path returns 403; no admin identity can be authenticated and no CSRF token can be obtained (§1) |
| 9 | Expected advisory locks and transaction boundaries | **PASS (observable)** | zero advisory locks, no other sessions; rehearsal exercised the exact reviewed transaction: shared `72001`, worker `73001`, connector `73002(,1)`, `FOR UPDATE OF o,s`, conditional updates and audit. The HTTP transaction wrapper cannot be exercised because of #8 |
| 10 | Non-mutating rehearsal of the complete precondition checks | **PASS** | exact pilot rows replayed on a disposable schema; see §5 |

## 4. Baseline and final state of the pilot

| Field | Before preflight | After preflight |
| --- | --- | --- |
| `connector_ownership.phase` | `uncertain` | `uncertain` |
| `owner_id` | `d4729725-5302-42d6-a4ee-ff55971fbdbb` | unchanged |
| `epoch` | `1` | `1` |
| fault | `shutdown` | `shutdown` |
| `provider_state.status` | `disconnected` | `disconnected` |
| `reconciliation_required` | `true` | `true` |
| `gap_version` | `1` | `1` |
| `audit` rows | 2 (`connector.reserved`, `connector.uncertain`) | 2 |
| `connector.reconciled` rows | 0 | 0 |
| delivery rows (all tables) | 0 | 0 |
| `users` / `sessions` | 0 / 0 | 0 / 0 |

No write transaction was opened against the pilot database. Every pilot query
ran with `default_transaction_read_only=on` inside `BEGIN READ ONLY`. The
rehearsal ran on the disposable test database only.

## 5. Rehearsal result (disposable database only)

A scratch schema was created on the disposable test database, migrated with the
reviewed `migrate()`, seeded with the **exact** pilot control rows, and driven
through `reconcileUncertainOwnership` with the exact incident identifiers. The
pilot budget hardening trigger is not involved: the operation never writes
`pilot_send_budget`.

- **Case A — exact pilot state, no admin identity:** the reviewed operation
  returned **403**, and the state, gap and audit table were unchanged. This
  reproduces the pilot blocker without touching the pilot.
- **Case B — same state plus a disposable admin:** the operation returned
  `{ epoch: "2", gapVersion: "2", alreadyApplied: false }`; the state became
  `idle`, owner `NULL`, epoch `2`, `reconciliation_required=false`, gap `2`, and
  exactly one `connector.reconciled` audit row carried the request identity,
  evidence reference and before/after values.
- **Replay of the same request:** returned `{ epoch: "2", gapVersion: "2",
  alreadyApplied: true }` with no second audit row.

The scratch schema was dropped; no disposable data remains. This is synthetic
evidence that the operation is sound and fail-closed. It is **not** evidence of
live execution, which did not occur.

## 6. Posture and non-actions

- The pilot database container was **started only for read-only inspection** and
  returned to `Exited (0)`. Its earlier restart attempt at 06:37Z had failed on
  a Docker Desktop bind-mount race; a plain start succeeded, all 17 tables and
  the exact control rows were intact, and no container was recreated, removed or
  re-initialised.
- The egress gateway remained **stopped**; `pilot-egress` and `pilot-uplink`
  had no members; no process held an address from the earlier provider
  connection.
- No connector, bootstrap, worker, SDK or app process was started against the
  pilot database.
- No Zalo network communication, no QR generation, no login, no observation, no
  send, no media action, no deployment and no PR merge.
- No direct SQL override, no delivery-state change, no budget reset, no release
  of unknown work, and no manual reset of either control row.
- No session, key rotation or quarantine artifact was created.

## 7. What is needed to proceed

1. **Owner decision (blocking):** authorize provisioning of a dedicated pilot
   admin identity, or provide an existing authenticated pilot admin session, so
   that admin authentication and CSRF can be independently verified. Provision
   the credential out of band; do not place it in the repository or evidence.
2. **Re-run this preflight** with the same ten checks. Checks 1–7, 9 and 10 are
   expected to remain PASS; check 8 must be exercised end to end before any
   mutation.
3. **Bind the request:** the execution instruction should name the incident
   (owner `d4729725-…`, epoch `1`, gap `1`) and the exact `requestId` /
   `evidenceRef` to record. The operation itself is unchanged and remains
   single-use and replay-safe.

Until then the control state stays `uncertain`/`reconciliation_required=true`.
G5-B is not authorized; no QR retry, login, observe, send or media action is
permitted.

## 8. Limitations and sanitisation

- Precondition 7 relies on the Owner-supplied device history; the provider
  session cannot be queried without network communication, which is prohibited.
- The HTTP route's full transaction path could not be exercised because the
  admin identity is missing; the underlying operation was exercised on the
  disposable database, and its transaction and lock mechanics were inspected.
- The rehearsal is synthetic. Passing it does not prove live execution or the
  provider's remote state.
- This record contains no passwords, cookies, session material, message content
  or external provider addresses.
