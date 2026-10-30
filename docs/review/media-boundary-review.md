# Independent typed media boundary review

Verdict: **no P0/P1/P2 finding in Task2 scope; accepted for subsequent injected transport integration**, conditional on complete integration CI and later live pilot. This is not real media-delivery acceptance.

## Scope and evidence

Inspected current adapters/zalo/media.ts, sdk-facade.ts delta, media/facade tests, report and connector-media plan. Compared against the actual installed pinned zca-js2.2.0 Attachment.d.ts and dist/apis/uploadAttachment.js and sendMessage.js. No implementation edits, real SDK login/upload, network or account use.

Independent focused execution: `node --import tsx --test --test-isolation=none tests/transport/media.test.ts tests/transport/sdk-facade.test.ts` passed **17/17**, zero failures/skips. `npm run typecheck` also completed with exit0: PASS.

## Assessment

- Buffer-only runtime checks reject strings/paths/URLs; bytes are cloned synchronously before raw invocation. Canonical extension comes from the four-item MIME allowlist. Names lose directory components and unsafe characters; names/bytes are bounded. Extra caller metadata is not forwarded.
- PNG requires a full IHDR region and derives bounded dimensions. JPEG walks bounded segments until a complete valid-length SOF region, excluding premature SOS/EOI and truncation. Pixel bounds match the plan. These checks deliberately do not decode/validate a complete image. PDF prefix and fatal UTF8 plaintext checks match the narrower documented boundary.
- Actual SDK selects upload behavior by extension and trusts Buffer metadata. The new facade supplies derived byte size/dimensions and exactly one attachment with empty text, avoiding compound text/media partial execution. Actual sendMessage constructs message:null and attachment[] as expected.
- Facade retains generation/active-instance checks before invocation and after settlement, sanitizes raw exceptions, validates an exactly-one attachment acknowledgement and excludes raw response fields. Safe numeric/string IDs remain narrow. Invalid input causes zero raw calls in executed tests; ambiguous envelopes and thrown postcall errors are rejected without revealing causes.
- Existing text sendMessage input boundary remains unchanged. Login remains explicit and disabled by default; this change does not enable an app provider or expose raw SDK/session objects.

## Required Task3 evidence and limitations

The facade intentionally has no per-send cancellation guarantee or delivery timeout. Task3 must bound waiting at transport, classify *every* throw/malformed result after invoking it as unknown, fence stale generations, and never turn a facade rejection into proof of nonexecution. Pure preflight must occur for every bound attachment before the first text send. Prepared bytes must stay private, bounded in aggregate and released after the job. Add mixed-media/partial-confirmation/timeout/no-resend tests against real disposable PostgreSQL.

Header validation is not malware scanning or full file-format safety. SDK upload callbacks may hang or complete after timeout; network delivery and phone compatibility remain UNPROVEN. These limits are already documented rather than concealed as acceptance.
