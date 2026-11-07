# QA implementation report

Prepared test harnesses; execution evidence is pending integration startup. No passing result or capacity claim is made by this report yet.

- `tests/e2e/inbox.spec.ts`: actual Chromium UI login, claim and send in four isolated contexts; agent admin denial, unauthenticated API denial, literal HTML rendering; synthetic screenshots only.
- `tests/load/run.ts`: loopback-only 4/10/25/50 named concurrent users, separate sessions and assigned conversations, measured login/inbox/send/retry/timeline requests. Runtime credentials are generated; administrator credentials come from environment and are never recorded.
- `tests/e2e/security.spec.ts`: adversarial HTTP checks for Origin/CSRF, disabled-session revocation, anonymous reads, malformed attachment rejection, concurrent claim winner, simultaneous duplicate send, payload mismatch and unassigned sender rejection. Last-admin removal and mock-disabled checks are explicitly skipped here because they need isolated server configuration; backend integration evidence is required for those gates.
- Run `npm run test:e2e` and `npm run test:load` with TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD and optional TEST_BASE_URL. App, PostgreSQL and simulator worker must already be running.

Artifacts: `docs/evidence/qa-browser.json`, `qa-browser-context-1.png` through `-4.png`, `qa-load.json`. Load setup time is excluded; measured duration covers simultaneous named users performing sequential operations. Percentiles describe HTTP request durations including login hashing. Errors fail the process; retries must match IDs and a single persisted message.

Four browser contexts are not four physical workstations. HTTP simulator load does not establish real Zalo throughput, physical workstation behavior, production capacity, reconnect/failover safety, or horizontal scaling. Crash/restart, restore and live-provider gates require separate evidence.
