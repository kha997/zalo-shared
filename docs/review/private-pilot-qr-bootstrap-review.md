# Private pilot QR enrollment and CLI — independent review and dispositions

Reviewed: 2026-11-02. Baseline `7e66b98a7781bd59cbe3a14ba11d8329d80a8dfe` plus the uncommitted QR/bootstrap/private-file/CLI delta. Offline and synthetic only: no live account, QR scan, provider network request or deployment was used.

## Scope

`adapters/zalo/qr-bootstrap.ts`, `server/private-pilot-files.ts`, `tools/pilot-connector.ts`, `tests/transport/qr-bootstrap.test.ts` and `tests/backend/pilot-cli.test.ts`. The reviewer checked the SDK contract, callback handling, abort and deadline paths, credential staging/quarantine, private file modes and symlinks, secret-free output, and whether the tests prove the stated claims.

## Findings and dispositions

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| F1 | P2 | The QR view queue was never drained. `abort()` cleared the file fire-and-forget while a `showPng` write was in flight, and `finally` cleared without waiting, so a slow write could recreate a scannable `qr.png` after the last clear. | **Fixed.** Abort no longer clears directly. The success path and `finally` drain `viewTail` (bounded by 5 s) before the final clear. `showPng` writes an `O_EXCL` temp file and renames, so the accepted path changes atomically. A regression test asserts the observable order `show-start → show-end → clear` with a gated view. |
| F2 | P2 | On win32 `O_NOFOLLOW` is absent and mode checks are POSIX-gated, so the 0700/0600 guarantees do not hold there; `qr.png` used `O_CREAT|O_TRUNC` on the final path. | **Fixed.** QR writes use `O_EXCL` temp + `rename` with a mode check on the open handle. `liveBootstrap` refuses to start on any non-Linux host, so the pilot cannot run where the private-file invariants are unenforced. POSIX-only tests remain explicitly gated. |
| F3 | P3 | Only the leaf directory was inspected; a swappable symlinked ancestor could redirect directory creation, the session temp/rename and the QR write. | **Fixed.** Private directories must have `realpath(directory) === resolve(directory)` on POSIX, on top of the leaf non-symlink/mode/owner checks. A regression creates a symlinked ancestor and expects refusal. |
| F4 | P3 | The exported bootstrap entrypoint trusted its caller's grant for freshness and attestations; a grant valid at manifest parse could be used for the full 120 s bootstrap and was never rechecked before the checkpoint write. | **Fixed.** Bootstrap revalidates purpose, account shape, both attestations, timestamp format/order, clock skew and expiry at entry and again immediately before `sessionStore.write`. The deadline is injectable for tests but capped at 120 s. Regressions cover expired, future-issued, malformed, inverted and unattested grants with zero SDK loads, plus a deadline abort. |
| F5 | P3 | Quarantine failures were swallowed, so an unknown/partial checkpoint could remain at the accepted path while the run reported a generic failure. | **Fixed.** A failed quarantine raises a fixed `quarantine-unconfirmed` code after the view is cleared. The CLI maps that code to a distinct safe gate value, so the operator sees that the host must be inspected; no path, ID or credential is printed. |
| F6 | P3 | The private manifest, which carries real UID/peer IDs, was read with plain `readFile`: unbounded, symlink-following, no mode/owner check. | **Fixed.** The CLI default reader now uses `readPrivateTextFile` (non-symlink regular file, 0600/owner on POSIX, 1 byte–64 KiB). Injected readers remain available for offline tests. |
| F7 | P3 | Ciphertext `*.tmp` files left by a killed writer were never swept. | **Fixed.** `PrivateSessionFile.write()` removes stale `<basename>.*.tmp` siblings before installing; single-writer ownership makes this safe. A regression plants a stale temp and asserts it is gone after the next write. |
| F8 | P3 | Test gaps: the type-4 cookie equalled the final jar value, so "final jar only" was unproven; the interrupted-write assertion was `>= 1`; no deadline test; no tail-ordering test; POSIX-only file checks. | **Partially fixed.** The event cookie is now a distinct sentinel and the test asserts it never reaches the persisted record. Deadline, tail ordering, quarantine failure, ancestor symlink, stale temp and private-manifest checks were added. The interrupted-write case intentionally asserts `>= 1` because a late install after the first quarantine triggers a second quarantine; POSIX mode/symlink assertions remain Linux-hosted by design. |

No P0 or P1 finding. The reviewer confirmed that no path logs, returns or persists raw cookies, UID, QR bytes or session material outside the encrypted store and the 0700 `qr.png` view file, and that every ordinary failure collapses to a fixed error.

## Verification performed

- `npm run typecheck`: PASS.
- Focused suites: **26/26** PASS (`tests/transport/qr-bootstrap.test.ts`, `tests/backend/pilot-cli.test.ts`).
- Full local suite: **229 tests, 227 PASS, 2 FAIL** — both are the known Windows-only `tests/transport/vault.test.ts` POSIX mode/rename assertions (`438 !== 384`, `EPERM rename`); Linux CI previously passed the same tests.
- `npm run build` (tsc, Vite client, server compile): PASS.
- Hosted CI for this commit: pending; recorded in `docs/READINESS.md` once available.

## PASS / FAIL / UNPROVEN

| Claim | Status |
|---|---|
| Dry-run default, no vault/SDK/DB/network; live needs the explicit flag and a matching, unexpired grant | PASS locally |
| Ownership before view/SDK/store; no `saveToFile`/retry/listener start/send; bounded canonical PNG; callback rejection | PASS locally (fake SDK) |
| Final UID and final cookie jar only; staged encrypted write; view drained then cleared; quarantine signalled | PASS locally (file/fake view) |
| Private modes, non-symlink leaf and ancestors, stale-temp sweep, private manifest reader | PASS locally on POSIX; not enforced on win32, and the pilot host refuses non-Linux |
| Real `zca-js` login/QR rendering, phone scan, final session interoperability | UNPROVEN — requires Owner-authorized live pilot |
| Pilot runtime dispatch, separate SDK-bearing image, live ban risk | NOT IMPLEMENTED / UNPROVEN — Task 4 and Task 5 |
