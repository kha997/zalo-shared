# Private inbound media read projection and UI

Implemented safe read/UI projection only; no download scheduling, worker invocation, network request to Zalo/CDN, session/key configuration, retry mutation, real account or deployment.

## Changes

- Message list and new authenticated `GET /api/messages/:id` expose at most five allowlisted media statuses with decimal versions and valid same-message/account attachment IDs. Queries match job, event, message and conversation identity. Locator envelopes, fingerprints, keys, URLs and arbitrary job fields are never serialized. Unsafe URL/query-shaped names become a fixed filename and unrecognized error strings become a fixed code. Existing API no-store/session behavior and attached-file authorization remain.
- The single-message endpoint refreshes an older message outside the newest50-message polling window. Normal newest-page polling remains the common update path; old rows require the explicit read-only “Kiểm tra tệp” action. There is no push/history-completeness guarantee.
- The focused component shows pending/downloading/held/unavailable states. Ready files use the existing authenticated local download links. Refresh cannot trigger a provider download or resend. Abort/generation guards fence unmount and late callbacks; bigint version and attachment-preservation checks prevent delayed reads from erasing a newer ready file. Parent merging changes only file metadata/attachments, preserving independently updated captions, staff identity and delivery status.
- An explicit safe `mediaPlaceholder` flag hides only the generated unsupported literal backed by an unsupported media-descriptor event with exact provider-ID linkage and NULL author. Staff captions and uncaptured unsupported messages remain visible. Native author wording is retained.

## Evidence

- RED: focused projection test failed because the safe projection export did not exist.
- GREEN: two focused cases PASS: no locator/token/arbitrary-error leakage, five-item cap and ready-attachment requirement; delayed-read version/attachment/cross-conversation protection.
- `npm run typecheck`: PASS after explicit Fastify response annotation.
- Full client/server `npm run build`: PASS; final following edits were test-only, formatting and projection provenance clarification with final typecheck PASS.
- Scoped `git diff --check`: PASS. No repeated local PostgreSQL/browser/listener attempt was made under the known EPERM limitation.

The authored real SQL/API scenario uses four distinct staff accounts, private pending metadata, old-message refresh beyond50newer rows, ready private bytes/nosniff, anonymous denial, cross-account job/message/attachment denial, unattached-owner isolation and preservation of staff captions. It remains **UNPROVEN until hosted CI**; no four-browser or actual phone claim is made here.

The receipt schema needs an index on `(account_id,message_id,item_index,id)` to keep this bounded projection efficient as ready history grows; root was notified to add it in the receipt phase. Queue budgeting, encryption, downloader correctness, materialization and backup/restore are separate reviewed components.

Owned files: server/app.ts; client/src/api.ts/App.tsx/InboundMediaStatus.tsx/styles.css; tests/backend/media-private-api.test.ts; this report. No staging, commit or push.
