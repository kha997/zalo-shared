# Offline transport candidate review — 2026-10-28

`adapters/zalo/transport.ts` and `vault.ts` are reusable candidate modules. They are **not wired into the production application or provider worker**. No SDK dependency was added, no account login was performed, and no provider, phone, media or live delivery capability is claimed. Existing DESIGN/API simulator-only boundaries remain unchanged.

## Implemented behavior

- Caller explicitly injects an approved `createApi(options)` facade; module imports no SDK. Safe SDK options are logging false, selfListen true, checkUpdate false. Start calls coalesce; one listener is owned per process via WeakMap. Listener uses retryOnClose false, leaving a maximum three retries to this wrapper. Stop cancels scheduled retries and fences pending initialization and stale event callbacks. Duplicate/kick close codes 3000/3003 and explicit session invalidation expire the instance without retry; a fresh instance is required afterward.
- Default status remains connecting until SDK connected event; send is rejected before connection. `requireConnectedEvent:false` is an explicit synchronous test-facade compatibility option and must not be used with a real asynchronous SDK. SDK errors disconnect/retry; a closure-free error sink remains on released emitters to consume late errors. Stop before a queued send starts prevents SDK execution.
- Text sends return sent only with a provider message ID. Exceptions, missing provider IDs and timeouts return unknown, with no resend. Timeout does not cancel a provider request already executing; eventual delivery remains possible. Transport does not persist or deduplicate inbound records: the eventual database integration must implement the account/thread/provider ID uniqueness contract.
- Inbound normalization accepts validated text/self-origin metadata and returns unsupported metadata for nontext events. It neither exposes media URLs nor fetches them.
- Vault uses AES-256-GCM, fresh random 12-byte nonce, 16-byte authentication tag and version-bound AAD. External 32-byte key is copied into memory and never persisted. Each write creates a random exclusive temporary file with mode 0600, fsyncs and closes it, then atomically renames it over the target; cleanup removes temporary files. Concurrent replacement yields a complete authenticated envelope. Wrong key/tampering fail authentication. No logging is performed by either module.

## Local zca-js 2.2.0 API mapping

Reviewed local `/workspace/zalo-study/core/source` only, without importing/executing it:

| Candidate contract | Local source mapping |
| --- | --- |
| injected createApi(options) | A future approved facade constructs `new Zalo(options)` and supplies authenticated API; createApi is our seam, not an upstream export. Authentication is deliberately absent. |
| logging/selfListen/checkUpdate | `src/context.ts` Options, `src/zalo.ts` constructor |
| listener.start({retryOnClose:false}) | `src/apis/listen.ts:173` |
| connected/message/error/closed events | `src/apis/listen.ts`; connected emitted after WebSocket opens. Upstream emits disconnected then closed when retry is disabled; wrapper consumes closed once. |
| expiry codes 3000 / 3003 | DuplicateConnection / KickConnection enum in `src/apis/listen.ts:32` |
| listener.stop() | `src/apis/listen.ts:474`, closes socket and resets internal state |
| sendMessage(text, threadId, type) | `src/apis/sendMessage.ts:613`; reads result.message.msgId; group type 1, user type 0 |

## Verification

Initial seven existing tests failed against unimplemented stubs. Additional tests were added before lifecycle/queued-send/late-error fixes and observed failing. Final offline command `node --import tsx --test tests/transport/*.test.ts`: **2 isolated test files passed**, 815.61 ms observed. Detailed `--test-isolation=none` run: **12 tests passed**, 353.55 ms observed after final cleanup. `npx tsc --noEmit` passed. No actual network was used.

Broader `npm test` was attempted but blocked before any backend tests executed: tsx IPC socket creation failed with `listen EPERM /tmp/tsx-1000/17749.pipe`. This is a sandbox limitation, not backend test evidence; the coordinating agent owns broader verification.

## Remaining gates and limitations

The candidate is process-local coordination, not cross-process ownership/fencing. Retry count is bounded for the instance lifetime; it does not reset automatically after connected. SDK creation cannot be cancelled through this seam, but late completion cannot start a listener. There is no connection handshake timeout or inbound durable buffer. API construction/authentication, key loading/rotation/backup, outbox/DB integration, operator fencing, credential expiry classification beyond explicit invalidation/known close codes, provider-specific confirmation and all real account validation remain separate work.

Vault requires a trusted private parent directory. File contents are fsynced, but the containing directory is not fsynced, so atomic replacement is not a guarantee of surviving every power loss. Key memory is not zeroized; encryption does not protect against a process that already holds the key. No live provider readiness or exactly-once delivery claim follows from these tests.
