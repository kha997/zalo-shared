# Operator UI independent review

Verdict: **no P0/P1/P2 identified in the scoped client source; accepted conditionally on backend contract integration and hosted browser evidence**. This is not authorization, real-provider or production acceptance.

## Scope and method

Reviewed `client/src/ConnectorOperations.tsx`, App/api/styles delta, two browser-mocked cases and implementation report against Task3 of `docs/plans/connector-operations.md`. Read the existing shell identity polling/session-expiry behavior and the service input contract for integration consistency. No product edits, server bind, network, real account/SDK, database attempt or commit was performed. Only this report was authored.

## Assessment

- The parent renders the privileged component only for current admin role, keyed by staff identity, and unmounts on observed demotion. Existing shell polls current identity every2seconds; API401 expires the session. Component403 paths clear overview, lists, selected event/job and evidence attestations. Server current-role/session checks remain mandatory: browser visibility is not authorization and cannot recall information already viewed.
- Reads use abort controllers plus generation/alive checks. Refresh/pagination/filter changes clear privileged snapshots and proof before replacement; late detail results cannot replace a newer selection. Unmount aborts both outstanding request families. Mutation results after unmount/stale generation do not repopulate private content.
- At most25 list rows and8 variants enter actionable component state. UUID/version/hash and relevant shape checks precede enabling actions. Text is rendered through React text nodes, without raw HTML or external media locators. Unknown-part confirmation requires a held outbound nonconflicting event, unknown part, same conversation, exact event ID/version, explicit observation attestation and restricted evidence reference. It does not infer attribution from text/time.
- Conflict resolution posts the exact sorted retained differing hash set and retains canonical evidence. Legacy evidence-missing, overflow and terminal event versions disable action. Gap acknowledgement requires a matching displayed owner/version snapshot and zero blocking counts; server locking/CAS must independently enforce every prerequisite. Fence wording explicitly distinguishes administrator attestation from verified external firewall/process fencing. No force takeover, resend/reset or bulk mutation is present.
- A409 triggers GET refresh and clears old proof; it does not retry the POST. Ambiguous failures show an explicit inspect-state/audit warning rather than automatically repeating an operation. Reconciliation suppresses green connection/success wording. Native actorNULL copy remains honest. Focus moves to selected evidence heading; form controls have labels and loading/error/status semantics.

## Executed evidence and required gates

Independent `npm run typecheck` exited0. Scoped `git diff --check` exited0. The two synthetic browser cases assert explicit exact-ID payload/proof gating, escaping,409 refresh without resend, and privileged-content removal after shell role demotion. Their runtime assertions remain **UNPROVEN here**: local listenEPERM was already established and no repeat bind was attempted. Test discovery is not browser execution.

Hosted CI must run these browser contracts plus real authenticated HTTP role/CSRF/Origin/session-revocation checks, pagination/account boundaries and SQL reconciliation races. Full integrated source must preserve the agreed response field names/types and perform current admin checks inside mutation transactions. Neither mocked responses nor this review establish four real staff recovery flow, external fencing truth, phone coexistence or production readiness.

## Integrated four-browser flow follow-up

Bounded source review of `tests/e2e/connector-operations-flow.spec.ts` and `operator-browser-flow-report.md` found no additional P0/P1/P2. No browser, database or listener operation was attempted for this follow-up. Runtime acceptance remains conditional on hosted CI of the final routes and freshly built client.

The helper accepts only a PostgreSQL URL whose database basename is exactly `zalo_test`, constructs and validates a fresh random `browser_<32 hex>` identifier, and creates a new database without replacement. The created flag prevents dropping a database after failed creation; cleanup ends the application pool before dropping that exact known-created name, with no FORCE path. The owner connection stays on the original disposable database. Source URL credentials are neither printed nor returned. This relies on TEST_DATABASE_URL being a trusted disposable-CI resource and on CI owner CREATE DATABASE permission; the basename check alone is not general production-resource discovery.

The test starts a separate loopback-only ephemeral server and changes only its local configuration object's exact Origin after binding. Its database-wide advisory locks and queue state therefore do not interfere with the main load-test database. Four distinct browser sessions remain open while ordinary staff lack the recovery navigation and receive HTTP403 from recovery read/mutation paths. The administrator uses actual UI forms and private HTTP to confirm a held exact-ID receipt against a synthetic unknown staff intent, preserving actor/provider-ID, outbound message count, one outbox row and administrator audit attribution. No dispatcher or SDK is configured for that isolated app; it does not prove actual external sends.

The retained canonical/differing conflict bodies are reviewed through the actual form. After successful confirmation/resolution, a transactional newer provider fault makes an acknowledgement using the earlier gap snapshot return409 while quarantine remains set. The ordinary inbox assertion checks honest native actorNULL wording. These are synthetic provider receipts and fixture intentions, not observations from a real phone or evidence of four physical workstations. The report correctly labels discovery/typecheck separately from still-UNPROVEN browser/HTTP/SQL execution.
