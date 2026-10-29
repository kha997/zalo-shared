# Typed connector media implementation plan

> For agentic workers: use subagent-driven-development or executing-plans task by task. Owner has delegated design/execution; no additional design approval is needed within the existing invariants.

**Goal:** Send existing private attachments through the injected connector without accepting paths, URLs, arbitrary SDK objects or ambiguous retry.

**Architecture:** Bind each delivery part to its original attachment UUID transactionally. A pure bounded media validator produces canonical Buffer-only SDK sources; facade and transport expose a separate single-attachment method. Preflight the entire message before the first SDK invocation. Existing accepted-part journaling remains authoritative.

**Tech stack:** TypeScript, PostgreSQL, pinned zca-js 2.2.0 development dependency, node:test, existing Fastify API.

**Spec:** docs/DESIGN.md, docs/plans/connector-core.md, docs/operations/SDK-RISKS.md and Owner autonomy/invariants.

## Global constraints

- Synthetic bytes, injected SDK only; no real login, upload, account, phone or network. SDK stays disabled and absent from production runtime.
- Maximum 5 attachments per message, each nonempty and <=5*1024*1024 bytes. No file-system source, URL, GIF, WebP, video, arbitrary metadata or caller-supplied dimensions.
- Once raw SDK invocation begins, error/timeout/malformed response is unknown; never automatically resend. A timeout does not cancel SDK execution.
- One text call followed by one attachment per part; no caption plus attachment compound SDK call. Accepted earlier parts survive later ambiguity.

## Source evidence inspected

These are installed files from exact pinned npm artifact, not claims of source-binary equivalence:

- node_modules/zca-js/dist/models/Attachment.d.ts:1–9: source accepts string paths OR `{data:Buffer,filename,metadata:{totalSize,width?,height?}}`; wrapper must exclude strings.
- dist/apis/uploadAttachment.js:49–85: extension drives image classification, Buffer metadata is trusted; derive metadata and canonical extension locally.
- dist/apis/uploadAttachment.js:144–195: chunks upload concurrently; generic files wait on websocket upload callback without a local resolution deadline. Outer timeout cannot establish nonexecution.
- dist/apis/sendMessage.js:410–451: compound text/media can send text before uploading files; call with `{msg:'',attachments:[oneSource]}` for each media part.
- dist/apis/sendMessage.js:389–407: attachment send requests happen after upload. Upload success alone is not message acceptance.
- server/app.ts:520–540: UUID list is validated/locked but current delivery_parts omit UUID mapping. Sorting attachments by created_at/id cannot recover original request order.
- adapters/zalo/sdk-facade.ts currently exposes text-only sendMessage. Do not widen its accepted argument type.

## Review focus

- Reversed request attachment order must preserve original UUID-to-part mapping, including retries.
- Legacy media without binding must fail before text; never infer order.
- Forged image dimensions, enormous dimensions, malformed/truncated markers and invalid UTF-8 must fail without invoking SDK.
- Accepted upload followed by timeout/malformed send response must remain unknown with no resend.
- Mutable Buffers/metadata must not change after preflight; clone private bytes, bound memory, release cache.

## Task 1 — durable part binding

Files: server/db.ts (migration), server/app.ts (enqueue), tests/backend/media-parts.test.ts; existing counts/fingerprint evidence already covers all delivery_parts columns.

- [ ] Write failing SQL/API tests: reversed attachmentIds maps part1/2 exactly; duplicate UUID rejected; cross-account/owner rejected; idempotency retry retains original map; rollback leaves no orphan job/binding; migration rerun preserves bindings.
- [ ] Add nullable delivery_parts.attachment_id UUID REFERENCES attachments(id), unique(message_id,attachment_id), CHECK(part<>0 OR attachment_id IS NULL). Part0 is text; media parts explicitly set b.attachmentIds[i-1]. Do not backfill old media by guessing order.
- [ ] Verify same-message attachment linkage in bridge preflight, including account, direction and stored UUID; schema FK alone does not enforce message ownership.
- [ ] Run typecheck and hosted SQL suite; review before task3.

## Task 2 — pure bounded media boundary

Files: adapters/zalo/media.ts, tests/transport/media.test.ts, adapters/zalo/sdk-facade.ts and tests/transport/sdk-facade.test.ts (actual filename should follow existing suite).

Interfaces:

```ts
type MediaInput={name:string;mime:'image/png'|'image/jpeg'|'application/pdf'|'text/plain';data:Buffer};
type MediaSource={data:Buffer;filename:string;metadata:{totalSize:number;width?:number;height?:number}};
function prepareMedia(input:MediaInput):MediaSource;
// Returned facade API adds sendAttachment(source:MediaInput,peer:string,type?:0|1).
// Existing text sendMessage signature remains unchanged.
```

- [ ] Write RED tests for invalid types, empty/oversize bytes, path/URL/string payloads, misleading extension, NUL/control chars, cloned Buffer mutation, truncated PNG/JPEG, zero/oversize dimensions, invalid UTF8 text and signature mismatch.
- [ ] Implement canonical filename from sanitized basename (strip slash/backslash/controls, limit128 chars) plus extension chosen ONLY by MIME: .png/.jpg/.pdf/.txt. Ignore caller extension. Bounded Buffer clone; metadata.totalSize===data.length.
- [ ] PNG: verify signature, first IHDR length13/type, available complete IHDR, derive uint32 width/height. JPEG: bounded marker walk using segment lengths, skip standalone markers, reject truncation, find valid SOF dimensions before SOS; no decompression. Dimensions integers1..16384, area<=40_000_000. This is header validation, not antivirus/full image decoding; document that limit.
- [ ] PDF requires %PDF- prefix; plaintext requires fatal UTF8 decoding and no NUL. Do not claim these checks establish safe document content.
- [ ] Facade validates peer/type and calls raw.sendMessage({msg:'',attachments:[source]},peer,type). Require message:null and exactly one valid attachment msgId; any unexpected envelope becomes sanitized uncertainty. Never expose upload URL/checksum/raw SDK errors.
- [ ] Fake-loader tests assert exact canonical Buffer source and zero calls on invalid input; run transport/facade/actual offline SDK guards. Review.

## Task 3 — transport and worker integration

Files: adapters/zalo/transport.ts, adapters/zalo/provider.ts, tests/transport/transport-ingress.test.ts, tests/backend/provider-media.test.ts, tests/backend/connector-flow.test.ts.

- [ ] Extend transport injected API with optional sendAttachment and wrapper sendAttachment(input,peer,type); reuse private cancellation identity, generation fence, timeout and exact ID parser. Missing method/invalid input fails before dispatch. Thrown exception after invocation is unknown.
- [ ] RED tests: facade/transport timeout after upload-like side effect => exactly1 call unknown; malformed response unknown; generation cancellation zero calls failed; late result never changes accepted outcome.
- [ ] Preflight fetch explicit bindings and private bytea in original part order. At most25MiB total cache per prepared message; require all parts0..N and exact unique attachments with same message/account, validate every media before sending text. Blank part0 skips only with valid attached parts. Legacy unmapped/extra/missing parts fail before any send.
- [ ] SDK bridge sends text or exactly one bound attachment. Worker preserves sent/skipped and holds uncertain part; exact echo mapping remains scoped. releaseMessage removes cached private bytes in finally. Never log bytes or names.
- [ ] SQL tests: text+2media, attachment-only, first part accepted second timeout, early/late selfecho IDs, replay no resend, unsupported/legacy fail before text, all confirmations survive process interruption. Four independent synthetic staff flows cover mixed media and access-controlled private downloads.
- [ ] Full build, transport, guarded SDK, hosted SQL/browser/load/restore; fresh independent review. Record actual source SHA and PASS/FAIL/UNPROVEN rather than infer real Zalo delivery.

## Inbound media follow-up — separate required phase

Current normalization honestly emits unsupported media placeholder. Do not silently enable raw provider URL fetching while adding outbound media.

Before implementation, inspect actual inbound SDK models and dedicated-account observations approved by Owner. Define fixed provider-domain allowlist from evidence; require HTTPS, no credentials/custom ports, resolve/pin public IP, block private/loopback/link-local/metadata ranges and IPv4-mapped IPv6, validate every redirect (prefer none), bounded timeout/stream <=5MiB and concurrency. Content validators reuse task2. No generic proxy endpoint.

Persist download intention and provider-event linkage transactionally before work. Locator URLs may contain access tokens: encrypt at rest with managed key, never return/log them; enforce short retention. Only authenticated attachment bytes/metadata become visible through existing private download API. Download failure retains explicit unavailable status and audit, never fabricates media. Backup/restore must cover jobs, ciphertext, key recovery and quarantine. DNS rebinding, redirect, oversize stream, malformed MIME and expired locator tests use local injected resolver/fetch with zero external requests.

This phase remains required before complete media acceptance. Real phone/media/SDK upload evidence remains UNPROVEN until the approved dedicated-account pilot.

## Execution ledger

- Tasks1/2 implemented and independently reviewed without remaining scoped P0/P1/P2. Pure validator/facade focused17/17PASS; SQL binding assertions pending hosted CI.
- Task3 implemented and independently reviewed;48/48transport,2/2actualSDKguard,6/6selectedbridge/media/sentinel checks passed. Complete client/server build passed. Worker whitespace skip now uses the same JavaScript trim semantics as media preflight; newline/tab media-only regression included.
- Added independent four-staff HTTP media flow and nonempty binding/content restart/restore fixtures. All new SQL/HTTP/durability claims remain pending hosted media CI.
- SDK remains disabled/dev-only; no real upload/account/phone or inbound URL fetch.25MiB payload cache limit is not peak process RAM.
