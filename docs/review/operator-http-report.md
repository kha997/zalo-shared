# Authenticated connector operation routes

Implemented Task3 HTTP registration in `server/connector-operations-http.ts` with a small integration delta in `server/app.ts`. No new listener, provider login, SDK call, URL retrieval, production action or configuration switch was added.

## Boundaries and contracts

- `/api/provider` retains existing disabled/mock mode semantics and adds reconciliation, decimal gap version, aggregate held/conflict/unknown counts and ownership phase. Owner identity and fault details are removed from the ordinary-staff response.
- Detailed overview, held/conflict keyset lists, selected canonical/variant detail and unknown job/part lists run through the existing authenticated transaction helper and recheck current admin inside the transaction. Event IDs/queries are ACCOUNT scoped; variants are selected only after their scoped parent. Lists cap at50 (default25), parts at6 and retained variants at8. Keyset cursors preserve PostgreSQL microseconds and reject malformed/base64/calendar ambiguities before SQL.
- Strict bounded POST bodies call the reviewed confirmation/conflict/gap services and existing external-fence service. Existing exact Origin/CSRF/session rechecks remain active. No resend/reset endpoint exists. Services retain fixed safe errors; fencing errors map to a fixed409. SQL errors retain the global generic500 boundary.
- UI JSON contracts match `client/src/api.ts`. Gap acknowledgement keeps provider disconnected; disabled provider is never reported connected. The API records administrator attestation rather than independently proving provider history or external egress fencing.

## Evidence and limits

Tests were authored before route implementation. Initial real-SQL test invocation failed during setup because TEST_DATABASE_URL was absent, before any behavior assertion; this is not a demonstrated behavioral RED. No repeated configured PostgreSQL attempt or permission escalation was made because local EPERM was already established.

`tests/backend/connector-operations-http.test.ts` contains two hosted SQL/API scenarios: role restrictions; private aggregate output; strict limits/cursors; exact held event paging; CSRF/Origin failure; exact-ID partial service confirmation with preserved staff actor, single audit and no mock provider ledger write; repeated stale mutation409; positive conflict/gap/fence routes; cross-account event/detail/unknown exclusion; deleted session401. A separately intercepted initial-authentication race demotes the administrator under the staff-change lock before privileged read/mutation transactions; both must deny403 and produce no gap audit.

Local pure cursor boundary case **1/1 PASS**, TypeScript **PASS**, diff check **PASS**. This covers malformed cursor, calendar normalization, UUID shape and microsecond retention, not SQL execution. Real SQL/HTTP/race assertions remain **UNPROVEN** pending hosted CI. No actual Zalo, phone operation, real provider acceptance or production readiness is established. Existing four-staff connector/media tests are separate evidence; these HTTP tests focus on operator authorization/recovery.

## Independent cursor correction

Reviewer identified P2: JavaScript accepts ISO year0000 but PostgreSQL timestamptz rejects year0. The new year0000 cursor regression first failed with a missing expected exception. Cursor validation now requires year>=0001 before SQL, retaining existing exact UTC calendar/microsecond checks. The focused boundary regression passes after correction; hosted SQL/HTTP claims remain pending.
