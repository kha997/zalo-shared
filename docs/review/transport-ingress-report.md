# Fresh transport and observed ingress — offline evidence

The transport now creates a fresh API/listener after interruption and refuses reuse of a listener within one wrapper. Old-generation callbacks are fenced, stopped/late factory results are disposed, connection/factory handshakes are bounded, retry budget remains at most three reconnects, and sends still require a connected event. No SDK import/login is added.

Accepted inbound callbacks run serially with configurable queued+in-flight capacity (default100, max1000). Explicit stop fences new events while accepted work drains. Rejected persistence blocks/retains bounded pending work, stops the listener, exposes a fixed fault and prevents restart without a fresh/reconciled wrapper. Overflow stops new events but drains already accepted work, then drain rejects. No automatic retry or claim of durability before the callback completes is made. Failed fault-observer persistence also stops reconnect rather than concealing a gap. The operator/runtime must still persist gap state and apply takeover fencing.

Validated optional client ID/provider timestamp are retained for evidence; they do not establish safe client-key retry or text/time correlation. Invalid frames/oversized IDs/text fail closed. SDK send timeout stays unknown, never resent. Underlying SDK HTTP cancellation is not established.

## Verification

- Existing transport/facade/vault baseline27/27 passed before edits.
- Initial eight new regressions all failed against the old code: no fresh API creation, concurrent callbacks, missing drain/failure handling, no handshake timeout and undisposed late factory result.
- After implementation the eight passed. A later fault-observer rejection regression failed with two created listeners instead of one, then passed after fail-closed observer handling. A separate factory-timeout/late-result regression also passes.
- Final transport/facade/vault suite37/37 passed; actual guarded ESM/CJS model probe2/2 passed; typecheck passed. Original tests now model fresh listeners instead of asserting SDK-unsafe reuse.
- Provider-store agent ran the complete npm test suite:70tests,47passed and23failed with PostgreSQL connect EPERM. These failures are not concealed; real PostgreSQL behavior must pass hosted CI before integration acceptance.

Actual Zalo login, provider delivery, phone coexistence, media and no-gap history recovery remain UNPROVEN. Defaults still disable the application connector and SDK remains development-only.

## Scoped review corrections

Independent review reproduced two P2s: stale factory results aliasing the active listener could dispose it; immediate stop/restart returned cancelled pending work without a new factory. Both regressions failed before correction (stop count1vs0, factory count1vs2). Disposal now excludes the currently active listener and stop releases the cancelled opening reference while its late result remains fenced. Full transport/facade/vault39/39, actual SDK guards2/2 and typecheck passed after correction; scoped re-review pending.
