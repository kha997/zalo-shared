# Private media downloader foundation

Task2 of `docs/plans/connector-inbound-media.md` is implemented as an injected library only. No application/runtime/job/config integration, approved provider host, SDK login, real HTTP/DNS request, customer data or production deployment was used.

## Boundary

`downloadMedia(url,category,policy,deps?)` returns only validated private Buffer bytes and the approved MIME. `MediaNetworkPolicy` requires an explicit nonempty exact canonical ASCII hostname Set (maximum32), maxBytes1..5MiB and optionally shorter DNS/header/whole-request deadlines. No domain is approved automatically. URL userinfo, fragments, literal IPs, nonHTTPS/custom ports, Unicode/control/backslash/trailing-dot/authority normalization tricks are denied before resolution. Explicit443 is permitted.

The pinned ipaddr.js classifier admits only unicast; IPv6 additionally must lie within2000::/3. Its installed2.5.0 special ranges deny RFC1918/loopback/linklocal/CGNAT, test/documentation/reserved/multicast, mapped IPv6, NAT64/6to4/Teredo and IETF protocol ranges. Tests include both public families and special/transition/documentation/zone/out-of-allocation cases. Any bad answer rejects the entire bounded answer set; one admitted answer is selected and copied.

Production dependencies use `node:https` with agent:false, original hostname Host/SNI, certificate verification, exact pinned lookup and remote-address verification. No cookies, authorization, referrer, caller headers, proxy selection, redirect or decompression are allowed. Only200, bounded16KiB unique headers, identity Content-Encoding and the four approved exact MIME types are accepted; photos permit PNG/JPEG only. Declared and streamed size, partial/empty bodies, UTF8/signature/dimension validation and15s total/5s headers/2s DNS upper deadlines fail closed. Underlying OS DNS work cannot be canceled by this library: deadline failure prevents any later HTTP request but does not claim resolver-thread cancellation. Global job/storage/concurrency limits remain Task3.

Every response is destroyed after completion/failure; late headers after deadline are disposed. The production adapter independently refuses pre-aborted/inconsistent URL-host/pin inputs. A follow-up regression demonstrated that the inherited adapter created a request on pre-abort; it failed RED, then passed after a pre-call guard. Settled-state handling now destroys late response objects after a rejected request instead of leaking them. Late request/stream errors are observed/sanitized. Error classes contain fixed codes only, never URL/query/transport details.

## Dependency evidence

Existing runtime-transitive `ipaddr.js@2.5.0` was promoted to an exact direct dependency. Only the root dependency maps in package.json/package-lock.json changed; the resolved graph/tarball/integrity was preserved:

- resolved: https://registry.npmjs.org/ipaddr.js/-/ipaddr.js-2.5.0.tgz
- integrity: sha512-aq+t5NAc+cS6rZQQVWC2x98CPqGtKKTMDd4Gaodv0wShnItdKg/51djkGJ1hqH+Oy0ivDftCbSLCQob8zso01w==
- MIT, Copyright(C)2011–2017whitequark. Installed LICENSE SHA256:62568a2d1337b77171ecca9db10579163446de1ba6151678e81f06cdc199971b. This license remains included in installed production dependency bytes.

The initial package-lock-only offline command with the default cache failed ENOTCACHED. Deterministic root metadata promotion was followed by a successful isolated `npm ci --ignore-scripts --offline --cache /tmp/zalo-npm-cache` (178packages installed, exit0). No registry request was made and no graph/version update was inferred. The install repeated the existing crypto-js deprecation warning; that separately tracked SDK risk remains.

## Executed evidence

- Inherited focused tests7/7PASS. Follow-up production-adapter pre-abort test RED before correction, then GREEN.
- Final `node --import tsx --test --test-isolation=none tests/backend/private-media-download.test.ts`:9/9PASS,0failed. Covers exact-host/URL ambiguity, denied special addresses, mixed answer rejection, pinning/rebinding, redirects/encoding/duplicates, all four MIME paths, bytes/header limits, body errors, DNS/header/body deadlines, late cleanup and fixed production TLS/header options through a fake request adapter. No actual network sockets/resolver queries are performed.
- Final `npm run typecheck`:PASS, exit0. Formatting and scoped diff checks passed.
- Independent security review, hosted CI, durable media-job/materialization/private UI/recovery tests remain required. Header validation does not establish full decoding or malware safety. Real provider schema, CDN host compatibility, upload/download bytes, phone coexistence and production readiness remain UNPROVEN.

## Independent review correction

Reviewer found a P2: a response rejected before body iteration had no error observer. Request abort during finally could propagate an asynchronous error into an unread IncomingMessage and escape the sanitized download rejection. A new actual Readable/fake ClientRequest regression reproduced the failure (RED: Private media download timeout escaped during unread302 cleanup). The adapter now installs a permanent response error observer immediately on receipt, before any rejection/destruction or iterator exposure, including late responses. The regression also emits a subsequent secret-shaped late error and requires it to be consumed.

After correction, all10/10 downloader cases PASS and typecheckPASS. Existing late-response fake now models EventEmitter IncomingMessage behavior. No policy/dependency/application changes or network requests. Independent re-review remains required.

Coordinating frozen snapshot verification passed63/63transport/parser/cipher cases and10/10downloader cases. Initial full server build failed TS6059 because downloader imported the validator outside server/rootDir. The unchanged validator moved to server/media.ts with adapter re-export; downloader uses the server-local module. Independent byte-identity/guard review accepted this boundary correction, guardedSDK2/2 and server compilation passed. No network permissions were broadened.
