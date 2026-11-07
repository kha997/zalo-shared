# Durable media part binding — Task 1

Implemented in `server/db.ts` and `server/app.ts`; no SDK/login/provider configuration was changed.

The idempotent migration adds nullable `delivery_parts.attachment_id` referencing attachments, a per-message unique attachment index, and a check preventing attachment binding on text part0. Existing media rows remain NULL rather than guessing original order. New enqueue operations bind part1..N directly to the original request's UUID order within the existing authenticated transaction. Existing UUID uniqueness/ownership/account/availability checks, actor-scoped payload-sensitive idempotency and mock provider behavior are retained.

`tests/backend/media-parts.test.ts` was authored before the implementation. Its real API/SQL scenario checks reversed UUID ordering; part0 NULL; idempotency preserving bindings and rejecting reordered payload; duplicate UUID rejection; unavailable/cross-owner/cross-account/already-attached rejection with no orphan message/outbox/binding; FK/unique/check enforcement; migration rerun preserving actual bindings and leaving legacy NULL rows unguessed. It uses only synthetic plaintext and Fastify injection, never SDK/network/account/customer data.

## Evidence and limits

- First pre-implementation invocation failed before assertions because TEST_DATABASE_URL was absent. This is **not a demonstrated behavioral RED**.
- One invocation with private development environment sourced without printing values failed at isolated-schema setup with `connect EPERM 127.0.0.1:55432`. No SQL/API assertion executed. **SQL migration and API runtime acceptance remain UNPROVEN pending hosted CI**. No permission escalation or repeated database attempt was made.
- `git diff --check`: PASS.
- Initial `npm run typecheck` was blocked by concurrent Task2's test import of not-yet-created `adapters/zalo/media.js`; no diagnostic involved Task1 files. Coordinating full typecheck is required after that module exists.

The FK does not establish that a referenced attachment belongs to the same message/account. Task3's provider preflight must verify message/account ownership, direction, complete contiguous parts, unique explicit bindings and byte limits before any text or media SDK invocation. Legacy NULL media bindings must fail before dispatch. This task enables no actual Zalo media and establishes no real-phone, provider delivery or production-readiness evidence.
