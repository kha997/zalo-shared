# Transport ingress independent review

Scope: Task2 brief, Task2 review patch, current `adapters/zalo/transport.ts`, both transport test files, implementation report, and guarded actual-SDK ESM/CJS probe. Provider-store files and hosted SQL acceptance are outside this review. No implementation changes, real SDK login, network access, or unchanged-suite reruns were performed.

## Findings

Initial review identified no P0 or P1 findings and two P2 lifecycle defects. Both P2s are resolved in the scoped re-review below; their original evidence is retained.

### P2 — Late factory disposal can stop a currently owned listener

Location: `adapters/zalo/transport.ts:133-138`, reached from `310-311`.

`dispose` protects a listener owned by another wrapper but permits stopping one owned by the current wrapper. A stale factory result can therefore dispose the active generation if the injected factory returns the same listener object for overlapping calls. The reuse guard in `attach` does not run on this stale-result path.

Concrete offline reproduction: let factory call one remain pending until its initialization watchdog rejects `start()`. Call `start()` again and return listener L; emit `connected` on L. Resolve factory call one with an API containing L. After one event-loop turn, L has `starts = 1, stops = 1` while transport status is still `connected`. The newly attached generation has been stopped by stale work. This specifically matters to the explicit object-ownership/reuse protections; it does not require an old listener callback to defeat the token fence.

Suggested correction: stale-result cleanup must not stop any currently owned listener, including this wrapper's active generation. Normal release already removes ownership before disposal. Add an aliasing late-result regression alongside the existing distinct-listener late-factory test.

### P2 — Immediate restart after canceling creation is silently dropped

Location: `adapters/zalo/transport.ts:152-159` and `336-351`.

`stop()` cancels creation but leaves `pending` pointing to the canceled opening until its asynchronous finalizer runs. `start()` called during that interval returns that old promise without clearing `stopped` or creating a new API.

Concrete offline reproduction: use a pending factory; execute `const first = t.start(); t.stop(); await t.start();`. The second start resolves with `creations = 1` and status `disconnected`; it does not initiate a replacement connection. This also affects ordinary immediate stop/restart sequences while an opening is settling. The public start/stop interface exposes no restart delay requirement.

Suggested correction: distinguish canceled pending work from the active opening, so a start after stop initiates a fresh generation (or chains an explicit fresh start after cancellation). Preserve token checks and identity checks on pending cleanup. Add a regression asserting a second factory invocation and successful fresh connected event.

Both observations were confirmed using a short synthetic Node script importing only the transport and Node EventEmitter. Its output was:

```text
late same-owner API disposal { status: 'connected', starts: 1, stops: 1 }
immediate restart { creations: 1, status: 'disconnected' }
```

## Spec and quality verdict

Initial verdict: changes requested for the two P2 races. Final scoped verdict: both are resolved, with no remaining P0/P1/P2 findings identified in this review. The main fresh-listener, generation-fencing and bounded-ingress implementation matches the bounded task reviewed here:

- Interruption detaches old handlers and stops the old listener; reconnection obtains a fresh API, with at most three scheduled reconnects. Used listeners are rejected on attachment, and stale callbacks cannot mutate the new generation.
- Factory and handshake watchdogs have finite bounds; stop clears scheduled retry/handshake work and cancellation settles the opening. Late distinct-listener results are disposed. The ownership alias and immediate restart cases above need stronger handling.
- Inbound work is serialized with a queued-plus-in-flight bound. Explicit stop and overflow preserve accepted work for draining. Persistence rejection retains the failed event and subsequent accepted events in bounded memory, blocks further work, and makes drain reject; this is an explicit failure outcome, not a durability or no-loss guarantee.
- Inbound rejection, asynchronous listener start/stop rejection, and fault-observer rejection have handlers. The fault observer failing closes transport without recursively invoking the failing observer. Drain reports the ingress fault when awaited.
- Optional client IDs and provider timestamps are retained only as bounded nonempty strings without NULs. The actual-model probe expects those fields for ESM/CJS constructors while preserving numeric inbound-ID rejection and offline guard assertions. Metadata is not treated as retry permission or self-attribution proof.

The implementation report records passing transport/facade/vault, actual SDK probe, and typecheck results; this review did not rerun those unchanged checks merely for counts. Existing tests cover the principal interruption, serialization, overflow, rejection, timeout and late distinct-object paths but omit both reproduced lifecycle races. Hosted SQL validation remains separately pending. Nothing in this review establishes real-provider delivery, no-gap history recovery, or live application readiness.

## Scoped re-review of the two P2 corrections

Reviewed the actual changed disposal and stop paths, both new regression tests, and the appended implementation evidence. No implementation edits, network operations, or redundant suite reruns were performed.

- **Late alias disposal: resolved.** `dispose` now immediately returns when the result aliases `api.listener`, preventing stale creation cleanup from stopping the active generation. Normal release clears `api` and removes ownership before disposal, so intended stop behavior remains reachable. The new stale-factory-alias regression reproduces the timeout/new-generation/late-alias ordering and asserts no stop and connected status.
- **Immediate restart: resolved.** `stop` now clears the canceled `pending` reference. A following `start` can create a fresh generation immediately. The previous opening retains its token fence and late-result disposal; its identity-checked finalizer cannot clear a newer pending opening. The new immediate-stop/restart regression asserts two creations, no old listener start, one fresh listener start, and successful connected status.

The implementation evidence records both tests failing before correction and passing afterward, followed by 39 transport/facade/vault tests, two actual SDK guard/probe tests, and typecheck. This scoped re-review accepts both corrections and closes the initial findings. Acceptance applies to Task2's offline transport/ingress scope only; the separately pending hosted SQL validation and unproven real-provider behaviors remain outside this verdict.
