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

## In-flight revocation and process-crash regressions

Added `tests/backend/revocation-race.test.ts`: a bound-method Proxy around the real pool pauses the first authenticated initial session SELECT only after PostgreSQL returns it. An administrator disables the agent before that cached result is released. The original send must return 401 with zero message/outbox inserts, exercising transaction-time revalidation without production hooks.

Added `tests/backend/worker-crash.test.ts` and `tests/helpers/crash-worker.ts`: an isolated-schema child worker commits simulated provider acceptance in `provider_ledger`, signals its parent through IPC, then blocks. The parent sends actual SIGKILL, waits for process closure and PostgreSQL worker-lock release, and runs the normal provider twice. Assertions require unknown message/outbox/part states, exactly one provider acceptance, zero resend calls, and one recovery audit record with `reason: interrupted-dispatch`. The schema URL travels in environment only; child output is suppressed. Tests have 15-second test timeouts, a 5-second IPC deadline, kill/close cleanup, and a 3-second PostgreSQL lock-wait deadline. Worker tests share the application's global advisory lock, so CI should execute backend files serially to avoid unrelated test workers contending for that singleton.

Validation: `npx tsc --noEmit` passed after both additions. PostgreSQL/process regression execution is NOT RUN locally: network-granted execution remains blocked before command execution. These are source-level additions pending authorized CI evidence, not claims that runtime assertions passed. The provider acceptance is synthetic local PostgreSQL state; no real Zalo/provider network is involved.
