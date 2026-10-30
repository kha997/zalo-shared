# Private inbound media implementation plan

> Planning only. Execute task by task with TDD and independent review under Owner's autonomous directive; no real SDK login, CDN request or account data is authorized by this plan.

**Goal:** Materialize supported inbound attachments into existing authenticated private storage through a durable, bounded download pipeline, without treating untrusted provider locators as general-purpose fetch permission.

**Architecture:** Normalize only a documented candidate media frame, encrypt its locator before transactional receipt, journal and enqueue atomically, then download through a pinned-public-IP HTTPS boundary. The browser receives only local attachment IDs/status. No executable or environment switch enables real provider operation; empty approved-host policy fails closed.

**Spec:** docs/DESIGN.md; docs/plans/connector-media.md; docs/plans/connector-ownership.md; Owner's no-real-account/no-public-endpoint invariants.

## Actual artifact evidence and uncertainties

Inspected exact installed zca-js2.2.0, not a source/binary-equivalence claim:

- `node_modules/zca-js/dist/models/Message.d.ts:2–14` defines generic attachment content with title, description, href, thumb, childnumber, action, params and type. `TMessage.content` also permits arbitrary TOtherContent. It does **not** specify a discriminated photo/file payload, MIME, size, signed-URL lifetime, authenticated download requirements or trusted CDN hosts.
- `dist/models/Message.js` UserMessage/GroupMessage constructors normalize direction/thread identity and retain content unchanged. This is no content/URL validation.
- `dist/utils.js:425–443` recognizes chat.photo and share.file as message categories. It does not prove that every such message uses a downloadable href or that albums/multipart messages share one schema.
- `dist/apis/sendMessage.js:26` uses attachment href/thumb for quoted image URLs; this is only supporting field evidence, not an inbound download contract.
- Current `normalizeInbound` intentionally discards nontext content as unsupported. Provider store persists bounded text/unsupported events; private attachments use PostgreSQL bytea and authenticated GET with attachment Content-Disposition/nosniff. Full-row backup fingerprints already include stored bytes.

No trusted provider CDN domain, real inbound photo/file fixture, album ordering, MIME or cookie-free CDN behavior was observed in this phase. Do not invent an allowlist from brand names or accept *.zalo.* wildcards. Source-shaped offline cases remain synthetic. Before live activation, approved dedicated-account observations must confirm each supported frame/host and the absence of session credentials in download requests; otherwise keep that case unavailable/unsupported. This is a live resource/compatibility gate, not permission to broaden network policy automatically.

## Global constraints and review focus

- At most5 media entries/event; each URL UTF8<=4096bytes, title<=200chars; total normalized event<=65536bytes. One simple href entry is the initial candidate; albums stay unsupported until separately specified and tested.
- At most5MiB nonempty downloaded bytes/item,25MiB/event,2 concurrent downloads/process and a configurable global queue/storage budget. Headers<=16KiB, DNS deadline2s, connection/headers5s, whole request15s; all bounds enforced in code, not advisory settings.
- Only exact administrator-configured ASCII DNS hostnames, HTTPS/default443, no userinfo/fragments/IP-literals/custom ports. No credentials, cookies, SDK headers, referrer or caller-supplied headers. No redirect or implicit decompression.
- URLs/query tokens remain transient or authenticated-encrypted at rest, never in API/audit/metrics/logs/errors/dumps in plaintext. Credentials and locator keys are distinct. No generic proxy endpoint.
- Lost connection or crash may retry a bounded **download GET**, never an outgoing message. Never update outbox/part delivery states as a side effect of media retrieval.
- Replay/changed locator, stale owner, DB failure after GET, DNS rebinding, oversize streams and restored pending jobs all need explicit tests. Local DB restrictions remain UNPROVEN, not passes.

## Task1 — bounded frame contract and durable encrypted intention

Files: `adapters/zalo/inbound-media.ts` (new), `server/provider-schema.ts`, `server/provider-store.ts`, `server/media-jobs.ts` (new); tests `tests/transport/inbound-media.test.ts`, `tests/backend/media-jobs.test.ts`.

Interfaces:

```ts
type InboundMediaCandidate = {index:number;name:string;url:string;category:'photo'|'file'};
function normalizeMediaCandidate(raw:unknown):ReadonlyArray<InboundMediaCandidate>|null;
type LocatorEnvelope = {keyId:string;nonce:string;ciphertext:string;tag:string};
interface LocatorCipher { seal(url:string,aad:string):LocatorEnvelope; open(value:LocatorEnvelope,aad:string):string; fingerprint(url:string):string; }
// AAD binds account/event/index; fingerprint uses a separate stable keyed HMAC.
async function enqueueEventMedia(db:pg.PoolClient,eventId:string,items:ReadonlyArray<InboundMediaCandidate>,cipher:LocatorCipher):Promise<void>;
```

- [ ] RED tests using actual UserMessage/GroupMessage constructors with synthetic content: chat.photo/share.file object href/title only; reject strings/arrays, malformed URL fields, oversize/album/unsupported kinds. Do not fall back to thumb, arbitrary params JSON or another URL field.
- [ ] Keep the normalization result private to receipt. Add an explicit media event kind/descriptor and deliberate migration of the provider_events CHECK; public event projections contain category/count/status only. Media URL must not leak through generic serialization or semantic hash inputs exposed by API.
- [ ] In the existing owner-checked receipt transaction, persist journal plus encrypted locator/intention together. Proposed `provider_media_jobs`: UUID id, account/event FK, index0..4, unique(event_id,index), category, sanitized name, encrypted envelope/key ID, protected locator fingerprint, status pending/processing/ready/unavailable/held, bounded attempt/error codes, attachment UUID FK, next_attempt_at/claimed_at. No URL column. Job uniqueness is independent of download retries.
- [ ] Preserve scoped event identity/actor logic. A known staff self-echo uses its existing explicit attachment bindings and creates no duplicate download. Native self media can materialize only after journal projection has resolved its message ID; held self events retain held jobs. No text/time attribution.
- [ ] Same event/descriptor/fingerprint replay creates nothing. Changed descriptor or locator fingerprint marks an explicit conflict/quarantine; no silent signed-token rotation assumption. Provide an audited replacement path later only with evidence. Fingerprint key rotation must preserve replay comparison or intentionally quarantine; document key IDs and recovery, never compare fresh randomized ciphertext.
- [ ] Cipher tests: random nonces, authenticated AAD swap/tamper rejection, key unavailable leaves honest unavailable status, no plaintext URL in rows/audit/API/errors. SQL tests cover receipt rollback, exact dedup, owner rejection, early echo held-to-linked and native actor NULL.

## Task2 — HTTPS downloader with pinned public address

Files: `server/private-media-download.ts` (new), `tests/backend/private-media-download.test.ts` (pure controlled resolver/request tests).

```ts
interface MediaNetworkPolicy { approvedHosts:ReadonlySet<string>; maxBytes:number; }
async function downloadMedia(url:string,category:'photo'|'file',policy:MediaNetworkPolicy,deps:DownloadDependencies):Promise<{mime:MediaInput['mime'];data:Buffer}>;
// Dependencies expose bounded resolver and a narrow pinned HTTPS request adapter;
// tests inject both, production adapter uses node:https with explicit lookup.
```

- [ ] RED deny tests: empty allowlist, Unicode/punycode confusion, wildcard/suffix tricks, trailing-dot ambiguity, credentials, fragments, non443, literal IPs, localhost, metadata/link-local/private/reserved/multicast/documentation/bogon IPv4/IPv6 and IPv4-mapped IPv6. Parse with WHATWG URL then exact canonical-host equality; configured hosts must already use canonical ASCII form. Resolve all A/AAAA answers and reject if any address is outside reviewed public-unicast ranges; no fallback to ambient DNS.
- [ ] Implement reviewed IP classifier or explicitly pinned maintained dependency with its own tests/inventory; do not handwave public detection as absence of RFC1918 only. Include loopback, 0/8, CGNAT, link-local, mapped6, ULA, IPv6 zone IDs and special ranges in regression fixtures.
- [ ] Resolve once per attempt, choose a permitted address, and bind socket lookup to it. Preserve original hostname for TLS certificate verification/SNI/Host. Verify connected address matches the permitted result, deny proxy/agent auto-selection, and prohibit request-option overrides. DNS rebinding tests mutate subsequent answers and assert the socket still uses the pinned address.
- [ ] Permit only200, reject3xx without following Location, reject nonidentity Content-Encoding, require bounded headers and allowed single Content-Type. Photo accepts PNG/JPEG only; file accepts the four existing MIME types. Reject declared overlimit Content-Length before body and still enforce byte count on every stream chunk, aborting socket on overflow/deadline. Chunked responses remain bounded. Never trust size/name headers.
- [ ] Validate downloaded bytes with existing `prepareMedia` (header/UTF8/dimension limits only, no malware/full-format guarantee), retaining canonical local filename from candidate metadata. Return only private bytes/MIME; sanitize transport/DNS/TLS/status errors to fixed codes. Test partial body, decompression, deadline, malformed MIME/bytes, oversized chunks, abort, redirect and secret-bearing thrown errors with zero external network.

## Task3 — durable worker and private UI status

Files: `server/media-jobs.ts`, `server/media-worker.ts` (new injected library), `server/app.ts` read projection, `client/src/types.ts` and focused message UI; tests `tests/backend/media-job-flow.test.ts`, four-client/browser regressions.

- [ ] Claim only linked-message pending jobs under a per-job database lock, bounded concurrency and explicit retry ceiling3. Decrypt only after ownership/admission check. Crash during GET may reset download processing to pending after lock ownership is established; this does not authorize outbox resend. No automatic attempt for expired/key-missing/policy-rejected/unsupported-schema failures.
- [ ] After validated bytes, transactionally lock job and owning message, verify same owner/account/event/index and no conflict, insert one private attachment with message_id and NULL staff owner, then atomically set ready/attachment_id and delete locator ciphertext after success. Retried completion finds existing ready attachment and creates nothing. DB error after GET leaves retriable job with no false ready claim.
- [ ] Before durable bytes, API/UI expose pending/downloading/unavailable/unsupported status with category/count only; never external href/thumbnail. Ready files use existing authenticated `/api/attachments/:id`, attachment disposition and nosniff. Escape names, never render active PDF/HTML inline. All shared-account staff may read attached files per existing policy; unattached upload access remains owner-only.
- [ ] Add role-protected audited retry only for safe download failures, with attempt/version CAS and no locator disclosure. No endpoint accepts arbitrary URL or replaces locator from browser. Clear fixed messages explain expired/unsupported media without pretending text-only history is complete.
- [ ] Four independent synthetic staff clients receive/read private bytes, replay creates one attachment, native actor remains NULL, staff echo reuses existing media, early held self waits, cross-account read denied, session revoked during request denied under existing rules. Tests inject DNS/request/cipher and real disposable PG, never SDK/CDN.

## Task4 — key/retention, backup/restore and acceptance

- [ ] Locator key is separately supplied through private secret mechanism, never GitHub/env logs; document rotation/recovery and stable fingerprint key. Encrypted database backup is insufficient without recoverable key. Default locator retention24h pending/unavailable, explicit7day maximum failed metadata then purge ciphertext; production budgets are Owner operating decisions.
- [ ] Include jobs in counts/full-row fingerprints and seed nonempty pending/held/ready/expired cases. Fresh restore validates original content first, then quarantines pending/processing jobs as held with no network worker enabled. Existing ready private byte hashes and message/attachment linkage must survive unclean restart and encrypted restore. Test missing keys and both stale/idle ownership restore.
- [ ] Independent security/whole-flow review, full CI, raw log inspection and retained source SHA/evidence. No claim of accepted live media until dedicated approved-account captures confirm candidate schema, approved domains, signed URL lifetime, cookie-free behavior, phone coexistence and actual bytes delivered/read. Unknown schemas remain unsupported; downloader defaults deny all hosts. No public endpoint or production deployment is implied.

## Acceptance boundary

Offline PASS requires durable exactly-once materialization, fail-closed policy/pinned DNS, bounded byte/time/concurrency, private access, no locator leakage, restart/restore quarantine and four-client evidence. Live schema/host compatibility is **UNPROVEN**. Request Owner's dedicated test account/phone/peer and explicit risk consent through the existing private pilot gate only after other offline gates are complete. Never ask for cookies or QR screenshots in chat.
