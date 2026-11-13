# Operator UI implementation report

Implemented the client portion of Task3 in `docs/plans/connector-operations.md`. No HTTP routes, SQL reconciliation, production configuration, account login, network/CDN operation or deployment is added by this contribution.

## Client contract and behavior

- `client/src/api.ts` exports the agreed operations overview, event summary/detail, unknown-job and keyset page types. The overview includes a separate mode, connection, ownership and gap snapshot. Public provider additions are optional for compatibility until HTTP integration.
- The parent mounts “Đối soát Zalo” only for the current admin role and unmounts it on observed demotion. The component keeps evidence in memory only, aborts pending reads on refresh/unmount and fences stale responses by request generation. A 403 clears privileged state. Server-side authorization/session/current-role checks remain mandatory; hiding the screen is not an authorization boundary.
- Lists hold one page of at most25 entries with explicit first/next navigation. Event detail and variants are bounded and response shapes are checked before actionable state is exposed. Provider locators/credentials/raw errors are not part of the contract.
- Exact-ID confirmation requires a held outbound nonconflicting event, a selected unknown part in the same conversation, a nonsecret evidence reference and explicit attestation. Accepted parts remain visible. Conflict resolution retains the canonical event and sends the exact sorted retained variant hash set, excluding the canonical hash. Overflow, missing legacy evidence and terminal versions disable actions.
- Separate gap/fence forms display exact snapshot identity/version and the limits of external attestation. There is no reset, resend, force-takeover or bulk action. A stale409 response clears the old selection/attestations and refreshes GET state; it never retries a mutation. Ambiguous transport failures ask the operator to inspect state/audit before another explicit action.
- Reconciliation suppresses the green connection indicator and success wording even if a socket reports connected. Ordinary staff see aggregate informational status only. Existing native actorNULL wording remains “Zalo / thiết bị khác”.

## Verification and limits

- `npm run typecheck`: PASS after implementation and final validation changes.
- `npm run build`: PASS for the implemented UI (32 client modules, full server compilation). Later changes were response-validation/copy and browser-test additions; coordinating final build remains required for the published snapshot.
- `playwright test tests/e2e/connector-operations-ui.spec.ts --list`: discovers2 cases. They use entirely synthetic browser-intercepted shell/operations responses, require explicit evidence, assert exact POST payload, escaped text,409 refresh without a resend and privileged-content unmount after role change.
- Browser execution was not established locally: the isolated Vite preview failed to bind `127.0.0.1:3410` with `listen EPERM`. No permission escalation or repeated bind attempt was made. The browser assertions are **UNPROVEN until hosted CI**, not passed by discovery/typecheck.
- `git diff --check`: PASS. No commit or publication performed.

HTTP contract/authorization, SQL races, four real authenticated staff recovery flow, accessibility rendering and complete integrated browser behavior require the backend integration and hosted CI. This report supplies no real Zalo, physical phone, external-fencing or production-readiness evidence.
