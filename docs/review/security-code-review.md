# Static code review — actionable findings

Reviewed 2026-10-27: `server/`, `client/`, `ops/`, backend/browser/load tests. Static inspection only; no runtime, dependency, database or penetration-test result is claimed. Source was changing during review; references name functions/routes rather than unstable minified line numbers. Priorities describe remediation order for this synthetic pilot.

## P1 — Runtime database identity can erase the audit

`server/db.ts:migrate` creates an UPDATE/DELETE row trigger, but **TRUNCATE does not fire that trigger**. `tests/backend/core.test.ts` itself executes `TRUNCATE ... audit ...`, demonstrating the intended connection has that privilege. Migration and runtime both consume `DATABASE_URL`; there is no migration-owner/runtime-role setup or grants. An owner can also drop/disable the trigger. Thus append-only SQL protection is not implemented against the application's own DB credential.

Create distinct migration owner and non-owner runtime role; restrict runtime to needed table/sequence operations, revoke audit UPDATE/DELETE/TRUNCATE and schema/function/trigger DDL. Keep audit INSERT/SELECT only as required. Test denial using the actual runtime login, including TRUNCATE and ALTER TABLE DISABLE TRIGGER. Restore uses `--no-owner --no-acl`, so recreate/reapply and verify these grants after restore rather than assuming they survived.

## P1 — Lost-response retry stops being idempotent after reassignment

`server/app.ts:POST /api/conversations/:id/messages` locks the conversation and checks current assignee **before** looking up the same actor/request key. Reproduce: agent A successfully enqueues; response is lost; supervisor assigns B; A retries the original key/body. Server returns 403 instead of the original message. `client/src/App.tsx:performSend` treats every 4xx as definite rejection, allowing “edit content” and clearing the original key. This can mislead staff into composing a duplicate even though the original is queued or sent.

After authenticating current user/account, look up an existing actor-scoped key and verify its payload before enforcing authority for a **new** send. Return the original result without enqueueing again. Preserve original acceptance uncertainty in the client when a retry loses authorization. Add the exact response-loss/reassignment test, including attached messages whose uploads are already bound.

## P1 — Privilege revocation races with in-flight mutation

`server/app.ts:preHandler` reads role/session once using a separate pool query. Route handlers subsequently use cached `req.staff`; user disable/demotion deletes sessions in another transaction, but privileged mutations never revalidate/lock the actor in their transaction. A paused create-user/assignment/send request can commit after an administrator's revocation commits. Last-admin serialization protects the target count, not the actor's authority.

Recheck active actor/session/current required role inside mutation transactions with locking that serializes against role/revocation updates; define in-flight revocation semantics explicitly. Test with a barrier after authentication, revoke in another transaction, then release the mutation. Ordinary subsequent requests already recheck current membership and should remain covered separately.

## P2 — Worker recovery mutates delivery state without atomic audit

At the start of `server/worker.ts:runWorkerOnce`, interrupted work is quarantined through **three autocommitted UPDATEs**, with no `message.unknown` audit. A crash between statements leaves inconsistent message/outbox/part statuses until another worker iteration; a restart can change visible delivery outcome with no audit evidence. The ordinary catch path does write an audit transaction, so restart behavior differs.

Quarantine interrupted jobs and relevant parts/messages with an audit entry in one transaction. Add crash/restart assertions, not only a provider throwing an exception. Dedicated advisory locking does not fence a paused stale network sender; retain the documented live-provider blocker. Current mock provider writes acceptance via a different pooled connection, which is useful for fault injection but is not proof of external transport fencing.

## P2 — Attachment storage has no aggregate resource bound or cleanup

`POST /api/attachments` limits each upload to 5 MiB, but any authenticated user can repeatedly store unbound blobs. There is no per-user/account quota, route throttling, expiry or deletion. The 7 MiB request limit does not bound cumulative PostgreSQL storage or concurrent buffering. The UI also leaves uploads behind when a draft/file is removed or a multi-file upload partially fails.

Add bounded account/user pending-upload quotas and expiry/cleanup, with concurrency-safe quota enforcement. Test concurrent uploads at the quota boundary. Magic-prefix checks are a lightweight allowlist, not full image/PDF validation; downloads being attachment + nosniff is beneficial. The mock provider only receives message/part IDs and returns IDs; no test verifies that attachment bytes/name/mime are actually consumed or delivered. Attachment delivery remains a simulator limitation and needs explicit acceptance coverage.

## P2 — Restore quarantine is advisory; integrity verification is counts only

`ops/restore.sh` checks `RESTORE_QUARANTINE=yes`, but that is an operator assertion, not enforced exclusion of a running worker. Restored pending jobs become visible at `pg_restore` commit; count checks run **before** the separate quarantine transaction. An accidentally connected worker can dispatch during that interval. Restore also preserves existing `sent` jobs as sent even though a backup rollback can restore older pending work, making fail-closed startup essential.

Keep the target unreachable to app/worker roles until quarantine and grant verification finish, or restore into a database with connection privileges denied to runtime. Test an attempted concurrent worker connection. `counts.sql` proves row counts only; changed bytes/roles/audit with equal counts pass. Add content/media hashes, role/grant verification and a documented restore drill. Backup's `QUIESCED=yes` similarly needs an operational stop/check; separate dump/count queries otherwise need not share a snapshot.

## P2 — Missing acceptance cases conceal important gaps

- Backend tests omit guessed foreign-account message/attachment IDs, wrong Origin with valid CSRF, mismatched request payload/key, concurrent claim winner, retry after reassignment, role downgrade, idle/absolute expiry and runtime audit-denial checks.
- Browser test gives each user a different conversation; it proves neither a collision between four agents nor lost-response recovery. It verifies enqueue visibility, not worker-confirmed delivery or reconnect recovery.
- The application implements 2-second polling, not the proposed REST/SSE. This simplifies revocation (no persistent stream to terminate) but should be recorded as an explicit architectural change. Polling conversations performs two extra queries per row (`viewConversation`) and silently caps results at 500 without a continuation cursor. Test realistic dataset sizes, not only user count.
- Load runner is three default serial rounds per concurrently started user and records API latency only; it has no soak duration, resource/queue-age measurements or explicit latency/error acceptance threshold. Report its actual boundary and add thresholds before treating 10/25/50 as capacity acceptance.

No direct unauthenticated message disclosure, SQL interpolation injection or browser-rendered message XSS was identified in this inspection. Conversation access is intentionally shared across account members; account-wide visibility should remain explicit policy, not be described as assignee-only confidentiality.
