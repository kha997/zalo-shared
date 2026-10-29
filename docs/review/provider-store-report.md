# Durable provider store Task1

Implemented independent provider-schema DDL imported by db migration; bounded provider-store journal acceptance; account/thread/direction identity and semantic conflict handling; conversation-row serialization; exact accepted-part echo matching, ambiguous processing/unknown holds, and native outbound projection with NULL actor. recordPartAccepted and reconcileSelfEvents require an existing transaction. Mapping conflicts reject overwrites and aliasing; app echo reconciliation preserves staff actors. No worker/application/adapter files changed by this task.

Backup coverage adds provider_events to explicit counts and row fingerprints and asserts restored journal count. ops/counts.sql was explicitly authorized by parent as necessary coverage beyond the original file ownership list. Existing runtime audit grants/revokes and restore quarantine remain intact.

## Verification

- RED: before implementation, provider-store.test.ts failed with ERR_MODULE_NOT_FOUND for server/provider-store.js (expected missing feature).
- GREEN locally: validation/export test passes; initial TypeScript noEmit passed; latest recheck is blocked by concurrently added transport-ingress.test.ts references to transport.drain (lines 89,101,105,120,124), which parent owns; backup drill shell syntax passes.
- PostgreSQL UNPROVEN: disposable PostgreSQL connection is blocked by sandbox EPERM at 127.0.0.1:55432. No permission escalation, real SDK login, account/customer data, or external network used.
- Full npm test run: 57 tests, 37 passed, 20 failed; all failures below are PostgreSQL connection EPERM. Hosted CI must execute PG regressions and backup drill before merge. Full output is local /tmp/provider-store-suite.log.

PG regression tests cover concurrent replay, changed semantic conflict/audit once, thread-type/direction isolation, migration durability, early/late self echo, native phone attribution, staff preservation, rollback, unknown holds and mapping conflicts. Additional review should exercise hosted migration/runtime-role/backup restoration against actual PostgreSQL; none is claimed passing locally.

## Full-suite failures

- transactional authenticated inbox and durable dispatch
- ambiguous delivery is quarantined without automatic retry
- audit prohibits update, delete and truncate even for ordinary owner SQL
- conversation keyset pages expose older contacts without a silent result cap
- journal serializes replay, scopes identities, flags conflict and survives migration
- early echoes reconcile exact parts, preserve staff and release native phone messages after completion
- unknown attempts keep echoes held; mappings and explicit transaction requirements are enforced
- pending uploads have a concurrency-safe per-user quota
- protected metrics include request duration and pending age without personal labels
- advertised maximum attachment passes the full authenticated upload and private download routes
- in-flight send revalidates a session revoked after its initial authentication
- last active administrator cannot be disabled or demoted
- administrator mock mutations return 404 when mock is disabled
- lost-response retry survives admin reassignment but a new send is forbidden
- lost-response retry survives supervisor reassignment but a new send is forbidden
- concurrent agent claims have one winner and one version conflict
- foreign-account conversations and attachments are hidden with 404
- message pagination preserves all 100 microsecond timestamps within one millisecond
- worker drains a connected backlog without sleeping between every accepted job
- SIGKILL after provider acceptance quarantines interrupted dispatch without resend

## Review correction ruling and verification

Parent authorized ops/ci-provider-journal.ts as a necessary scope extension to seed the disposable hosted CI database after load/browser workers stop and before unclean restart/backup. Requires CI_PROVIDER_JOURNAL_DISPOSABLE=yes, PROVIDER_MODE=mock, and DATABASE_URL with database name zalo_test; imports only PostgreSQL/store code. No SDK or provider login. It persists linked inbound and exact staff echo records, a held self record backed by an unknown outbox, and a conflicting record. Backup drill requires each state and staff linkage, a nonempty digest, and identical complete provider journal row content after restore. Existing quarantine/audit checks remain.

Review fixes reassert provider quarantine on every unresolved conflict receipt, including a replay of the original semantic version, while auditing only the first conflict. Projection refreshes updated_at without changing assignment version; inbound messages use received and native outbound messages use sent.

New regression tests were written before corrections, then attempted: both were blocked at PostgreSQL connect EPERM, so behavioral RED/GREEN remains UNPROVEN rather than claimed. Latest tsc --noEmit passed. Fixture guard rejects missing disposable/mock opt-in before database access; backup-drill bash syntax passed. Hosted CI remains required for fixture, replay, SQL, unclean restart and restore verification. No actual database or SDK data used locally.

Latest full suite after review corrections: 70 tests, 47 passed, 23 failed, each failure connect EPERM 127.0.0.1:55432. Prior failure list applies, plus `late self echo matches accepted part while native projection cannot be reassigned`, `known conflict replay restores quarantine without duplicating its audit`, and `message activity preserves assignment version and direction status contract`. Output: /tmp/provider-store-review-suite.log.
