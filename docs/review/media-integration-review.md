# Typed outbound media integration independent review

Verdict: **no remaining P0/P1/P2 identified in the reviewed media source; accepted conditionally on hosted SQL/HTTP/recovery CI**. This is an injected outbound-media implementation review, not actual Zalo upload, inbound-download, ownership or production acceptance.

## Scope and method

Reviewed the media delta against local29b2606: transport/provider/worker, separate facade and pure validator, app/database binding migration, media/sentinel/provider tests, independent four-staff HTTP media flow, guarded SDK probe and its permissions, bound-media recovery fixture and backup assertions. Read the Task1/Task2 plans/reviews and actual pinned SDK attachment/send envelope already inspected there. Concurrent ownership changes are outside this verdict and must be excluded from a media-only snapshot or reviewed independently before inclusion. No production edits, SQL attempts, real SDK login/upload, external network, account or customer data were used in this review.

## Findings resolved during integration

The coordinator identified a blank-text mismatch before this review concluded: provider `.trim()` accepted newline/tab-only text as skippable, while worker SQL `btrim()` removed spaces only. That would mark a legitimate attachment-only message unknown before its first media call. The current worker selects the stored text only when attachments and nonzero delivery parts exist, then uses the same JavaScript `.trim()` check. The SQL media-worker regression now enqueues `"\n\t "` and requires skipped text followed by sent media. The source correction is present; execution of that SQL regression remains a hosted-CI requirement.

No additional concrete P0/P1/P2 was established in the final inspected source.

## Integrated reasoning

- Enqueue retains original request UUID order in explicit delivery-part bindings under the existing authentication/idempotency transaction. Nullable legacy bindings are not guessed. The provider validates contiguous parts0..N, null text binding, at most5 attachments, exact unique bindings to the same message/account and all metadata/bytes before text. Metadata row locks persist through preparation; the worker commits before invoking the external transport. Foreign, missing, extra, unsupported or legacy media fails preparation without any SDK-shaped call.
- Source bytes are bounded at5MiB each/25MiB per prepared message, cloned privately and normalized before dispatch. The prepared cache is released in worker cleanup. This is a payload bound, not a claim that peak process memory is25MiB: database buffers, private snapshots and per-call validation copies can coexist. There is no arbitrary local path/URL source and no raw inbound URL download.
- The separate facade attachment call constructs exactly one canonical Buffer attachment with blank text. Its response must contain null text plus exactly one valid attachment ID; extra SDK result material and raw errors are discarded. The pure PNG/JPEG/PDF/text checks are explicitly header/UTF-8 validation, not full decoding, malware detection or document-safety proof.
- Transport text/media share a private per-call cancellation Symbol, generation/API identity gate and bounded deadline. Only validation/missing capability or a private pre-invocation generation cancellation returns failed. Once invocation occurs, exceptions, timeout and malformed/multiple acknowledgements remain unknown. A late completion does not change an already-returned unknown result, and stop does not claim to cancel an upload.
- The existing worker preserves sent/skipped parts, journals each accepted ID transactionally, links exact early/late echoes to the original staff actor and holds ambiguity without automatic resend. Media tests require confirmed text/first media to survive a later unknown media result and a second worker pass to execute zero further calls. Existing generic process-crash coverage remains relevant; a dedicated multi-media SIGKILL observation is not newly demonstrated locally.
- The four-staff HTTP test uses independent authenticated sessions and concurrent idempotency retries, original PDF/text order, private upload/download and cross-owner negatives, exact early media echoes, thread-scoped repeated provider IDs, native unsupported actor-null projection and invalidation blocking. These are synthetic API clients with an injected SDK-shaped API; successful execution will not establish four physical phones/workstations or actual provider delivery.
- The recovery fixture adds a nonempty attachment/part/provider-ID association and known synthetic bytes. Backup refuses an absent positive fixture and verifies the same association/content after fresh restore; existing full-row fingerprints cover all attachment bytes and delivery-part columns. The fixture remains guarded to disposable mock CI use.
- The SDK probe now dynamically imports the transport only after installing network-denial hooks. Its loader maps exactly the `transport.ts` → `./media.js` edge to `media.ts`; all other resolution delegates unchanged. The CLI adds read permission for that one source file only, retaining no subprocess/write permission and guarded actual ESM/CJS import/model/constructor checks. This does not introduce a login or SDK promotion to production.

## Independent executed evidence

- `npm run test:transport`: **48/48 PASS**.
- `npm run test:sdk`: **2/2 PASS**, guarded actual SDK import/models/constructor only.
- Bounded provider/media/sentinel selection (`node --import tsx --test --test-isolation=none --test-name-pattern='media bridge|actual bridge|SDK bridge preflight|dispatch boundary' ...`): **6/6 PASS**; no PostgreSQL tests selected.
- `bash -n ops/ci-backup-drill.sh`: **PASS**.

Hosted CI must run the new SQL binding/media worker/four-staff media flow, generic worker/crash regressions, migration/runtime-role checks, browser/load, positive bound-media unclean restart and encrypted restore assertions, complete build and SDK-free image smoke. Local EPERM/setup failures are not passes. Inbound media downloading, connector lifetime ownership/takeover fencing, privileged reconciliation, private activation and real-account phone/media/soak tests remain separate required work.
