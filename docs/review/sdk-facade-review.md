# SDK facade independent review

2026-10-28. Reviewed Task2, Global constraints and Review focus in `docs/plans/sdk-foundation.md`; facade implementation, its nine tests and report; published-artifact audit; relevant actual `zca-js@2.2.0` send implementation at `/workspace/zalo-study/npm-2.2.0/package/dist/apis/sendMessage.js`; and CredentialVault write behavior. No SDK import/login, network, real credentials, application wiring or production action was performed. Only this review file was written. Existing unchanged test/typecheck/build results were read, not rerun.

## Findings

### P1 — A timed-out persistence operation can overwrite a newer session

Locations: `adapters/zalo/sdk-facade.ts:104`, `:254`, `:262` (generation check at `:105` happens after the write).

Scenario: generation A logs in and enters a slow `sessionStore.write(A)`. The creation timeout fires, rejects creation, disposes A and clears `busy`, although its write is still running. Creation B is then admitted, reads the store, logs in, persists B and returns a usable API. A's write subsequently commits, replacing B with stale credentials. The post-write generation check rejects A but cannot undo the stale commit. The real vault uses independent temporary files and unconditional rename, so its atomic file replacement does not prevent this ordering. This violates concurrent-create/persist isolation; it is more than the documented limitation that close cannot undo an already started write.

A focused offline stdin probe with injected SDK/store and a deferred first write produced:

```text
new persisted generation2
after stale commit generation1
```

Keep the persistence exclusion in force until underlying writes settle, independently of caller timeout. A retry may reject while old work drains; alternatively use serialized writes or a storage revision/CAS contract that prevents stale commits. Add a regression covering timeout during persistence, retry before old completion, and stale completion after newer work. Include overlapping explicit persist/recreate rejection. Do not describe underlying operations as serialized solely because Promise.race has settled.

### P1 — The purported text-only API forwards arbitrary SDK message objects

Location: `adapters/zalo/sdk-facade.ts:220-223`.

Scenario: a JavaScript caller, deserialized value or TypeScript `any` passes `{msg: "", attachments: ["/private/example.txt"]}` as the first argument. The `text: string` annotation is erased and no runtime check occurs; the facade passes the object directly to `raw.sendMessage`. Actual published SDK `dist/apis/sendMessage.js:410-443` explicitly accepts these objects and branches into attachment handling; the artifact audit documents local path reads/upload and partial-send risks. Hiding separate upload methods therefore does not establish a text-only boundary. Peer and thread type are likewise unchecked.

The same offline probe passed this object to the facade and confirmed the injected raw SDK received it (`object passed to raw SDK object true`). No file read/upload was attempted.

Validate arguments before any raw SDK invocation: primitive string text and peer, appropriate nonempty/size rules, and supported thread enum values. Reject objects, arrays, boxed strings and unsupported enum values with the existing sanitized error. Add tests asserting zero SDK calls for invalid inputs, particularly path and Buffer attachment objects. Preserve only explicitly approved text behavior.

## Spec-compliance verdict

**Changes required before Task2 acceptance.** No P0 findings. Two P1 findings above undermine the requested concurrency and narrow text boundary. The facade remains an offline development candidate and is not wired to server/worker; these findings do not claim a currently exposed production vulnerability.

Source review supports default deny before store/loader; forced safe constructor flags; fresh constructors; bounded cloned credential inputs and identity separation; private getCookie/getContext; sanitized ordinary store/SDK/validation failures and listener error events; generation checks and late-login disposal; cloned, validated refreshed-cookie snapshots persisted before API exposure; and shutdown on snapshot/write failures. The existing tests give injected evidence for those paths, including real-vault encryption with synthetic values. They do not cover the two reproduced scenarios. The default-deny test explicitly supplies false rather than omitting the option, although the implementation's strict true check correctly denies omission.

The underlying HTTP cancellation limitation and actual SDK shared-listener restart race remain accurately scoped limitations, not proof of live readiness. This review does not repeat the separate actual-SDK import probe, dependency audit, or hosted CI work. No actual authentication, live delivery or production readiness is established.

## Follow-up review — both P1 findings resolved

2026-10-28. This follow-up supersedes the initial acceptance verdict above while retaining the initial findings as review history. Scope was limited to the two fixes and their regression integrity.

**Persistence ordering: RESOLVED.** Current `adapters/zalo/sdk-facade.ts:76` and `:106-113` retain an independent promise chain for underlying writes. Caller timeout cannot release that chain. The validity check executes inside the queued callback before the store is invoked; expired/closed queued generations cannot commit. The rejection handler permits subsequent valid writes after old work settles without masking the caller's failure. An already running old write may finish, but it must finish before a later write begins, eliminating the demonstrated stale-over-new commit order within this facade. This does not claim cross-facade/process exclusion or cancellation of already executing storage operations.

**Text boundary: RESOLVED.** Current `adapters/zalo/sdk-facade.ts:231-241` validates primitive, nonblank text and peer with 10000/200 character bounds and thread type exactly 0 or 1 before calling the SDK. Attachment objects, arrays, boxed strings and unsupported types cannot reach the broad SDK send API through this wrapper. A plain string resembling a path remains ordinary text, as intended.

Regression inspection found assertions on observable behavior: a blocked old write prevents newer store invocation; final commit order is old then new; a generation expiring in the queue never invokes the store; explicit refresh excludes recreation/overlapping refresh; invalid send inputs make zero SDK calls and return the sanitized error; maximum accepted string bounds succeed. Deferred barriers control the relevant write interleavings rather than assuming the first write has begun after a sleep. The historical first failure evidence is recorded in `sdk-facade-report.md`; this review did not independently rerun the original implementation.

Independently ran only the four added regressions:

```sh
node --import tsx --test --test-isolation=none --test-name-pattern='timed-out persistence|text boundary|timed-out queued|explicit refresh' tests/transport/sdk-facade.test.ts
```

Result: **4 passed, 0 failed**, exit 0. Implementer reports the complete facade suite 13/13, typecheck and build passing; those unchanged broader checks were not repeated here.

**Updated scoped verdict: PASS; both initial P1 findings closed, no remaining findings in this follow-up scope.** Task2's reviewed offline facade boundaries are acceptable subject to the separate hosted CI and parent acceptance workflow. This does not clear the documented transport integration blocker or establish actual authentication, live delivery, or production readiness. No SDK login/network or implementation edits were performed; only this review document was updated.
