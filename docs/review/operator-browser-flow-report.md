# Integrated operator browser flow

Added `tests/e2e/connector-operations-flow.spec.ts`. It uses actual browser contexts, private HTTP routes and PostgreSQL with synthetic provider receipts. No SDK is imported or authenticated, no external provider request is made, and no real phone/customer/account data is used.

The test creates a new random `browser_<32 hex>` database only when TEST_DATABASE_URL names the explicitly disposable `zalo_test` database. Its own application listens on an ephemeral loopback port; its test-only Origin configuration is updated to that exact address. A separate database avoids PostgreSQL advisory-lock contention with the main CI mock worker, because those locks are database-wide even across schemas. Cleanup closes all browser contexts, application and own pool before dropping only the known-created database; it never overwrites, force-drops or changes an existing database. CI's disposable owner must have CREATE DATABASE permission.

Four distinct staff users log in through actual browser forms. Each must lack the admin recovery navigation and receive HTTP403 from protected recovery reads/mutations. A separate administrator uses the actual recovery form to confirm an unknown part against its held exact-ID receipt, with explicit evidence and acknowledgement. Assertions preserve the original staff actor, provider ID, one outbox intention and outbound message count, and require an administrator-attributed audit. No dispatcher/provider is configured, so recovery cannot send another message.

The administrator also reviews canonical/retained conflicting text through the real form. A newer durable fault is then inserted transactionally; an HTTP acknowledgement of the previous gap version must return409 and retain reconciliation_required. An ordinary staff inbox must label a synthetic native/shared-device message “Zalo / thiết bị khác”. These receipts simulate provider observations and do not establish phone coexistence or external evidence truth.

## Evidence and limits

- `npm run typecheck`: PASS after the final dedicated-database helper.
- `npx playwright test tests/e2e/connector-operations-flow.spec.ts --list --reporter=list`: PASS, one case discovered. The list-only invocation does **not** execute browser/SQL assertions and does not overwrite retained browser JSON evidence.
- Focused Prettier formatting completed successfully.
- Browser/HTTP/SQL execution is **UNPROVEN** until hosted CI. No repeated local PostgreSQL or loopback-listen attempt was made after the already established EPERM restriction.

Authenticated recovery routes are being completed independently. This test must execute against their final implementation and the freshly built client before acceptance. Four headless browser contexts are not four physical workstations; actual Zalo delivery, phone coexistence and production readiness remain separate gates.
