# Durable media binding independent review

Verdict: **no P0/P1/P2 identified in Task1 source; accepted conditionally on hosted PostgreSQL/API and restore evidence**. This is not whole-media or production acceptance.

## Scope and method

Reviewed the current delta in `server/db.ts` and `server/app.ts`, `tests/backend/media-parts.test.ts`, the implementation report and Task1 in `docs/plans/connector-media.md`. Inspected enqueue transaction/idempotency/authorization context, worker part handling, upload cleanup, backup fingerprints and fresh restore. No implementation changes, external network, account/SDK operation, database attempts or unchanged test reruns were performed. Only this report was authored.

## Findings and reasoning

- New part1..N bindings use the original validated request array directly, so creation timestamps or UUID sorting cannot change send order. Part0 remains NULL. All inserts occur inside the existing authenticated enqueue transaction after attachment locks and ownership/account/unused checks. No new path bypasses those checks.
- Existing actor-scoped, payload-sensitive idempotency returns the original message before attempting to claim already-bound attachments; reordered attachment arrays change the hash and produce a conflict. Duplicate UUIDs are rejected before transaction work.
- The nullable FK permits existing legacy rows without inventing attachment identity. The check forbids binding media to part0; the unique index prevents reusing one UUID twice within a message. These constraints intentionally do not prove same-message/account ownership: Task3 must enforce that during complete-message preflight before any SDK call.
- Mock worker reads part indexes and does not rely on a fixed delivery_parts row shape, so the additive nullable column does not change its dispatch contract. Existing direct text/legacy part inserts remain valid. No source incompatibility was identified.
- Attachment cleanup removes only unattached uploads. Valid application bindings already set message_id; they do not become cleanup candidates. Conversation/message deletion already cascades to both attachments and delivery_parts. The added default NO ACTION FK introduces no separate user-facing delete path; cascade behavior still requires PostgreSQL execution evidence.
- Backup uses the database dump and delivery_parts row_to_json fingerprints, which include the new column automatically. Restore loads the complete schema/data before constraints and compares fingerprints; no hard-coded old column list excludes bindings. A nonempty bound-media restore fixture in the later integrated media phase will provide stronger positive evidence.

## Tests and required evidence

The new test checks reversed UUID order, part0 NULL, exact replay, reordered-key conflict, duplicate/foreign-owner/foreign-account/missing/already-bound rejection, transaction rollback with no orphan outbox/message, FK/check/unique failures, repeat migration preservation and legacy NULL rows. The implementation report correctly distinguishes setup EPERM from behavioral RED/GREEN. SQL assertions are **UNPROVEN locally**, not passed by this review.

Hosted CI must execute the test and existing mock worker, attachment, crash, browser and fresh restore suites. Task3 must reject missing/foreign bindings, noncontiguous parts and legacy ambiguity before text; preserve confirmed parts and quarantine unknown media sends. This review does not approve any real Zalo login/upload, actual media delivery or phone coexistence.
