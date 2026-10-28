# Scoped fix review — round 1

Date: 2026-10-28. Scope: `/tmp/zalo-fix-review.patch` against checkpoint `9ec1e0e`; patch SHA-256 `f1516947c1273d182ac6d7d62ff8afc1c76969434642757f3ef88b0711aff36e`. This is a follow-up to `docs/review/final-review.md`, not a new whole-branch audit. No source changes, network-granted calls, live provider or production activity were performed. Later edits are outside this frozen review.

**Specification verdict: partially fulfilled; simulator acceptance remains open. Quality verdict: request changes for the history merge defects below, then execute final-revision integration gates.** Six of the seven original findings have appropriate source fixes; F3's original absence of a history control is addressed, but its replacement still loses history continuity and can show messages out of order. The separately discovered CI pipeline status bug is fixed in configuration. No P0/P1 finding was identified in this scoped review.

## Original finding disposition

| Finding | Source assessment | Remaining evidence |
| --- | --- | --- |
| F1: 5 MiB regexp overflow | Fixed: bounded decode/re-encode validation in `server/base64.ts` replaces the recursive regexp; canonical alphabet/padding, size and empty input are checked. | Two helper regressions independently passed. Full authenticated maximum upload/download test added; PostgreSQL execution pending. |
| F2: timestamp precision | Fixed: cursor comparison stays inside PostgreSQL at `server/app.ts:469`; no cursor timestamp round-trip through Date. Cursor remains scoped to its conversation. `nextCursor` uses limit+1 correctly. | Existing 100-microsecond regression must pass in final CI. Batched attachment projection preserves the response fields while reducing round trips. |
| F3: last-50-only UI | Partially fixed: history button, page cursor, request cancellation, retained older rows and scroll anchor exist. | R1/R2 below remain. The added browser test covers 100 rows plus one new arrival, not missed batches or concurrent send ordering. Unread filtering remains a separately recorded product gap. |
| F4: worker backlog sleep | Fixed: worker sleeps only when `processed` is false; successful work drains immediately while retaining exclusive worker locking. | Twelve-job/four-second regression and actual queue drain must pass. |
| F5: stale 401 logs out new session | Fixed for the reported defect: API requests capture an auth generation and only current-generation 401 responses emit expiration. Login/reset advance generation. | Independent helper regression passed; delayed old PATCH browser test added, execution pending. Generation also advances on unchanged-token identity polls; that can delay handling of a concurrent current-session 401 until the next poll, but no persistent authorization bypass was identified. |
| F6: restore assertions | Materially fixed: SQL exceptions now fail retained sessions, dispatchable jobs, connected provider or runtime CONNECT; actual denied runtime connection is checked. Restricted runtime DELETE/TRUNCATE/disable-trigger checks fail on unexpected success. | Actual CI execution pending. These checks use a separately provisioned test role; the whole app still runs under owner credentials in CI. They do not establish end-to-end runtime-role operation or restored grants after release. |
| F7: load target exit status | Fixed: `!engineeringTargetMet` participates in failure status. Queue metrics now impose a drain check when METRICS_TOKEN is supplied, as CI does. | Final short and sustained workload measurements pending. Missing metrics token leaves drain explicitly UNPROVEN outside CI. |

**Additional pipeline defect:** `.github/workflows/ci.yml:8–10` sets explicit job-default `shell: bash`. GitHub's explicit Bash invocation includes `-e -o pipefail`, unlike the previous implicit shell. This propagates test/audit/drill failures through `tee`; the explicitly specified browser/load step also has Bash. The preserved first-run evidence confirms 28 tests with 26 passing and two failing (precision 13/100, worker 8/12), despite the previous overall job success. That earlier green job is not accepted as a green suite. The recorded short HTTP load numbers remain bounded observations of that pre-fix revision.

## Remaining actionable defects

### R1 — P2: reconnect with more than one page of arrivals leaves an inaccessible middle gap

Location: `client/src/App.tsx:242–253`.

After a user loads older history, `expanded` is true, so newest polls deliberately leave `cursor` unchanged. Once history is exhausted it is null. If the connection pauses while more than 50 new messages arrive, the next poll returns only the newest 50. The merge appends those to the old history, leaves the cursor null, and offers no way to load the missing interval. Example: loaded messages 1–100, then receive 101–200 while offline. Poll returns 151–200; UI displays 1–100 and 151–200 (150 rows), with no older-history button and no gap warning. This contradicts the expected reconnect/refetch recovery within simulator scope.

Proof: executing the exact merge expression offline with those arrays produced `actualCount:150`, `missing101:true`; the source branch at lines243–246 preserves the exhausted null cursor. No browser or server execution was used for this proof. Resolve newest-page continuity before treating the history as contiguous: fetch intervening pages until a known boundary overlaps, retain an explicit gap cursor, or require a clearly visible bounded resync. Add a browser regression with more than 50 arrivals during a disconnect after all older history was loaded.

### R2 — P2: Map deduplication preserves the wrong insertion position after concurrent send/receive

Location: `client/src/App.tsx:249–253`, interacting with `performSend`'s immediate append of the accepted outgoing message.

For newest results, the code builds `[...previous, ...result.items]` and deduplicates via Map. Replacing a Map key updates its value but keeps its original position. If inbound message3 arrives after the previous poll and the user's send4 is accepted before the next poll, the local timeline is `[1,2,4]`. The authoritative chronological result `[2,3,4]` merges to `[1,2,4,3]`, showing the earlier inbound message after the later outgoing message. Subsequent polls repeat the same insertion positions and do not repair it.

Proof: executing the exact expression offline produced `[1,2,4,3]`. Preserve the authoritative ordering of overlapping server pages when merging, with an ordering representation that retains database microseconds/tie-breaking rather than sorting the truncated ISO timestamps alone. Add a browser test withholding an inbound poll, accepting a later outgoing send, then releasing the authoritative timeline response.

## Independent validation and acceptance limits

Executed during this re-review: base64 tests, client-session test, and transport/vault tests: **15/15 passed**. The two merge counterexamples above were executed offline and reproduced. `npm run build` completed successfully (typecheck plus Vite build); `bash -n ops/ci-backup-drill.sh` also passed. PostgreSQL, browser, load, encrypted restore and image execution were not performed by this reviewer; new CI results must be inspected by assertion counts and final revision, not only job status.

Before simulator acceptance: resolve R1/R2, pass expanded PostgreSQL and browser cases, demonstrate queue drain under the measured workload, and pass enforceable restore/runtime checks with pipefail active. Broader original gaps remain: deterministic in-flight revocation, actual process-kill/partial-media and persistence checks, complete capacity evidence and product unread filtering or documented deferral. The offline transport remains unwired and text/media/phone/history/reconnect/fencing behavior with a real personal Zalo account remains a separately authorized live gate. No production-readiness conclusion is granted.
