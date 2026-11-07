# Final SDK foundation review

2026-10-28. Independent whole-delta review against local baseline `370c55d` (remote baseline `259644df`), before hosted gates. Reviewed the staged SDK foundation changes, `docs/plans/sdk-foundation.md` global constraints/tasks, artifact audit, facade report and both scoped reviews. Inspected the facade and its regressions, existing transport and CredentialVault, actual-SDK probe, package/lock pinning, build configuration, Docker/CI changes and readiness/pilot claims. No implementation edits, dependency execution, login, QR, network, credentials or production actions were performed. Only this review document was added.

## Findings

- **P0: none identified.**
- **P1: none remaining identified.** The initial stale-persistence and arbitrary-message-payload findings are closed by the reviewed changes and recorded focused regression evidence.
- **P2: none identified within this delta.**

## Specification verdict

**PASS for the reviewed offline foundation; hosted acceptance remains pending.** The exact development dependency and lazy, explicitly authorized facade meet the intended development scope. This is not completion of every plan gate or approval to connect an account.

The facade denies before store access/loading unless authorization is exactly true, forces the three safe constructor flags, validates and clones credential inputs, retains identity independently and persists the current bounded cookie snapshot before API exposure. Ordinary SDK/store errors and listener error events become fixed errors without raw causes. The returned send method validates primitive text/peer and supported thread types before SDK invocation; result projection exposes only message IDs. Inbound messages remain transport input and pass through the existing normalization boundary.

Generation checks prevent late login results from exposing an API. The underlying write chain survives caller timeout; validity is checked inside queued callbacks, so expired queued sessions cannot write and an earlier running write cannot commit after a newer write through this facade. Explicit refresh excludes overlapping creation/refresh. Close is terminal and disposes the active listener. These properties do not establish HTTP cancellation, cross-instance/process storage exclusion or cancellation of an already running store write.

The facade structurally matches the transport's `approvedSdk.createApi` contract. The existing transport still restarts the same listener and has the documented SDK socket-close race; durable inbound handling and coordinated transport/facade shutdown remain integration work. Neither application nor worker imports the facade/SDK, and production server compilation and Docker source copies exclude adapters. The SDK is an exact devDependency, installs/prunes disable lifecycle scripts, and CI checks package absence inside the built runtime image. Those static boundaries support the intended exclusion; actual image/prune success awaits the new hosted run.

## Quality and evidence verdict

**PASS within the stated scope.** The new regressions assert observable call exclusion, commit ordering and invalid-input rejection, using deferred barriers for the write interleavings. Existing scoped evidence distinguishes injected fake login from actual ESM/CJS import/model execution. The probe installs denial hooks before SDK import, self-checks network guards and Node permission denial for writes/children, and never calls login or QR. It is evidence about the exercised import/model paths, not a general hostile-code sandbox or authenticated SDK behavior.

Readiness and pilot documents correctly keep hosted advisory/signature verification, broader integration and the SDK-free image gate pending. CI uses explicit bash with pipefail semantics for evidence pipelines and retains artifacts even on failure. Registry metadata signatures are not represented as completed signature verification. Published gitHead is distinguished from the research revision, and the deprecated CryptoJS dependency remains an explicit promotion gate.

The supplied-license review records 31 resolved package paths and 32 supplied files, including nested semver resolution. It retains the supplied spark-md5 WTFPL notice without claiming the absent MIT LICENSE2 was supplied. Notice presentation normalizes line endings/trailing whitespace while inventory hashes describe original file bytes; these serve different purposes and do not imply byte-identical rendered notices or comprehensive legal clearance.

The parent reports 13/13 facade tests, 34/34 combined offline cases, 2/2 actual-SDK probe cases and a fresh `npm ci --ignore-scripts --offline` plus build passing. The scoped follow-up independently records four correction regressions passing. This reviewer inspected those tests and reports without rerunning unchanged suites or claiming independent reproduction of those counts. `git diff --cached --check` passed during this review. No claim of actual authentication, delivery, provider capacity or production readiness follows from this acceptance.
