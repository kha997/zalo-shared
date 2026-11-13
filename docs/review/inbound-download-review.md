# Private inbound downloader independent review

Verdict after independent fix re-review: **the P2 response-stream cleanup defect is corrected; scoped source accepted conditionally on hosted CI and later integration**. Original finding and executed reproduction are retained below. No P0/P1 or other P2 identified in this scoped review. This is a library review, not application integration, real CDN/schema, phone or production acceptance.

## Scope and independent evidence

Inspected `server/private-media-download.ts`, its controlled tests/report, exact direct `ipaddr.js@2.5.0` promotion and installed classifier ranges. Ran `node --import tsx --test --test-isolation=none tests/backend/private-media-download.test.ts`: **9/9 PASS**. No real resolver request, network socket, SDK login/account, database action, product edit or commit was performed.

The exact-host policy rejects raw authority/userinfo/fragment/backslash/Unicode normalization ambiguity before DNS. Every bounded answer must classify as public unicast; IPv6 must also be in2000::/3. The inspected dependency excludes reserved/IETF/documentation/transition ranges; mapped IPv6 is denied. The production adapter binds lookup to the selected address while preserving original Host/SNI and certificate verification; agent:false excludes connection pooling/proxy selection. Remote-address checks add an independent consistency check. Tests inspect production adapter options through a fake request implementation. No approved provider domain is inferred from these synthetic cases.

Status200, unique bounded headers, identity encoding, exact allowed MIME, declared/streamed size and existing media content validation fail closed. DNS/header/total deadlines observe late failures and prevent late DNS from starting a request; late header responses are destroyed. Underlying OS DNS cancellation is not established. Global queue/concurrency/storage limits and durable exactly-once materialization remain later integration work.

## P2 — unread response errors can escape cleanup

Location: `createProductionDownloadDependencies` response callback and `downloadMedia` finally cleanup.

The adapter resolves an IncomingMessage/Readable without attaching an error observer before returning it. `downloadMedia` may reject status/headers before beginning async iteration. Its finally block aborts the request; a request/socket cleanup error can propagate to that unread response. Readable emits error without a listener, causing an uncaught exception after the caller already received a sanitized rejection. Late response disposal has the same unobserved stream-error boundary. Existing fakes only emit close on request.destroy, so they miss this path.

A standalone bounded offline reproduction injected an EventEmitter request and actual Node Readable response, status302. `request.destroy(error)` propagated the error to `response.destroy(error)`; no socket or DNS call was made. Executed observations:

```json
{ "downloadError": "response", "uncaught": "Private media download timeout" }
```

Required correction: install a permanent harmless response error sink immediately upon response receipt, before any late/rejected response destruction or resolution. Preserve async iteration's error rejection during actual body reads. Add regressions for rejected-status/header cleanup and error emitted by a late disposed response.

Independent fix re-review and final focused tests are required before accepting this source. Even after correction, hosted CI, durable jobs/private read access/restore, real provider schema/CDN observation and Owner-approved live account tests remain separate gates.

## Independent correction re-review

The production response callback now attaches a permanent harmless error observer immediately on receipt, before settled/aborted/address checks, destruction or resolution. Normal async iteration continues to observe body errors independently; the observer prevents an unread or already-disposed response error from becoming an uncaught exception. The new regression first failed before this correction and now covers status302 abort cleanup plus a later secret-shaped response error.

Independently reran the complete focused downloader suite after the correction: **10/10 PASS**,0failed. Re-executed the original standalone production-adapter reproduction with the same actual Readable/fake request, no sockets or resolver calls:

```json
{ "downloadError": "response", "uncaught": null }
```

No remaining P0/P1/P2 identified in this scoped source. This does not establish real HTTP/CDN behavior, provider schema compatibility, durable materialization/private access, global concurrency/storage budgeting, phone coexistence or production readiness. Those remain explicit integration/live gates.

## Bounded validator-location and SDK-guard follow-up

Root's frozen build identified TS6059 because the server downloader imported a source module outside tsconfig.server rootDir. The validator now resides in `server/media.ts`; `adapters/zalo/media.ts` is a pure re-export of the same function/types and the downloader imports `./media.js`. Independently compared `git show HEAD:adapters/zalo/media.ts` against the new server file: both SHA256 **0340d00cc10c9aee2360c6d566353040d864dba64b7ad0cb8d8ecd1d0718b853**. The validation algorithm and bytes are unchanged.

The SDK probe adds exactly one resolver edge, only when parent is the fixed adapter-media source URL and specifier is `../../server/media.js`. Package permission grants only `./server/media.ts`; no directory-wide server read, write, child-process or network capability is added. Existing network guard installation and self-checks remain before SDK import. Independently reran `npm run test:sdk`: **2/2 PASS**. This move/guard correction introduces no new scoped P0/P1/P2. Root is responsible for the final frozen full build/CI snapshot.
