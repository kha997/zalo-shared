# Scoped fix review — round 2

Date: 2026-10-28. Reviewed `/tmp/zalo-fix-review2.patch`, SHA-256 `0d0d37c2228310abc10b9439760a9d7b3c5264a439ee199ab3093cc8d0b0d877`, and its source files. Scope: round-1 history findings R1/R2, associated precise message serialization, and new verification sources. No source edits, network-granted commands, PostgreSQL/browser execution or live-provider activity were performed by this reviewer. Later fixes are outside this snapshot.

**Specification verdict: simulator acceptance remains conditional on final-revision CI and the remaining product/evidence boundaries. Quality verdict: the two prior populated-history counterexamples are repaired, with one narrow P2 empty-history residual below.** No new P0/P1 finding was identified. The first CI run's overall success remains invalid as a full-suite result: its raw result was 26 passed and two failed. Explicit Bash/pipefail fixes remain in the new workflow; actual next-run assertions are still required.

## Fix assessment

- **R2, chronological ordering:** `mergeHistory()` deduplicates then sorts exact UTC six-fraction timestamps followed by UUID. Both list and send responses serialize PostgreSQL timestamps with `to_char(... AT TIME ZONE 'UTC', ... US ...)`; this avoids sorting truncated Date values. UUID canonical string ordering matches the database tie order. The original `[1,2,4]` plus authoritative `[2,3,4]` regression and equal-timestamp tie check independently pass.
- **R1, a gap after populated history:** `catchUpHistory()` walks newest pages until an existing server-confirmed boundary overlaps, bounded to four pages per invocation. The component retains an unfinished gap cursor and pending IDs without adding them prematurely to the trusted boundary. New local send responses do not enter that boundary. Older-page requests are blocked during catch-up. The original 100-to-200-message counterexample and a gap exceeding a single catch-up budget independently pass. Visible recovery state and request lifecycle guards are present.
- **Precise backend pagination:** cursor comparison remains SQL-only and conversation-scoped. Batched attachment metadata reads preserve the shape; `nextCursor` uses the extra row and is computed before chronological reversal. No new scoped authorization bypass was identified.
- **Previous fixes:** bounded canonical base64 decoding, idle-only worker backoff, stale-401 generations, restore assertions, load failure threshold and explicit Bash remain present. Prior source disposition stands; PostgreSQL/browser/ops success cannot be inferred from their presence.

## Remaining P2 — First arrivals after an empty timeline lose the older-page cursor

Location: `client/src/App.tsx:256–260`, together with `client/src/history.ts`'s `known.size === 0` early completion.

An initial empty poll sets `initialized=true` while `known` and the UI cursor remain empty/null. If more than 50 messages arrive before the next poll, the helper treats the empty boundary as first-page initialization and returns the newest 50 with a non-null `nextCursor`. The component ignores that cursor because initialization has already occurred. It then records those 50 as known; future newest polls overlap immediately. The earlier messages are not reachable through the older-history button. This affects an initially empty conversation, including the supported synthetic/demo seed, followed by a burst/reconnect; it does not invalidate the fixed populated-history counterexample.

Independent executable reproduction using the real imported helper and the component's state-update conditions: empty initial poll, then 100 rows, yielded `fetchedCount:50`, `serverCursor:'0051'`, `uiCursor:null`, `complete:true`, `oldestVisible:'0051'`. Adopt the older cursor when establishing the first nonempty server history, or delay completion of initialization until that boundary exists. Add the empty-to-more-than-one-page regression at component/state level; helper-only coverage would miss the ignored cursor.

## New verification sources and their limits

The new in-flight revocation test pauses after initial authentication, revokes the session through the real admin route, then asserts 401 and no message/outbox insertion. It targets the actual transaction revalidation boundary rather than only a later request. The child-process crash test records mock acceptance separately, signals IPC, receives actual SIGKILL, waits for advisory-lock release, and asserts unknown statuses, one acceptance and no resend plus a single recovery audit. These are meaningful new regression sources, pending PostgreSQL execution.

The workflow stops app/worker before killing PostgreSQL, restarts it, and compares committed-content fingerprints. This establishes a useful intended unclean-database-restart drill; the fingerprint currently covers attachments/messages/audit/users, not every queue/read-cursor table, and it is not a test of live writes at the instant of database death. Restore checks enforce quarantine and runtime denial, rather than only printing counts. All these stages need final-revision CI results. Multi-part attachment failure and the production runtime role's complete app operation remain outside the new assertions.

## Independent checks and acceptance

Executed independently: base64, client-session, three client-history and transport/vault tests: **18/18 passed**. The empty-history counterexample above was executed separately and reproduced. No fresh build or integration success is claimed by this round's reviewer.

Before simulator acceptance: address the empty-history residual and pass the expanded final-revision PostgreSQL/browser/load/crash/restart/restore checks with pipefail active, inspect raw counts and artifacts, and state unread-filter deferral and workload limits accurately. Existing specification boundaries remain: no hard four-user cap does not establish unlimited capacity; browser contexts do not prove physical workstations; simulator media acknowledgements do not prove delivery of actual provider media. Live authentication, phone coexistence, provider receipts/media/history gaps, reconnect/fencing, and Owner production acceptance remain separate open gates. No live SDK or real-account readiness is granted.
