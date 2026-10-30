# UI implementation review

Implemented a Vietnamese React workspace in `client/`: named-user login/logout, role-aware navigation, searchable inbox with status/assignment filters, chronological conversation history with actors, delivery states and private attachment links, compare-and-swap assignment and status actions, agent claim guidance, bounded safe-file upload, admin staff lifecycle and supervisor/admin audit view.

The interface uses local system fonts and original CSS; it fetches actual authenticated API resources. The simulator is identified as “Sandbox · Nhà cung cấp mô phỏng” in the connection panel and a compact Sandbox header badge at all viewport sizes. No real Zalo login, external asset fetch, public endpoint or fixed staff limit is introduced.

Polling runs every two seconds, serializes overlapping requests and aborts on dependency changes/unmount. Session 401 clears credentials and private UI state. Mutation calls include CSRF. One logical message send retains its idempotency key and original payload after transport errors or server uncertainty; the only retry reuses both. Network requests have a 30-second bound. Unknown provider results display a warning and offer no automatic resend. Drafts are scoped to conversations; pending logical sends lock composition until acknowledged or definitively rejected. Pending key/payload is retained in per-user tab sessionStorage across reload, session expiry and logout, and restored only after that same user authenticates; credentials are never stored there. Logout clears in-memory private UI. Safe uploads are restricted in the browser to five PNG/JPEG/PDF/TXT attachments of at most 5 MiB each; authoritative validation remains server-side.

Accessibility includes Vietnamese document language, labeled controls, visible focus outlines, native buttons/forms/selects, status announcements, keyboard operation, reduced-motion support and a narrow-screen list/detail layout with a back button. No external fonts or image assets are needed.

## Evidence so far

- Read `docs/DESIGN.md` and `docs/API.md` before implementation.
- Attempted `npm run typecheck`: blocked because dependencies had not yet been installed (`tsc: not found`). This is a pending check, not a passing result.
- Actual Chromium/screenshots and integrated backend checks are pending QA environment startup. No visual verification claim is made yet.

## Limits requiring review

Polling is eventually consistent rather than a realtime capacity claim. The timeline now supports cursor-based earlier-message navigation; final browser evidence for that follow-up remains pending CI. Provider administration remains an API/operator operation. Audit renders recent records; it does not implement downloadable export. Staff password delivery and initial account setup remain operator responsibilities. Platform readiness remains gated as documented in the design.

## Conversation pagination follow-up

The conversation list requests explicit 50-row pages with `before` cursors and exposes “Tải thêm hội thoại” while `nextCursor` is present. Merging removes duplicate IDs. Two-second polling fetches only the first page, retaining previously loaded pages as snapshots; a visible explanation and “Làm mới danh sách” action reset pagination. The refresh action also retains the selected conversation details. Selection is held separately from the current page so a conversation moving outside the first page does not close its thread. Filter/search/user changes abort pending list requests and reset the cursor; load-more is serialized with polling. Pagination failures are visible and retry through polling or the load-more action.

Validation: `npm run typecheck` executed after this change; client code had no reported errors, but the command failed on `tests/backend/pagination.test.ts:19` (TS7022) and `tests/transport/transport.test.ts:13` (TS7006). Root owns those changes and will repeat integrated checks and browser verification. Existing evidence is under `docs/evidence`; this follow-up has not itself been browser-verified. This is a mock-provider development implementation, with no real Zalo connection or production-readiness claim.


## Final-review F3/F5 remediation

Message history requests 50-row cursor pages and exposes “Tải tin nhắn cũ”. Older results prepend without duplicate IDs; newest-only polling merges into the retained history rather than truncating it. Server page ordering is preserved even where database timestamps serialize to identical JavaScript milliseconds. Loading an older page anchors the previous scroll position; live arrivals follow the bottom only when the reader is already near it. Conversation, search/filter and authenticated-user changes cancel old history requests. Reset immediately aborts history as well as list requests. The selected conversation is refreshed by its individual GET endpoint so moving beyond the first list page does not freeze assignment/version details.

The API helper captures an authentication generation on each request. `setCsrf` advances the generation; a 401 only dispatches global expiration if its request still belongs to the current generation. Login failures remain excluded. Logical send keys/payloads and per-user pending storage are unchanged.

Executed offline: the focused session test first failed with one incorrect expiration, then passed after implementation (1/1); `npm run typecheck` passed after both fixes. Added `tests/e2e/history.spec.ts` for an actual 100-message simulator fixture, an arrival while an older page response is held, retained history after polling, and a delayed old mutation 401 delivered after reauthentication. These browser cases have NOT been run locally; they require the CI app/database/browser environment. The full PostgreSQL suite was not run locally under the explicit no-local-PG instruction. No network permission escalation was attempted. Unread filtering remains explicitly deferred: the UI displays unread badges but has no unread-only filter. No real Zalo or production acceptance claim is made.

## Scoped fix-review R1/R2 follow-up

Replaced insertion-position merging with `client/src/history.ts`: all incoming pages and locally accepted sends deduplicate by ID and sort by the API's exact six-fraction-digit UTC timestamp, then ID, matching database ordering. Newest polling now detects continuity against server-confirmed known history (local sends alone do not establish a boundary). It follows older cursors until it overlaps that boundary. Each invocation fetches at most four 50-row pages; larger gaps retain their own continuation cursor and show “Đang tải bù tin nhắn bị gián đoạn; lịch sử chưa đầy đủ.” Subsequent polls continue that cursor, while the independent older-history cursor remains intact, including an exhausted null cursor. Older-page controls are disabled during catch-up. Failed batches retry without marking missing pages known.

Offline regression evidence: reproduced both review counterexamples before implementation (wrong order `1,2,4,3`; 150/200 messages) and the missing bounded-continuation signal. After the fix, all three focused history tests pass, plus the existing session regression (4/4 total). `npm run typecheck` passes. Browser coverage now creates 100 additional arrivals while message polling is disconnected after exhausting the initial history; it expects all 201 rows and a formerly missing middle message. A separate browser case holds a newest poll, accepts inbound3 and local outbound4, then verifies canonical 1/2/3/4 ordering after releasing the authoritative poll. These updated browser cases have NOT been executed locally; CI/database/browser validation is pending. No local PostgreSQL, network permission grant, real-provider test or production-readiness claim was made.

## Narrow empty-history cursor correction

An empty initial response no longer marks the history boundary initialized. The first nonempty newest response therefore adopts its older-page cursor, making the earlier half of an empty-to-100 arrival batch accessible. Cursor-boundary state is shared between the App and a focused pure regression. That regression first failed with `null !== '0051'`; after the correction all four history regressions plus the existing stale-session regression pass (5/5). Existing bounded catch-up and canonical-order behavior is preserved. No browser, database or network-backed test was executed for this narrow correction.
