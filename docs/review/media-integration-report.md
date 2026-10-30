# Typed media transport and worker integration

Implemented Task3 of `docs/plans/connector-media.md` using injected SDK-shaped methods and synthetic bytes only. No actual SDK login/upload/network, account/customer data, public endpoint, production configuration or deployment was used. SDK remains development-only and application provider selection remains disabled/mock.

## Changes

- Transport exposes separate `sendAttachment(input,peer,type)`, validates/clones bounded media synchronously before scheduling, requires the optional approved API method and accepts exactly one attachment ID with null text response. Text retains its primitive interface.
- Shared dispatch uses a per-call private Symbol for genuine generation cancellation, finite send deadline and fixed unknown outcome for any exception, malformed response or timeout after possible invocation. Late results cannot change the returned outcome; timeout does not cancel external execution or automatically retry. ID parsing rejects unsafe/negative numeric IDs.
- Provider preflight requires contiguous parts0..N, no attachment on part0, exact unique explicit UUID bindings, same message/account, outbound message mapping, maximum5 attachments and5MiB each/25MiB aggregate. Metadata is checked before fetching bounded bytea. Attachment rows take FOR SHARE during the worker preparation transaction. Every media header/content-shape is validated and bytes privately cloned before any text/media send; no legacy order is inferred.
- Private prepared state is released in worker finally through the existing release hook. Each dispatch gets its own Buffer copy. Blank text may skip only with fully preflighted media. Missing transport media capability or malformed later media fails before the first text call.
- Root identified SQL btrim vs JavaScript trim mismatch for newline/tab-only text. Worker now obtains text only when real attachment rows and media parts exist, then applies the same JavaScript trim test. A nonblank or invalid null result remains unknown. SQL regression uses `\n\t ` plus a valid media part.
- Native Node's guarded SDK probe initially failed because source transport.ts imports emitted `media.js`. The probe now resolves only that fixed transport→media edge to source media.ts using a synchronous registerHooks resolver after installing network guards. Its permission command grants read only to that one additional source file; writes/child processes/network remain blocked and self-tested.

## Executed evidence

- RED new transport cases:4/4 failed because sendAttachment was absent.
- GREEN transport media cases:4/4 passed: snapshot mutation/strict exact acknowledgement, invalid/missing-method/generation cancellation with zero SDK calls, upload-like side effect then timeout/late response with exactly1 call, malformed envelope/SDK throw classified unknown.
- RED new bridge cases:2/2 failed with old Unsupported SDK message preflight.
- GREEN pure bridge cases:2/2 passed: reversed explicit binding snapshot, all-parts preflight rejection, foreign ownership/message, legacy NULL, noncontiguous/duplicate binding, oversized/header-invalid media, blank skip and cache release.
- Final `npm run test:transport`:48/48 PASS,0 failures/skips.
- Final `npm run test:sdk`:2/2 PASS under actual permission/network guard; import/model/constructor only, no login.
- Existing bridge/sentinel plus new pure media bridge cases:5/5 PASS; existing metadata-only fakes remained compatible.
- `npm run typecheck`:PASS. Earlier concurrent attempt was temporarily blocked by an ownership test importing its not-yet-authored module; this was resolved by the final full typecheck.
- `git diff --check`:PASS.

## Hosted evidence required

New `tests/backend/provider-media.test.ts` SQL scenario uses real store/worker: text+2 media, early exact text/media echoes preserving one staff message, accepted parts preserved before later unknown, no second run resend, whitespace-only text skip and legacy binding rejection before sending. One correctly configured local SQL invocation failed at setup with `connect EPERM 127.0.0.1:55432`; no SQL assertion executed. This is UNPROVEN locally, not a behavioral RED or pass. The complete PostgreSQL suite, independent four-staff mixed-media HTTP flow, process/crash tests and nonempty bound-media recovery/restore fixtures must run in hosted CI before integrated acceptance.

Header validation is not a complete image/document decoder or malware guarantee. Actual upload/CDN behavior, inbound media download, phone coexistence and real delivery remain UNPROVEN. Independent review is required before publication; no production-ready claim is made.
