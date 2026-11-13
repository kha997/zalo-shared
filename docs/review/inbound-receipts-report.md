# Private inbound receipt intentions

Implemented the durable receipt part of inbound Task1 only. No downloader worker, application host policy, secret file, live configuration, actual SDK login, network/CDN request, real account/customer data or production deployment was introduced. No commit or staging was performed.

## Boundaries and interfaces

- Transport `captureMedia?:boolean` defaults false. Only an explicit true captures the reviewed single `href/title` candidate privately into `ProviderEvent.media`. Unknown schemas remain unsupported. The owned runtime exposes an optional injected `mediaCipher` and derives capture from that capability; it always forwards its current owner token.
- `ingestProviderEvent(pool,event,context?)` adds `mediaCipher?:LocatorCipher` and `maxPendingMedia?:number` to the optional context. Captured media without a cipher fails before database acquisition. Explicit invalid owner fields remain rejected; media-only context exists for synthetic fixtures, while the owned runtime always supplies ownership.
- Existing no-media semantic hashes remain byte-compatible: descriptors enter the hash tuple only when present. Canonical/variant `media_descriptor` stores only index/category/safe basename/keyed locator fingerprint. No plaintext locator becomes a SQL parameter, API projection, audit value or semantic-hash input.
- Event UUID is generated explicitly before receipt insertion. Encrypted job envelopes use `locatorAad(ACCOUNT,eventId,index)`. Journal insertion, ciphertext/intention, projection and linkage share one transaction; exact replay adds no second job and does not rotate ciphertext. Changed locator/descriptor creates a retained normalized conflict and quarantines pending/processing jobs, preserving canonical intention.

`server/media-jobs.ts` exports:

```ts
prepareEventMedia(items,cipher):PreparedEventMedia;
enqueueEventMedia(db,eventId,prepared,maxPending=1000):Promise<void>;
linkEventMedia(db,eventId):Promise<void>;
```

Both database helpers require an explicit transaction, validate ACCOUNT event/conversation scope and acquire conversation before event/job locks. Queue admission serializes with `(73004,1)` and bounds pending/processing/held rows to a configurable1..10000 (default1000). It is a receipt-intention budget, not a process-memory or storage guarantee.

`provider_media_jobs` fields: UUID id/account/event; item_index0..4; category/name; protected locator_fingerprint; bounded JSON locator_envelope; status held/pending/processing/ready/unavailable; message/attachment FK; attempts0..3; bigint version; fixed error_code; created_at/claimed_at/next_attempt_at. Ready requires an existing attachment and NULL locator ciphertext. Initial capture supports one candidate only; remote byte limits are enforced by the subsequent bounded downloader/worker, not inferred from a locator.

Exact sent delivery-part mapping reuses the existing private attachment and clears ciphertext instead of downloading it again. Early self echoes remain held until part acceptance/reconciliation. Native self/inbound projection retains actorNULL and makes a pending intention. A matched nonattachment part becomes honestly unavailable. No text/time matching is used.

## Executed evidence

- New receipt pure test initially failed because media-jobs was missing, then passed1/1. It covers missing cipher before DB, bounded descriptors, no locator in descriptors and invalid explicit ownership.
- New actual-transport opt-in test initially failed its true-case assertion, then passed after capture was implemented. It proves default-off receipt contains no locator while explicit capture delivers the private candidate to the durable consumer.
- Complete transport/facade/vault/parser/runtime suite:64/64 PASS. Typecheck and compiled server build PASS after final helper hardening; diffcheck PASS.
- Three PostgreSQL scenarios authored: encrypted replay/dedup/conflict/no locator leakage; early staff echo reusing bytes and native actorNULL; quota/cipher/stale-owner rollback plus migration preservation. No configured database attempt was repeated because local PostgreSQL EPERM was already established. All SQL/linkage/concurrency acceptance is UNPROVEN until hosted CI.
- Actual SDK guarded probe needs the coordinating exact inbound-media.ts source-edge mapping/read grant, because native Node does not resolve its emitted .js specifier. No permission or package/probe edits were made in this contribution; coordinating guarded SDK verification remains required.

## Required follow-up

The worker must claim/decrypt only admitted canonical intentions, enforce byte/time/concurrency/storage/retention budgets and recheck owner/attempt/conflict state before atomic private materialization. It must include ready bytes and encrypted jobs in backup/restore quarantine. `linkEventMedia` permits an externally resolved canonical event, but a worker/operator integration must explicitly invoke it after conflict resolution; this task does not edit the operator service. Held canonical events without a projected message stay blocked rather than guessing native attribution. Current UI/HTTP projections do not expose locator descriptors or download status yet.

The strict candidate contract and hosts remain unverified against a real account. Capture plus encryption is not download permission. Real schema/CDN/phone operation and production readiness remain UNPROVEN; keep the actual provider disabled.

## P2 correction — a filename must not become a locator side channel

Independent review reproduced a signed locator supplied both as href and title. The original parser stripped its directory and kept a query-bearing basename, so the new durable name/descriptor path could retain the locator token in plaintext. Both parser and direct receipt regressions first failed with synthetic signed-token values.

The parser now accepts a filename-only title and rejects URL/path/query/fragment/credential/percent syntax instead of guessing which parts of a signed locator to strip. Direct `prepareEventMedia` rejects the same ambiguous name syntax before descriptors or database access. Ordinary Unicode names such as `Hóa đơn (1).pdf` remain accepted. Directory-bearing titles are intentionally unsupported in this strict initial candidate contract.

After correction, three focused parser/receipt checks and the complete65/65transport suite PASS. The final global typecheck was blocked only by a concurrently authored worker test importing its not-yet-created media-worker module; no receipt diagnostics occurred. Coordinating final typecheck remains required once worker source settles. SQL assertions remain UNPROVEN; no new database/network operation was attempted. Independent correction re-review is requested before acceptance.

The reserved-syntax check evaluates NFKC equivalences as well, rejecting fullwidth query/equals/at signs instead of admitting an encoded-name variant of the same side channel. The three focused checks passed again with these fixtures; compiled server and diff checks passed. Stored ordinary filenames are not silently rewritten.
