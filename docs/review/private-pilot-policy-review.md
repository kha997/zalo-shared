# Private pilot policy, budget and UID boundary — independent review and dispositions

Reviewed: 2026-11-02. Baseline `c1289331493f7bde3439a902f337a18a526eaadd` plus the uncommitted pilot-policy/budget/identity delta. This is an engineering review of synthetic/offline code. No live account, QR interaction, provider network request or production deployment was used.

## Scope

`server/pilot-policy.ts`, `server/pilot-budget.ts`, `adapters/zalo/sdk-facade.ts`, `server/provider-schema.ts` pilot tables, the `ops/` count/integrity/journal/drill fixtures, and the three new test files. The reviewer checked consent/grant bounds, durable budget semantics, UID binding, transaction requirements, input validation and test claims against `docs/plans/private-pilot-activation.md` Tasks 1–2.

## Findings and dispositions

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| F1 | P1 | A consent with `expectedAccountId: null` could admit an `observe`/`send-test` grant bound to any non-null UID, because the equality check was skipped and only the grant was required to be non-null. This exceeded the Owner-agreed account. | **Fixed.** Consent with a null account may list only `enroll-session`; ordinary purposes require a non-null consent account and an exactly matching grant account. Enrollment may still bind a previously unknown UID under an enrollment-only consent. Regression tests cover null consent plus send/observe and mixed-purpose consent. |
| F2 | P2 | A repeat `(message_id,part)` returned success indistinguishably from a fresh reservation, so a dispatcher calling reservation before each attempt could re-send after accepted or ambiguous work. | **Fixed source-side.** Reservation returns `{status:"reserved"}` or `{status:"already-reserved"}`. A repeat requires the same account/peer and a still-`pending` part; `sent`, `processing` and other post-dispatch states reject. **Task 4 gate:** dispatch only on `"reserved"`; never auto-send on `"already-reserved"` without independent proof that no egress occurred. |
| F3 | P2 | The minimum interval read the per-day row, so a UTC-midnight rollover reset the floor and allowed a sub-second burst. | **Fixed.** The interval now reads `max(last_reserved_at)` across all days for the account inside the same advisory-locked transaction. A rollover regression test proves an immediate next-day part is rejected until the global interval elapses. |
| F4 | P2 | `expectedAccountId` is optional, so a future pilot host could omit it and still persist cookies and receive a send-capable API. | **Fixed at the host boundary.** `createBoundSdkFacade` requires the ID at the type boundary and rejects its absence or malformation at runtime before any store read/import. The optional facade remains only for existing offline fakes and enrollment discovery. **Task 4 gate:** the pilot host must use the bound entrypoint. |
| F5 | P3 | A session-level `SET zalo.pilot_budget_transaction='active'` could spoof the caller-transaction marker outside `BEGIN`, losing the xact-scoped lock and interval serialization. | **Fixed.** The marker was replaced with `pg_current_xact_id()` plus `pg_stat_activity.backend_xid` verification; an implicit statement's xid disappears before the check. A session-GUC spoof test now rejects. |
| F6 | P3 | The budget function trusted an unvalidated grant and re-read mutable grant/input fields across awaits. | **Hardened.** It revalidates consent ref, non-null expected account, a unique 1..4 peer list and scalar bounds, and snapshots all values before the first await. Build identity remains an admission-time check, not a reservation-time check. |
| F7 | P3 | Several tests asserted weaker properties than claimed: the copy test mutated an unrelated source object, null-consent grant cases were absent, and the start-blocking path was unasserted. | **Fixed.** The copy test mutates the actual validated source and the frozen result; null-consent ordinary grants are covered; a failed refresh asserts listener `start` throws and never reaches the SDK. The late-login test now proves UID is never read after timeout disposal. |
| F8 | P3 | Journal fixture inserts were not idempotent on re-run. | **Fixed.** Budget and ledger fixture inserts use `ON CONFLICT DO NOTHING`. |
| F9 | P3 | The ledger-to-message foreign key lacked explicit delete behavior. | **Clarified.** `ON DELETE RESTRICT` preserves spend evidence; a future retention design must explicitly decide how to handle reservations rather than cascade-delete them. |

Categories otherwise clean: purpose, peers, budget, expiry, lifetime, clock skew and technical refresh remain bounded by consent; no budget reset, double-spend or unparameterized SQL path was found; numeric strings, prototypes and extra keys are rejected.

## Verification performed

- `npm run typecheck`: PASS.
- `tests/backend/pilot-policy.test.ts`: 8/8 PASS.
- `tests/backend/pilot-budget.test.ts` against disposable PostgreSQL: 8/8 PASS, including idempotent repeat status, simultaneous staff reservations, quota durability, day/grant boundaries, global interval rollover, post-dispatch repeat rejection, malformed/foreign/group/inbound/sent parts, transaction requirement and session-GUC spoof.
- `tests/transport/pilot-identity.test.ts`: 8/8 PASS, including matching UID, wrong/missing/coerced/thrown UID, malformed expected IDs before I/O, changed UID on refresh and fresh generation, backward-compatible unbound fakes, bound entrypoint refusal and late-login disposal.
- Full local suite and hosted PostgreSQL CI for this delta: recorded in `docs/READINESS.md`.

## PASS / FAIL / UNPROVEN

| Claim | Status |
|---|---|
| Grant/consent scope, account binding, peers, purposes, budget, interval, expiry and refresh | PASS locally; hosted pending |
| Durable per-day budget, global interval, idempotent repeat status and no reset across day/grant | PASS locally; hosted pending |
| UID mismatch blocks persistence/API/listener/send and leaks nothing | PASS locally; hosted pending |
| Pilot host uses the bound facade and dispatches only on `reserved` | UNPROVEN — Task 4 integration gate |
| QR enrollment, private identity confirmation and pilot runtime/image | NOT IMPLEMENTED |
| Live provider behavior, phone coexistence, account-ban risk | UNPROVEN |
| Production readiness | NOT ESTABLISHED |
