# Readiness and evidence

**NOT PRODUCTION-READY.** No production deployment, real Zalo account, customer data or public application endpoint has been used. GitHub repository is public; only original application code and summarized research, never runtime secrets or unlicensed candidate snapshots, are committed.

| Gate | Current evidence |
|---|---|
| Architecture independent review | Completed; original control-plane tradeoff recorded |
| Initial code security review | Completed; identified audit privilege bypass, authorization race and lost-response idempotency defects; remediation underway |
| Dependency install | Executed on Node 24.19.0; lockfile generated |
| Typecheck | Passed once after fixing QA fixture typing; final rerun required after remediation |
| Real PostgreSQL API/worker tests | Latest completed local run: 20/20 backend+offline transport assertions passed; new security/batch regressions await CI |
| Four independent Chromium users | Previous local run: 3 browser/security tests passed, 1 explicit skip; 4 distinct Chromium users; pagination changes require rerun; no physical workstation proof |
| Load 4/10/25/50 | Harness written, runtime pending; no capacity claim |
| Encrypted backup and fresh restore | Executed locally: encrypted archive, counts/content fingerprints match, sessions0, dispatchable0, attachment1, runtime CONNECT false |
| Dependency advisory audit | Vulnerable @fastify/static removed; completed local npm audit reported 0 vulnerabilities; CI rechecks lockfile |
| Container/CI | Authored; build/run and remote pipeline evidence pending |
| Live personal Zalo transport | Offline injectable candidate + encrypted vault: 12 tests passed. NOT wired into app/worker; no SDK/authentication executed. Integration and approved test account remain required |
| Phone coexistence/media/invalidation/reconnect soak | UNPROVEN, requires approved account owner/phone/test peer |
| Production approval | Not granted and not requested yet |

Tracking: [implementation #1](https://github.com/kha997/zalo-shared/issues/1), [live readiness #2](https://github.com/kha997/zalo-shared/issues/2).

No gate is satisfied by a comment, schema, mock assertion or test file alone. Runtime evidence records command/version/source/workload and observed outcome. Development branch and PR are reviewable artifacts, not production deployment.

Execution note: new local commands requiring additional network permission stalled before execution and were aborted, producing no test evidence. Connected GitHub source operations remain available. CI is being used for repeatable PG/browser/load/container evidence; no CI pass is claimed before reading its results.
