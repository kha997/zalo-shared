# Inbound candidate and encrypted locator foundation

Implemented only the pure candidate parser and locator cipher foundation of Task1 in `docs/plans/connector-inbound-media.md`. No schema/store/transport/runtime/config/application/queue/downloader wiring, CDN allowlist, real SDK login/network request, filesystem key access, customer data, commit or publication was introduced.

## Interfaces and boundary

- `normalizeMediaCandidate(raw)` accepts only one object-shaped `chat.photo`/`share.file` content with exactly `href` and `title`, returning a frozen array/frozen candidate with index0, basename, private URL and category. Extra fields/album forms, arbitrary params/thumb fallbacks, unknown schemas, controls, malformed Unicode, oversized URLs/titles and ambiguous/non-HTTPS locator syntax fail closed as null. This helper does not establish message/account/thread identity: existing receipt normalization and ownership checks must still do so before persistence.
- HTTPS syntax/default443 is checked, including raw empty-userinfo/fragment/backslash ambiguities. A syntactically accepted hostname/IP is **not download authorization**; future downloader must independently enforce approved hosts, public-IP DNS pinning, TLS and byte/time limits. No approved host was invented. Neither helper fetches anything.
- `locatorAad(accountId,eventId,index)` creates the canonical versioned account/event/index binding for UUIDs and item indexes0..4.
- `createLocatorCipher({activeKeyId,keys,fingerprintKey})` privately copies an injected map of1..8 AES256 keys and a distinct32-byte stable HMAC key. `seal(url,aad)` emits random12-byte nonce AES256-GCM ciphertext/tag with key ID and canonical version/key/AAD binding. `open(envelope,aad)` strictly validates key identity, exact four-field shape, canonical bounded base64 and authentication before returning bounded well-formed URL text. `fingerprint(url)` uses separate-domain keyed HMAC-SHA256 so randomized ciphertext does not break replay comparison. Errors are fixed `Locator cipher unavailable` without raw causes/URLs/keys.
- Rotation can read retained old encryption-key IDs and writes the selected active key. The fingerprint key must remain stable across encryption rotation; replacing it needs a separate migration/reconciliation policy. These functions do not load, distribute, recover or securely erase keys and do not implement key retention/rotation operations.

## Source evidence and tests

Inspected the exact installed2.2.0 `dist/models/Message.js`: UserMessage/GroupMessage constructors preserve the content object while normalizing routing identity. Tests instantiate both actual constructors with synthetic content; no login/QR or network API is invoked. Generic `Message.d.ts` content shape and category names are source evidence only, not a verified live photo/file contract. Strict two-field content may reject legitimate richer live schemas; unsupported remains the intentional result until approved observations and a separately tested contract extension.

- Initial RED: both new test modules failed with missing implementation modules. This demonstrates unavailable feature/module, not an executed assertion failure.
- Initial GREEN:6/6 pure cases passed.
- Added URL ambiguity regressions: parser returned a candidate for `https://@...`, cipher accepted it, causing2 explicit assertion failures. Raw authority/fragment/backslash/well-formed-Unicode checks fixed the cases;6/6 passed.
- Added malformed-title-Unicode regression: candidate was incorrectly accepted, causing an explicit assertion failure; rejection fixed it and final6/6 passed.
- Cases cover exact source-shaped candidate extraction, unsupported/album forms, immutable snapshots, syntax/size rejection, random nonces, no plaintext locator in envelopes, context/key/tag/ciphertext swaps, canonical encoding, copied-key mutation isolation, old-key reads/new-key writes, stable HMAC across encryption rotation, missing keys and sanitized errors.
- Coordinating transport suite at the current shared worktree passed63/63, including concurrent ownership-runtime tests; guarded SDK import/model/constructor suite2/2 and compiled server build passed. After the last parser-only edge correction, focused6/6 and full typecheck passed. These suite counts describe the shared local source, not a published/hosted snapshot or whole backend SQL acceptance.

PostgreSQL/HTTP/queue/restart/restore integration was not run for these pure functions. The previously known local PostgreSQL restriction was not retried. Existing hosted source results do not validate these newly authored files. Durable encrypted jobs, private materialization, downloader policy, schema/domain compatibility, real media/phone operation and production readiness remain **UNPROVEN**.
