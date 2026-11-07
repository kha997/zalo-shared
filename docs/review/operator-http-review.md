# Authenticated operator HTTP independent review

Verdict: **the reported P2 cursor defect is corrected; no remaining scoped P0/P1/P2 identified**. Accepted conditionally on hosted PostgreSQL/HTTP/concurrency and integrated browser evidence. This is not actual provider delivery, external fencing or production acceptance.

## Scope and method

Reviewed `server/connector-operations-http.ts`, its registration/public-provider delta in `server/app.ts`, `tests/backend/connector-operations-http.test.ts`, current client contracts, the service implementation and its independent review. Inspected existing authentication, Origin/CSRF, transaction/current-role and error-handler boundaries. No product edits, database attempts, network/SDK/account actions or commits were performed. Only this report was authored.

## P2 corrected — year zero cursor reaches an unsupported SQL date

The initial cursor refinement accepted `0000-01-01T00:00:00.000000Z` because JavaScript supports ISO astronomical year zero. An executed offline probe returned the accepted cursor object. Routes subsequently cast the cursor time to PostgreSQL `timestamptz`, whose AD/BC calendar has no year zero; the expected consequence was a SQL error/generic500 instead of rejecting the invalid cursor with400. The SQL consequence was source-derived, not executed PostgreSQL evidence.

The implementer added a failing year-zero regression, then a year>=1 check before JavaScript date normalization. Independently reran the cursor test: **1/1 PASS**, exit0. Re-executed the original probe after correction:

```json
{"statusCode":400,"message":"Invalid cursor"}
```

The four-digit syntax already bounds the upper year. Calendar normalization, exact six-digit fractional cursor representation, canonical base64url/strict object shape, UUID and size checks remain intact.

## Assessment

- All detailed operator GETs and mutations use the existing authenticated transaction callback, which rechecks the active ACCOUNT session/staff under the staff-change lock and row SHARE locks before the route checks admin. Agents/supervisors cannot obtain owner identity, normalized evidence or unknown-job details. The public provider projection explicitly removes private owner/fault fields and returns safe aggregate availability information only.
- Existing preHandler Origin and CSRF checks protect mutations. POST bodies are strict and bounded, then delegate to the reviewed exact-ID/CAS services. No reset, resend, provider call, arbitrary native classification or live activation route is introduced. Fence acknowledgement delegates to the existing transaction/current-admin/lifetime-lock/owner-epoch service and returns a fixed409 on its safe state failure.
- Event/detail/unknown queries filter ACCOUNT before exposing data. Variant detail is reached only after validating the scoped parent event, and is bounded to8. Event/unknown pages use descending timestamp+UUID keysets, exact microsecond cursor strings and limit1..50; unknown-job part projections are bounded to6 and contain identifiers/status, no attachment bytes or locators. A concurrent event change can make a read snapshot stale, but reviewed mutation CAS/version checks reject that stale action.
- Existing401/403 exceptions from authentication/current-role checks are not wrapped by the service/fence catch. Zod errors remain400, operation errors carry fixed400/403/409 messages, and unexpected SQL errors use the existing generic500 handler. No raw SQL, SDK object, cookies or media locator is returned by these routes.
- Mode/status stays honest while disabled. Gap acknowledgement keeps status disconnected; aggregate/overview fields do not assert history completeness or a live phone/provider connection.

## Executed and pending evidence

Independent `npm run typecheck` exited0. The selected cursor test passed before the defect was found, demonstrating its original coverage gap; the expanded test and standalone year-zero probe passed after correction. Scoped diff checking passed. No unchanged full-suite rerun or configured PostgreSQL attempt was made.

The authored SQL/HTTP cases remain **UNPROVEN locally**: agent/supervisor denials, CSRF/Origin, scoped keyset pages/details, exact-ID confirmation and actor/audit preservation, conflict/gap/fence paths, cross-account isolation, revoked sessions, and an explicit paused-authentication barrier proving an in-flight admin demotion is rechecked for both detailed reads and mutations. Hosted CI must execute these with the reviewed services, restart/restore checks, client contract cases and the independent four-staff integrated browser flow before acceptance. Browser-mocked UI cases alone do not prove server authorization or SQL behavior. No real Zalo/phone claim follows from this review.
