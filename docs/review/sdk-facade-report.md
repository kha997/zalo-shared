# Gated session facade evidence

2026-10-28. Scope: Task2, `adapters/zalo/sdk-facade.ts` and its offline tests. Application/server/provider wiring is unchanged. Actual SDK login, QR and provider network were not invoked.

The facade defaults to deny before any session read or SDK load. Explicit `allowNetworkLogin:true` permits a lazy default SDK import; tests inject fake SDK constructors instead. Every creation uses a new constructor with logging:false, selfListen:true and checkUpdate:false. Credentials are JSON-cloned, limited to 64KiB, require nonempty imei/userAgent and 1–256 validated cookie entries. Only selected credential fields reach the SDK; identity fields are retained separately from mutable SDK input.

A narrow listener proxy and sendMessage wrapper hide getCookie/getContext/raw SDK objects. SDK/store/validation exceptions become a fixed Error without a cause. Send results retain only validated message/attachment IDs. Listener error events carry a sanitized Error. Disposal consumes delayed error events. Login timeout defaults to 30 seconds (allowed 1–60000ms); timeout/close fence pending work, and a late login API is disposed before it can expose a listener. Concurrent create/persist operations reject. A new creation disposes the previous generation.

Before exposing a successful API, the facade obtains the current jar with getCookie().serializeSync(), validates/clones its bounded cookies and writes the refreshed session through the injected store. Explicit persistSession repeats this process. Invalid snapshots or write failure dispose the API and reject. The store owns encryption; the facade does not implement a second persistence layer.

## Verification

- RED: focused facade command before implementation failed with ERR_MODULE_NOT_FOUND for sdk-facade.js.
- GREEN: `node --import tsx --test --test-isolation=none tests/transport/sdk-facade.test.ts`, 9/9 passing. Repository test-isolation=none is required in this environment; default child-process isolation produced an opaque file-level failure.
- `npm run typecheck` and `npm run build` passed (TypeScript, Vite client, server compilation).
- Tests cover deny without store/loader calls; forced options; fresh construction; API/result restriction; malformed/oversized/excess-cookie credentials; sync/async SDK failures; persistence failure; concurrent create; timeout and close with late disposal; explicit refreshed-cookie persistence; current-jar validation; sanitized send/listener errors; timeout bounds.
- A real CredentialVault and actual tough-cookie CookieJar run with synthetic secrets in a private temporary directory and injected fake login. SDK credential mutation leaves saved identity intact; jar updates persist; encrypted bytes and exposed API JSON omit synthetic secret markers. Temporary artifacts are removed.

## Limits

Fake login evidence does not establish actual SDK authentication or provider delivery. Timeout fences results and disposes late APIs; it cannot guarantee cancellation of underlying HTTP. Close cannot undo a store write already in flight. The current transport's shared-listener restart race remains a separate integration blocker; this facade does not wire or promote that transport. Hosted CI and independent review belong to the parent workflow. No live-readiness claim is made.

## Independent review corrections

The independent review identified two P1 gaps. Regression-first evidence reproduced both: a delayed generation-A store write allowed generation B to enter write (`2 !== 1` calls while A remained blocked), and a path attachment object reached sendMessage (`Missing expected rejection`). Both tests failed against the original facade in one focused run (9 passed, 2 failed).

Persistence now has an underlying promise write gate that survives caller timeout. Each queued write checks its generation inside the gate before invoking the store. A newer write waits until the old underlying operation settles, and a generation that expires while queued never calls write. Deferred-barrier regressions verify old/new commit order, expired queued work suppression, and explicit-refresh exclusion of concurrent recreation/refresh. This ordering does not cancel an already executing store write.

sendMessage now checks runtime primitive strings: nonblank text limited to 10000 characters (matching server/app.ts text schema), nonblank peer limited to 200 characters (matching application provider/contact ID bounds), and thread type exactly 0 or 1. Objects, path/Buffer attachment payloads, arrays, boxed strings, oversized/blank values and unsupported types reject with the fixed error before any raw SDK call. The maximum approved text length still succeeds.

Final correction verification: focused tests **13/13 PASS**, `npm run typecheck` **PASS**, and `npm run build` **PASS** after both fixes. No real SDK login, provider call or application wiring occurred.
