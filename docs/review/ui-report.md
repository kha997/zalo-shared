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

Polling is eventually consistent rather than a realtime capacity claim. The timeline currently displays the API's default bounded page; earlier-page navigation is not implemented. Provider administration remains an API/operator operation. Audit renders recent records; it does not implement downloadable export. Staff password delivery and initial account setup remain operator responsibilities. Platform readiness remains gated as documented in the design.

## Conversation pagination follow-up

The conversation list requests explicit 50-row pages with `before` cursors and exposes “Tải thêm hội thoại” while `nextCursor` is present. Merging removes duplicate IDs. Two-second polling fetches only the first page, retaining previously loaded pages as snapshots; a visible explanation and “Làm mới danh sách” action reset pagination. The refresh action also retains the selected conversation details. Selection is held separately from the current page so a conversation moving outside the first page does not close its thread. Filter/search/user changes abort pending list requests and reset the cursor; load-more is serialized with polling. Pagination failures are visible and retry through polling or the load-more action.

Validation: `npm run typecheck` executed after this change; client code had no reported errors, but the command failed on `tests/backend/pagination.test.ts:19` (TS7022) and `tests/transport/transport.test.ts:13` (TS7006). Root owns those changes and will repeat integrated checks and browser verification. Existing evidence is under `docs/evidence`; this follow-up has not itself been browser-verified. This is a mock-provider development implementation, with no real Zalo connection or production-readiness claim.
