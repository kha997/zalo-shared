# Distroless, monitoring and capacity follow-up review

Reviewed 2026-10-28: `/tmp/zalo-distroless-review.patch` and the corresponding local files, following the compiled-runtime snapshot and hosted commit `393e277`. Scope: runtime base/entrypoints, CI image gate, monitoring validation and the added capacity-observation profile. No live SDK/login, production deployment or external notification was performed.

**Verdict: no new P0/P1/P2 finding in this scoped discovery-stage delta. Conditional acceptance requires the new CI results, retained scan evidence and a committed runtime digest before release.** The current mutable default tag is explicitly an open release gate; the CI-resolved immutable build does not by itself pin future local/Compose builds.

The old scan failure is accurately retained: the baseline JSON contains 83 HIGH/CRITICAL package records, of which 25 have a fixed version. It is not clean-image evidence. Removing the general-purpose OS tools and global npm tree is a reasonable remediation, whose effectiveness must be established by scanning the resulting image.

Entrypoint matrix, assuming the official distroless base's supplied Node entrypoint (upstream identity/documentation verified by the coordinating agent):

| Invocation | Arguments/executable | Review result |
| --- | --- | --- |
| Default image / Compose app | `dist/server/main.js` appended to inherited Node ENTRYPOINT | Consistent with `/app` working directory and emitted output |
| Compose migrate | `dist/server/migrate.js` appended to inherited Node ENTRYPOINT | Correct; owner credentials remain maintenance-only |
| Compose worker | `dist/server/worker.js` appended to inherited Node ENTRYPOINT | Correct; dispatch profile and disabled-provider default retained |
| Runbook seed override | `dist/server/seed.js` appended to inherited Node ENTRYPOINT | Correct; no duplicate Node argument or removed shell/npm dependency |
| Compose app health | Exec-form `/nodejs/bin/node -e ...` | Correct; healthchecks do not inherit the image entrypoint |
| CI `docker exec` health / UID check | Explicit `/nodejs/bin/node -e ...` | Correct; docker exec does not inherit the image entrypoint |

Numeric `COPY --chown=65532:65532` and `USER 65532:65532` avoid dependence on the builder's `node` username. The runtime keeps compiled output and production dependencies, with no new runtime import or native-addon dependency introduced. The current lockfile has 72 production package entries and none marked with an install lifecycle script; the cross-Debian runtime change still requires the actual image smoke. The scanner continues to read a saved archive, and its full HIGH/CRITICAL report and summary remain subject to the existing always-upload artifact step.

CI discovers the base with `docker pull`, records `RepoDigests[0]`, and supplies that exact digest as `RUNTIME_IMAGE` to the build. Release acceptance must commit the observed digest into the Dockerfile default and validate that pinned image; the presently documented tag is suitable for discovery only. The existing nonroot, read-only, dropped-capability smoke remains a required gate. No zero-vulnerability claim follows merely from removing npm or passing the fixability policy; all remaining unfixed HIGH/CRITICAL records require explicit assessment.

Monitoring validation verifies the downloaded promtool checksum before extraction/execution. Temporary token/config files are local and removed on exit. The configuration substitutes real local rule/token paths for validation, and the fixtures match the configured expressions, label aggregation and durations: unknown deliveries, failed scrape after 30 seconds, backlog over 60 seconds sustained for five minutes, and healthy cases. The new backlog metric exists in the server already. No collector, listener, notification receiver or send action is added. Native promtool execution and checksum authenticity were not independently verified by this offline review; hosted CI must provide the actual config/rule output.

The ordinary and sustained workloads still fail above p95 2000 ms or on any request/integrity failure. Only `LOAD_PROFILE=capacity` suppresses latency-based failure for the separately logged 100/200/500-user observation; it retains the measured percentile and `engineeringTargetMet: false`, writes a distinct artifact and still fails on request errors, uniqueness/idempotency failures or queue-drain failure. CI supplies `METRICS_TOKEN`, enabling the drain assertion. The benchmark rate limit of 3000 is confined to CI; the server default remains 10. Extra synthetic fixtures and sends remain in the isolated CI database and increase the subsequent recovery workload. This is HTTP/application observation with a raised login limit, not a product capacity ceiling, real-provider throughput or an SLA.

Offline verification: `npm run typecheck` passed; `bash -n` passed for `check-monitoring.sh` and `scan-image.sh`; changed Compose/CI/monitoring YAML parsed successfully; staged diff whitespace check passed; baseline counts were independently recomputed as 83/25. No new image pull/build/scan, PostgreSQL/browser/load workload or promtool run was performed here. Prior functional results and prior image failure remain separate from the pending new-revision results.
