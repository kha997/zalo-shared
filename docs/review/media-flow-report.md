# Four-staff injected media flow QA

Added `tests/backend/media-flow.test.ts` independently of production implementation. It uses a disposable isolated PostgreSQL schema, real loopback HTTP, four distinct administrator-created staff sessions, actual authentication/CSRF/assignment/upload/enqueue/download routes, real worker/journal/transport and a synthetic SDK-shaped API. No actual SDK authentication, provider upload/network operation, real account/phone or customer data is used.

Each staff member uploads one synthetic text file then one PDF, enqueues in reversed PDF/text UUID order and concurrently retries the same idempotency key three times. The expected dispatch order for each peer is text, PDF, text attachment. Assertions require exactly twelve SDK-shaped calls, four original attributed outbound messages and twelve exact-ID linked journal echoes. Fake sends await ingress drain before acknowledging, establishing a durable early-echo ordering; provider IDs are deliberately reused across peer threads to verify scoped identity.

Negative cases require unauthenticated downloads to return401, another staff member's unattached upload to remain404, foreign-upload enqueue rejection and denied agent user creation. Private owner downloads must return exact bytes before and after attachment binding. Repeated original idempotent requests after completion must not send again. A synthetic native media frame projects an honest unsupported placeholder with null actor; its arbitrary locator is never fetched. Synthetic session invalidation persists quarantine, permits a new text intent to queue and blocks further SDK-shaped dispatch.

## Evidence and limits

- Initial `npm run typecheck`: PASS after adding this test. A later coordinating rerun failed on other agents' in-progress missing ownership module and not-yet-added provider media interface; no diagnostic involved this test. Repeat full typecheck after those implementations settle.
- `prettier --write tests/backend/media-flow.test.ts`: completed.
- Runtime SQL/HTTP assertions: **UNPROVEN**, pending hosted CI once media integration is complete. No redundant local database attempt was made because this environment already has confirmed PostgreSQL EPERM; no successful behavioral RED/GREEN is claimed.

This is four API clients with simulated provider effects. Existing browser coverage is separate; neither establishes physical workstations, real phone coexistence, Zalo upload compatibility, delivery, no-gap recovery, or production readiness. The test depends on the planned injected `sendAttachment(input,peer,type)` API and complete-message preflight; it does not enable a live runtime.
