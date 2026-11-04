# G5-A — Private diagnostics and reason-code acceptance

**Date:** 2026-11-04
**Scope:** offline/synthetic verification only
**Status:** accepted offline. Not exercised in a live or containerized attempt.

## 1. Closed vocabularies

- **30 reason codes** in `server/pilot-reasons.ts` (`BOOTSTRAP_REASONS`). The
  four added in this change are `login-version-failed`,
  `login-qr-generate-failed`, `login-session-unconfirmed` and
  `login-userinfo-failed`. Every code is a fixed identifier; none can carry a
  UID, QR, cookie, `imei`, user agent or provider text.
- **15 stages** in `BOOTSTRAP_STAGES`, from `start` through `completed`/`failed`.
  A stage names a **passed** checkpoint; the reason names the failure.
- The diagnostic sink accepts only these two sets. `PrivateDiagnosticFile.append`
  rejects any other string (`server/private-pilot-files.ts:553`), so a caller
  cannot smuggle an identifier through a stage or reason argument.

## 2. Failure attribution

`adapters/zalo/qr-bootstrap.ts` maps the pinned SDK's fixed rejection messages to
the exact failing call. Matching is exact or on the message prefix before the
first newline, and **the message is never copied into the error or the log**.

| SDK message (fixed) | Reason code | Meaning |
| --- | --- | --- |
| `Cannot get API login version` | `login-version-failed` | login page/version fetch failed |
| `Unable to generate QRCode\nResponse: …` | `login-qr-generate-failed` | QR generation rejected |
| `Cannot get session, login failed` | `login-session-unconfirmed` | `checkSession` did not return a session (the redirect case) |
| `Can't get account info` | `login-userinfo-failed` | userinfo call returned no data |
| `Can't login` | `login-userinfo-failed` | userinfo says `logged: false` |
| any other rejection | `login-failed` | unattributed provider failure |

`PilotBootstrapError` always carries the fixed message `SDK facade unavailable`;
the code is exposed separately. The CLI (`tools/pilot-connector.ts`, `reasonOf`)
echoes only a code that is a member of the closed set, otherwise it reports
`unavailable`.

## 3. Required coverage matrix

All rows below are asserted by `tests/transport/qr-bootstrap.test.ts` (31 tests)
in the suite "each supported offline failure stops at a named stage with a
closed reason" unless stated otherwise.

| Owner requirement | Scenario | Reason | Last passed stage | Later stages asserted absent |
| --- | --- | --- | --- | --- |
| Redirect rejection | `loginQR` rejects `Cannot get session, login failed` | `login-session-unconfirmed` | `login-requested` | `login-resolved`, `uid-verified`, `identity-confirmed`, `cookie-captured`, `session-written` |
| SDK login rejection | each of the six fixed messages / unknown message | table in §2 | `login-requested` | `login-resolved` |
| Missing device identity | no type-4 event with `imei`/`userAgent` | `login-info-invalid` | `uid-verified` | `identity-confirmed`, `cookie-captured`, `session-written` |
| Missing terminal confirmation | view resolves something other than `true` | `identity-declined` | `uid-verified` | `identity-confirmed`, `cookie-captured`, `session-written` |
| Invalid terminal confirmation | view rejects | `identity-declined` | `uid-verified` | same |
| Cookie validation failure | malformed final jar | `cookie-invalid` | `identity-confirmed` | `cookie-captured`, `session-written`, `qr-cleared` |
| Encrypted session persistence failure | `sessionStore.write` rejects | `session-write-failed` | `cookie-captured` | `session-written`, `qr-cleared` |
| Connector termination (signal) | abort during a pending login | `aborted` | `login-requested` | `login-resolved`, `identity-confirmed`, `cookie-captured`, `session-written` |
| Connector termination (deadline) | login never resolves | `deadline` | `qr-shown` | `login-resolved`, `identity-confirmed`, `cookie-captured`, `session-written` |

The signal case also proves a diagnostic-correctness fix in this change: an
abort that wins the view queue no longer reports `qr-shown` for a QR image that
was never displayed (`adapters/zalo/qr-bootstrap.ts`, the `viewTail` chain).
A separate regression test ("an abort during an in-flight QR display never
reports it as shown") covers an abort that arrives while `showPng` is still
pending; it yields `aborted` with no `qr-shown` or `scanned` stage.

## 4. Diagnostic sink properties

`PrivateDiagnosticFile` (`server/private-pilot-files.ts:538`):

- append-only (`O_APPEND`), owner-only mode `0600`, `O_NOFOLLOW`, refuses a
  symlink or non-regular file, and refuses a parent it does not trust;
- `fsync` after every append, so a line survives process exit;
- maximum 1 MiB, rejected before write when exceeded;
- one JSON line per event: `at`, `stage`, optional `reason`; maximum 256 bytes;
- rejects any stage/reason outside the closed sets and refuses to echo a caller
  string.

The connector CLI enables it only when `PILOT_DIAGNOSTIC_FILE` is an absolute
path (`tools/pilot-connector.ts`), and the path is inside the pilot's private
state area.

## 5. Process-exit survival

Test: "the private diagnostic survives process exit with stages only and no
secrets".

- A child Node process (separate PID, `node --import tsx`) runs the real
  `bootstrapPilotSession` with a synthetic loader that rejects with
  `Cannot get session, login failed`, and appends each stage plus
  `failed`/`login-session-unconfirmed` through the real `PrivateDiagnosticFile`.
- The parent reads the file **after** the child exits. It contains
  `owner-checked`, `sdk-loaded`, `login-requested` and
  `failed`/`login-session-unconfirmed`.
- The file contains none of: the synthetic UID, the synthetic session cookie,
  the event cookie, the provider message text, the `imei` or the user agent.
- Mode is `0600` on POSIX.

This demonstrates the property the Owner required — the diagnostic outlives the
process — at the file-persistence level. It is **not** a container-kill test:
the container volume mount and SIGKILL durability of `fsync` under Docker were
not exercised here.

## 6. QR → terminal confirmation rehearsal (offline)

Test: "a real private view and store persist only a confirmed session".

- Uses the real `PrivateQrFileView` and `PrivateSessionFile` with a private key
  and private directories, not fakes.
- Declined confirmation (`false`): rejects `identity-declined`, writes nothing,
  and the view directory is empty.
- Confirmed: writes exactly one `session.enc` (`0600`), the view directory is
  empty afterwards, and the stored envelope binds the synthetic UID and cookie.
- `promptConfirmation` is separately asserted to fail closed on a non-TTY and
  to accept only the literal word `confirm` (case-sensitive, no trailing text).

The rehearsal covers QR display → scan event → identity prompt → `confirm` →
cookie capture → encrypted write → QR clear. It is synthetic; no real QR was
generated or scanned in this work.

## 7. Not covered

- Live attribution: the new codes are only useful after the connector image is
  rebuilt and a future authorized attempt captures the console and diagnostic
  file. This work does not rebuild or deploy.
- Docker container exit/kill durability (see §5).
- Provider-side reason codes beyond the fixed SDK messages; unknown rejections
  deliberately remain `login-failed`.

**STOP — `G5A_RECONCILIATION_IMPLEMENTED_AWAITING_OWNER_EXECUTION`. No live
attempt, no QR, no session, no observe/send.**