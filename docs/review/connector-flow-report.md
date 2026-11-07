# Injected connector flow verification

Added `tests/backend/connector-flow.test.ts`. This is a simulation using a fresh SDK-shaped EventEmitter API, not actual SDK import, login, account authentication, Zalo network traffic, or phone operation. Production application configuration remains disabled with mock controls unavailable. No production files are changed by this test contribution.

The test uses an isolated PostgreSQL schema and a listening Fastify application on an ephemeral loopback port. Four independent HTTP clients authenticate with distinct admin-created agent accounts. Requests carry session cookies, Origin and CSRF tokens; negative Origin and CSRF requests must return 403. An administrator assigns four transport-created, SDK-mapped conversations to those accounts.

Each peer deliberately uses the same inbound provider ID. Concurrent retries reuse one idempotency key per staff send. Assertions require four inbound messages, four outbox jobs, four intentional SDK-shaped calls and exactly four attributed outbound app messages. The fake API emits self echoes before returning the exact matching provider ID, awaiting transport drain to prove durable held ingestion before acknowledgement. Assertions require reconciliation to link all four events and retain each staff actor ID. A synthetic native-phone self event after queue completion must have a null actor.

A synthetic close code 3000 invalidates the transport. The injected fault callback persists disconnected/reconciliation_required state; an explicit promise barrier waits for that persistence. The application must still accept an enqueue, while the real worker/provider and direct transport send remain blocked. No wall-clock sleeps are used. No credentials, SDK sessions, cookies or raw provider errors are logged by the test; Fastify's existing test application has logging disabled.

## Evidence and limits

- `npm run typecheck`: PASS after narrowing the transport normalizer's numeric thread type at the ingestion boundary.
- Single local invocation: `node --import tsx --test tests/backend/connector-flow.test.ts` with private `/tmp/zalo-dev.env` sourced without printing values: exit 1, generic file-level `test failed`, no diagnostic identifying a particular assertion. No escalation or repeated PostgreSQL attempt was made. Runtime assertions are **UNPROVEN** here; CI must execute this test against its disposable PostgreSQL database and resolve failures before claiming success. Local PostgreSQL/network restrictions were already known, but this output alone does not establish the failure cause.

This verifies four API client sessions only when execution passes. It supplies no evidence of four physical browsers, four workstations, real phones, actual SDK compatibility, delivery to Zalo, or production readiness. Existing browser tests are separate evidence and do not turn this simulation into physical workstation or phone proof. Fault persistence is supplied explicitly by this test's injection; it does not establish that a production connector host has been implemented or enabled.
