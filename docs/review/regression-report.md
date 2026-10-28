# Backend security regression coverage

Added `tests/backend/security.test.ts` with seven PostgreSQL-backed cases:

- Last active administrator disable and demotion return 409 and preserve the administrator/session.
- Authenticated administrator mock state/inbound mutations return 404 when mocks are disabled.
- Identical same-actor idempotent retries return the original message after reassignment by an administrator or supervisor; a fresh key returns 403. Exactly one message/outbox job remains.
- Concurrent claims produce exactly one successful assignment and one 409 version conflict, with the persisted winner/version checked.
- Foreign-account conversation read/update/read-cursor/send and linked attachment downloads return 404; the list excludes the conversation.
- Pagination visits all 100 messages inserted at distinct microsecond timestamps within one millisecond, without omissions, duplicates, or ordering changes.

Every case creates its own schema through `isolatedDatabase()` and drops that schema afterward. Credentials and contact identifiers are generated locally at runtime. No audit truncation, real accounts, provider network calls, or public endpoints are involved.

Runtime status: NOT EXECUTED. The requested local PostgreSQL command stalled at the additional-network permission boundary before execution and was aborted; it produced no test results. No failing/passing PostgreSQL assertions are claimed. The pagination case targets the observed cursor conversion through JavaScript Date (which loses microseconds); its red result still requires execution. Root will execute the suite in authorized CI.

Static validation: `npx tsc --noEmit` completed successfully (exit 0) after the test file was written. This does not substitute for PostgreSQL execution.
