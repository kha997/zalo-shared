# Private inbound media worker library

Implemented only the injected `runMediaDownloadOnce` library and its tests. No executable, scheduler, SDK authentication, provider configuration, public endpoint, actual CDN request, real account/customer bytes, production action or commit was introduced.

## API and admission

`runMediaDownloadOnce(pool, {owner, cipher, policy, download?, maxDownloadedBytes?})` returns `{processed:boolean}`. `owner` is the existing `OwnershipHandle`, `cipher` is the locator cipher, `policy` is the reviewed downloader policy, and the optional trusted `download` injection has the existing `downloadMedia` signature. Production defaults to `downloadMedia`; an empty approved-host set never invokes a GET. The storage budget defaults to250MiB and accepts1byte..10GiB. Each response is independently checked against the configured limit and the absolute5MiB boundary, then validated/cloned by the existing media validator.

Admission requires a current, locally admitted ACCOUNT owner and a matching active owner/epoch row. Both are checked before decrypting/claiming and again after GET before completion. Provider reconciliation must be false before GET and before materialization. Revoked ownership, a newly observed gap, a stale job version or conflicting event cannot produce ready bytes. Only exact canonical descriptors and linked messages are eligible; held/unprojected self events are never guessed.

## Concurrency and transactions

- Two in-process slots remain occupied until each GET promise settles, including after a media database-session loss. Two dedicated database session lane locks use `(73003,0)` and `(73003,1)`; each candidate additionally holds `(73005,hashtext(validatedJobUUID))` through GET. Hash collisions conservatively serialize unrelated work rather than relaxing admission. These controls assume the existing single admitted connector and external-fence trust boundary; they are not external-network fencing.
- Pool acquisition and each query have2s deadlines. A failed/hung client is destroyed and never returned reusable with session locks. Late acquisition/query results cannot restore permission. Normal clients explicitly unlock and remove their observers before pool release.
- Claims and completion lock owner, conversation, event and job. Completion takes quota lock `(73004,1)` **before** provider-state SHARE lock, matching receipt quota-before-provider ordering and avoiding a different-conversation deadlock. The hosted test explicitly queues that interleaving. Ordinary claim provider SHARE locks do not wait on quota and end before GET.
- An unlocked processing job can be recovered for a bounded download attempt; another live job on the other lane cannot be reset because its per-job lock remains held. At most3 claims/GET attempts are allowed, including conservatively consumed claims that lose permission before actual GET. Only network/timeout failures become pending with bounded backoff; policy/address/content/response/key failures become unavailable. Versions saturate into a terminal unavailable gate rather than wrapping.
- Attachment insertion, ready/attachment linkage, locator removal and audit commit together. Lost acknowledgement after a committed ready transaction cannot trigger another GET; a failed transaction leaves recoverable processing state with no fabricated ready attachment. Budget accounting counts distinct ready, locally downloaded `owner_id IS NULL` attachments, excluding already-owned staff upload reuse.

The library performs no SQL read or write against outbox, delivery parts or provider ledger. It invokes the existing `linkEventMedia` helper solely for its established exact accepted-part attachment reuse. It never changes message send status or actor attribution. Native downloaded attachments have NULL staff ownership and remain accessible only through the existing authenticated attached-file policy.

## Expiry and error boundary

No locator aged24h is used for GET; its ciphertext is cleared on a worker pass. This is invocation-driven cleanup, **not a guarantee of wall-clock purge while the connector is stopped**. A scheduled retention sweep and metadata retention policy remain Task4. Ready jobs clear ciphertext immediately. Failed unexpired locators remain encrypted for supervised recovery, with no automatic retry for permanent failures. All download error codes are whitelisted; raw exceptions, locator URLs, tokens, keys and names are not put into worker errors/audit.

## Evidence and limits

- Initial RED invocation failed because `server/media-worker` did not exist.
- Ten controlled/pure tests PASS: validation before database/GET, lane contention, safe acquisition errors, single ready result, malformed content as permanent failure, late owner/gap refusal, fixed error codes, two slots held across database-end and late GETs, exhausted versions, late pool acquisition and late advisory query disposal.
- Controlled SQL fakes demonstrate JavaScript boundary/ordering behavior only; they are not PostgreSQL transaction or concurrency evidence.
- Six real-PostgreSQL scenarios are authored in `media-job-flow.test.ts`: exact private materialization/native attribution/no send-state changes; one-job contention/two distinct jobs/crash recovery; expiry/key/content/budget/attempt limits; owner loss after GET; rollback versus committed-acknowledgement loss; quota/provider lock ordering with a concurrent different-conversation receipt. They remain **UNPROVEN until hosted CI**. No repeated local PostgreSQL attempt was made after the established EPERM restriction.
- Prettier checks and server compilation passed. Global typecheck passed earlier; a later coordinating run was blocked only by concurrent unowned `media-private-api.test.ts:73` implicit-any work. Final shared typecheck status is recorded below once that task settles.

No actual CDN/schema compatibility, global production throughput, physical phone operation, external egress fencing or production readiness is established. Independent review and hosted SQL/restart/restore/private-UI acceptance remain required before integration is accepted.

Final shared `npm run typecheck` and `npm run build:server` both exited0 after the concurrent API test settled. Owned sources are formatted and untracked/unstaged; no commit or publication performed.
