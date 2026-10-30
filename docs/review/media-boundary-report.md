# Typed outbound media boundary report

Implemented Task2 of `docs/plans/connector-media.md` only. No transport/provider/runtime wiring, real SDK authentication, upload/network operation, customer bytes or production deployment.

## Changes

- `prepareMedia` accepts only nonempty Buffer sources up to5MiB and the four approved MIME types. It rejects path/URL/string sources, NUL/control names, invalid UTF-8/plaintext NULs and signature mismatches. It privately clones bytes and derives canonical filename extension from MIME.
- PNG requires complete IHDR header with derived dimensions. JPEG walks bounded marker segments and requires a complete SOF segment with valid dimension bounds. Each dimension is1..16384; pixel area <=40,000,000. PDF requires literal `%PDF-` bytes. These are header/content-shape checks, not full decoders, malware scanning or document-safety guarantees.
- The facade exposes separate `sendAttachment(input,peer,type)` without widening text `sendMessage`. It passes `{msg:'',attachments:[one canonical Buffer source]}` to the injected raw SDK. It accepts only null text response and exactly one bounded string/safe numeric attachment ID; raw errors/extra fields are sanitized. Post-call errors indicate uncertainty to the caller, not proven nonexecution.
- Inspected actual pinned2.2.0 `dist/models/Attachment.d.ts`, `dist/apis/sendMessage.js:410–451` and response declarations. The SDK trusts Buffer metadata, can issue uploads separately and does not establish cancellation when the caller times out. No source-to-binary equivalence claim.

## Test evidence

- RED pure validator: module missing, exit1.
- GREEN pure validator:2/2 cases, including canonical PNG/JPEG/PDF/text sources, cloned mutation, empty/oversize/path/string input, MIME mismatches, truncated headers, dimension bounds and invalid UTF8.
- RED facade extension: existing13cases passed, new2cases failed because sendAttachment absent.
- GREEN focused pure+facade:17/17 passed. Exact one-source envelope, private Buffer snapshot, zero raw calls for invalid input, sanitized ambiguous envelopes/errors and closed-generation refusal covered.

Task3 must add dispatch generation/timeout classification and real-PostgreSQL part-preflight integration. This report does not establish real Zalo upload compatibility or delivery. Signature/header checks are intentionally narrower than full format validity.

Final local verification: `npm run test:transport` **44/44 PASS**, `npm run test:sdk` **2/2 PASS** (guarded actual import/model/constructor only), `npm run typecheck` **PASS**. No PostgreSQL integration was attempted for this pure boundary task. No commits or publication performed.
