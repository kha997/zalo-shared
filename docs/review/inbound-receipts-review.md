# Private inbound receipt independent review

Verdict after independent correction re-review: **the sole P2 is corrected; receipt source accepted conditionally on hosted PostgreSQL and subsequent worker/recovery integration**. Original finding/reproduction are retained below. No remaining concrete P0/P1/P2 found in this receipt-only source review. Hosted PostgreSQL, worker/materialization and recovery acceptance remain required. This is not live-provider acceptance.

## Scope and method

Reviewed the worktree receipt delta against the frozen operator index: `server/media-jobs.ts`, provider schema/store, transport capture and owned runtime forwarding, receipt tests/report and the coordinating exact SDK probe edge/read grant. Inspected the existing strict candidate parser and authenticated locator cipher that this path consumes. No product changes, database connection, listener/CDN request, actual SDK authentication or account data were used. Only this review report was authored.

## Original P2 — A locator used as the provider title leaks its query token into plaintext names (corrected)

The actual candidate parser accepts a two-field file frame whose `title` equals its signed `href`. It strips path components from the title but retains the basename query. The receipt boundary permits that query-bearing name and includes it in the otherwise nonsecret descriptor and job name. Thus encrypting `href` does not prevent its query token from entering plaintext canonical/variant `media_descriptor` and `provider_media_jobs.name` values.

Bounded offline reproduction executed the actual parser, `prepareEventMedia` and `createLocatorCipher`, with synthetic URL `https://cdn.example.test/private.pdf?token=SYNTHETIC-LOCATOR-TOKEN` as both href and title. Executed result:

```json
{"candidateAccepted":true,"name":"private.pdf?token=SYNTHETIC-LOCATOR-TOKEN","tokenInPlaintextDescriptor":true}
```

The descriptor/name are subsequently supplied as plaintext SQL parameters by the inspected receipt code; SQL persistence was not executed locally. This is a current capture path, not a malicious cipher-injection hypothesis.

Required correction: reject URL-like/query-bearing provider titles and directly supplied candidate names, or remove locator query material before constructing any persisted descriptor/name. Keep the initial contract strict and fail closed for an ambiguous title. Add parser/actual transport plus direct receipt-boundary regressions that demonstrate the current leak and verify that no locator query marker reaches plaintext metadata. Keep the raw locator only transient or authenticated-encrypted.

## Other assessed boundaries

- Capture defaults off. Owned runtime derives it only from an explicitly injected cipher capability and forwards its immutable owner token; no application live-mode switch or actual login is added. Default normalization continues to discard raw media content.
- Cipher preparation precedes database acquisition; explicit invalid owners remain rejected. Descriptor fingerprints use the separate keyed HMAC. Nonmedia semantic hashes remain compatible, while media descriptors enter canonical/variant semantic comparison.
- New UUIDs bind envelope AAD to account/event/item. Journal, encrypted intentions, projection and link changes share one transaction. Exact replay adds no job; differing locator fingerprints quarantine pending/processing work while retaining canonical intentions.
- Receipt quota admission serializes through the account media advisory transaction lock. Database helper lock order is conversation, event and jobs; matching current account/message/conversation checks protect projection. The budget limits active intentions, not byte storage, process memory or completed history.
- Early self events stay held until exact accepted-part attribution. Matching staff attachment bytes are reused with NULL ciphertext and original author; native/inbound projections retain actorNULL and produce pending jobs. A matching nonattachment part becomes unavailable. No text/time matching was introduced.
- Ready state requires an attachment and no locator envelope. Same-message/account attachment joins precede reuse. Server modules use structural candidate types and avoid importing adapter runtime files across the server rootDir.
- SDK probe uses only an exact transport-parent `./inbound-media.js` mapping and one exact source-file read grant. Network/child/write denial remains present; no broad filesystem grant was added.

## Executed verification and remaining gates

Independent focused pure receipt/default-opt-in transport checks: **2/2 PASS**, exit0. Independent actual guarded SDK import/model/constructor probe: **2/2 PASS**, exit0; no login or QR. Scoped diff check passed. These existing cases do not cover the P2, which was reproduced separately above.

Three authored SQL cases remain UNPROVEN locally. Hosted CI must execute dedup/conflict/encrypted persistence, transaction rollback/quota/owner checks, early exact echo/native attribution and migration assertions. Subsequent worker work must gate canonical/conflict/owner/attempt state, bound download/retention/storage/concurrency, materialize bytes atomically and integrate jobs into backup/restore quarantine. Canonical jobs after explicit conflict resolution need an explicit relink step; unprojected held events must remain blocked. No actual schema/CDN/phone compatibility or production readiness is established.

## Independent correction re-review

The candidate parser now treats title as a filename only: it rejects path separators, URL/query/fragment/credential/percent syntax rather than stripping a locator into a token-bearing basename. Direct receipt preparation independently rejects the same ambiguous name syntax, so bypassing the parser does not reintroduce the plaintext metadata path. Unicode filenames remain supported. This is a deliberately strict candidate contract; unknown/ambiguous titles stay unsupported rather than broadening live compatibility claims.

Re-executed the original actual-parser signed-URL-as-title reproduction and a direct receipt candidate carrying the token-bearing basename, with the same synthetic key capability and no database/network operation. Executed result after correction:

```json
{"candidate":null,"directNameRejected":true}
```

Independent focused correction/boundary verification passed **4/4** cases,0failed, exit0: missing cipher/bounded descriptor checks, direct name rejection before database writes, parser token-bearing name rejection, and default-off/explicit-opt-in actual transport receipt. The prior independently executed guarded SDK probe passed2/2 with the exact new source edge/read grant. No product code was changed by the reviewer. The original P2 is accepted as corrected; real SQL/ciphertext persistence/concurrent linkage, worker materialization, backup/restore and live schema/CDN/phone gates remain unchanged and UNPROVEN by this bounded re-review.
