# RFS-ADRENO/zca-js independent findings

Inspected 2026-10-27. Revision `0586dc5e4981985c5f16b9b3a5f285a02feb6f9b`, committed 2026-10-13. Retrieved public source through connected GitHub reader because CLI proxy refused connection. `core/source` is a selected-file snapshot, not a complete checkout. No dependency install/build/live login was performed.

## Architecture and licensing

MIT library, version 2.2.0, Node >=18; unofficial personal-account browser emulation, not a staff inbox. No staff login, authorization, agent attribution, database, durable queue, or backup layer supplied by this library. Cookies/IMEI/user agent establish the shared Zalo identity. Defaults include `selfListen:false`, `logging:true` (context.ts:196-206); phone-originated/self messages require deliberate handling. README explicitly warns of bans and one web listener per account. Four workstation web logins are unsuitable; four application users sharing one backend is the feasible topology, subject to live testing.

Pinned citations: [README](https://github.com/RFS-ADRENO/zca-js/blob/0586dc5e4981985c5f16b9b3a5f285a02feb6f9b/README.md), [license](https://github.com/RFS-ADRENO/zca-js/blob/0586dc5e4981985c5f16b9b3a5f285a02feb6f9b/LICENSE), [listener](https://github.com/RFS-ADRENO/zca-js/blob/0586dc5e4981985c5f16b9b3a5f285a02feb6f9b/src/apis/listen.ts#L146), [context](https://github.com/RFS-ADRENO/zca-js/blob/0586dc5e4981985c5f16b9b3a5f285a02feb6f9b/src/context.ts#L196).

## Reproduction and outcomes

Run `node /workspace/zalo-study/core/test-listener.mjs` on Node 24.19.0. Uses Node's experimental TypeScript transform on the retrieved upstream Listener, replacing imports only with transport/model/decoder doubles. No socket listener/network/account required. Does not validate cryptography, model parsing, actual WebSocket, HTTP delivery, four browser sessions or live Zalo. Results saved in `core/test-results.json`.

| Test | Outcome | Exact scope |
|---|---|---|
| Four subscribers receive one event | PASS | Four in-process callbacks, not four authenticated staff clients |
| Replay identical message ID | FAIL | Eight total callbacks; duplicate suppression absent in tested path |
| Duplicate-connection command 3000 | PASS | Synthetic frame closes transport with code 3000 |
| Reconnect with default start() | FAIL | Retry disabled by default; documented implementation choice |
| start({retryOnClose:true}), close 1006 | PASS | New mock transport created; no message-gap recovery proved |
| stop() during retry delay | FAIL | New mock transport created after stop |
| Phone simultaneous operation; real invalidation; text/media delivery; durable recovery | UNPROVEN | No separate account/phone; no live tests |

Listener references: lines 173-215 retry opt-in/timer; 258-271 emits messages without ID filtering; 461-465 duplicate closure; stop/reset do not retain/cancel reconnect timer. [Open PR 387](https://github.com/RFS-ADRENO/zca-js/pull/387) independently describes the cancellation defect and was unmerged when inspected; existence of a proposed fix is not evidence of a fixed release.

## Dependencies, tests and security

package-lock v3 contains 266 package records; sampled locked runtime dependencies: ws 8.21.0, tough-cookie 5.0.0, form-data 4.0.6, crypto-js 4.2.0, pako 2.1.0, semver 7.6.3, all with integrity fields. Two lock formats (npm and bun) exist; choose and pin one. This is inventory, not a vulnerability clearance: registry audit/SBOM/advisory matching not executed because package networking unavailable. CI inspected builds and lints using npm install (not npm ci); test/test.ts is an account-dependent example that logs message content, not an offline assertion suite. Do not run it with real account data. Full build and upstream tests UNPROVEN.

Media sending implementation exists (`src/apis/sendMessage.ts`, attachments upload and GIF handling); v2 README requires an imageMetadataGetter for file-path image/GIF sending. Actual delivery and replay recovery UNPROVEN. Open upload/QR/reconnect PRs are maintenance signals only, not validated fixes or vulnerability determinations. No malice assessment or complete transitive audit is claimed.

Security boundary belongs in the host application: never deliver cookies or QR/session controls to ordinary agents; disable sensitive logs; store session secrets encrypted with restrictive file permissions; run one fenced listener; block new sends after session invalidation; require explicit reauthentication. Cookie possession is account-level capability, not staff identity. MIT copyright permission does not authorize Zalo platform access.
