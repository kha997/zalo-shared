# G5-A — Single QR bootstrap attempt (2026-11-11T14:43Z)

**Date:** `2026-11-11T14:43:48Z`–`14:46:31Z`
**Authorization:** `OWNER AUTHORIZATION: ONE G5-A QR BOOTSTRAP, 30-MINUTE HARD WINDOW`
**Authorized window:** `2026-11-11T14:43:00.000Z`–`2026-11-11T15:13:00.000Z` (UTC)
**Verdict:** **`G5A_BOOTSTRAP_FAIL`**
**Classification:** `gate=unavailable`, `reason=qr-expired`
**Consent / grant:** `G5A-OWNER-AUTH-2026-11-11T1443Z` / `g5a-enroll-2026-11-11T1443Z` (consumed, not reused)
**Correlation id:** `e955e4b3-44e6-46e3-aaf3-6f3d94c8d053`

One attempt, one QR, zero scans. No retry, no second QR, no second grant, no
alternative flow, no reconciliation.

## 1. Preflight (before provider contact)

| Check | Result |
| --- | --- |
| Actual UTC inside window | PASS (attempt began `14:44:49Z`) |
| Ownership | `idle`, epoch 10, owner null |
| Provider | `disconnected`, gap 10, `reconciliation_required=false` |
| Session material | `session.enc` absent, `session.key` present |
| Competing connector/worker | none |
| Unresolved work / advisory locks | 0 / 0 |
| Identity sessions | 0 |
| Application / gateway | `running healthy` / `running healthy` |
| PostgreSQL TLS | `sslmode=verify-full` |
| Rotated credentials | present in the private env file |
| Network boundary | `check-pilot-network.sh`: all assertions PASS; four hosts exactly `id.zalo.me`, `jr.chat.zalo.me`, `jr.zaloapp.com`, `wpa.chat.zalo.me` |
| Deployed artifact | `zalo-shared-connector:g5-ci-d6f8aec`, image `sha256:d2a85b19…`, config `sha256:9923258e…`, uid 65532; embedded `sourceCommit d6f8aec…`, lock `17dcd254…`, SDK integrity `sha512-pBU0T0/…Ox4pgA==` |
| Windows viewer channel | `viewer-session id=1 interactive=True` |
| Grant binding | offline image preflight `ok:true`, `gate=admitted`, `purpose=enroll-session`, `lifetimeMs=1751645`, expires `15:13:00Z` |

No mandatory preflight failure. The attempt proceeded inside the window.

## 2. Timeline (UTC)

| Time | Event |
| --- | --- |
| `14:43:48.355` | Enrollment manifest issued for this window; bound to the deployed image identity |
| `14:44:36` | QR viewer started (attempt `g5a-20261111T1443Z`); session 1, interactive |
| `14:44:49.788` | Connector `start` (diagnostic correlation `e955e4b3-…`) |
| `14:44:49.860` | `ownership-acquired` (epoch 11), `owner-checked` |
| `14:44:50.331` | `sdk-loaded`, `login-requested` |
| `14:44:50.465` | Gateway tunnel 1 admitted: `id.zalo.me:443` |
| `14:44:50.757` | `qr-shown`; QR written to the private view file (0600) |
| `14:44:51` | Viewer staged and showed the QR in a foreground window: session 1, topmost, visible, 399×399 |
| `14:44:52` | Guard logged `removed-staged`; no viewer close or timeout line was written |
| `14:46:30.759` | Provider QR lifetime (100 s) elapsed with no `scanned` stage → `failed`, `reason=qr-expired` |
| `14:46:30.766` | Ownership fenced `uncertain` epoch 11 (`fault=shutdown`); audit 37/38 (`connector.reserved`, `connector.uncertain`) |
| `14:46:30.985` | Gateway tunnel 2: `id.zalo.me:443` (expiry poll) |
| `14:46:31` | Connector exited 1; run container removed; console closed |

The diagnostic file records exactly two provider tunnels, both to `id.zalo.me`.
There was no `jr.zaloapp.com`, `jr.chat.zalo.me` or `wpa.chat.zalo.me` tunnel,
which is consistent with the scan never having happened.

## 3. Owner-side outcome

- No `scanned` stage was recorded; the QR was never scanned within its 100-second
  provider lifetime.
- No UID or display name was obtained, displayed or recorded; the terminal
  `confirm` prompt was never reached and no input was accepted.
- No encrypted session was written (`session.enc` absent); no account data,
  message, contact, media or peer was touched.
- The official phone was not altered. No provider session was created, so there
  is nothing to revoke.

## 4. Viewer observation (disclosed)

`viewer-shown` was logged at `14:44:51` with `session=1 topmost=True
visible=True offscreen=False`, then at `14:44:52` the guard logged
`removed-staged` and the viewer never wrote a `viewer-close`, `viewer-timeout`
or `viewer-refused` line. Its run file was gone at the final check, and no
viewer process remained.

This is consistent with the viewer process ending about one second after it
displayed the QR — in this run the viewer was started from a background shell
that exited as soon as `viewer-shown` arrived, and the window did not survive
the shell's teardown. It is also possible that only the staged copy was removed
while the window stayed up. The evidence cannot distinguish the two, and both
are recorded as a residual risk.

Because no scan occurred, the attempt failed on the provider QR lifetime
regardless of which viewer explanation holds. In accordance with §6 of the
authorization, **no second QR was generated** and no retry was attempted.

## 5. Post-state (read-only)

| Field | Value |
| --- | --- |
| `connector_ownership.phase` | uncertain |
| `owner_id` | `1c6bebbb-3605-4bb6-957d-798951bf73bb` |
| `epoch` / `fault_code` | 11 / `shutdown` |
| `uncertain_at` | `2026-11-11T14:46:30.766Z` |
| `provider_state.status` | disconnected |
| `reconciliation_required` / `gap_version` | true / 11 |
| audit rows | 38 (36 → 38: one `connector.reserved`, one `connector.uncertain`) |
| sessions | 0 |
| `session.enc` / `qr.png` / `quarantine` | absent / absent / absent |
| view directory | empty |
| connector / worker container | none |
| application / gateway | `running healthy` / `running healthy` |
| Manifest pointer | restored to the synthetic manifest immediately after the attempt |

Reconciliation is required before any further bootstrap.

## 6. Residual risk and next steps

- **Viewer lifetime.** The automatic viewer must survive the operator shell that
  launched it. A fix should launch it detached from any short-lived background
  shell, and the attempt should not start the connector until the viewer is
  proven alive across the whole QR lifetime. The next rehearsal must include a
  launcher that exits immediately after `viewer-shown`.
- The QR's 100-second provider lifetime leaves little margin for a human to
  notice the window, pick up the phone and scan; the next attempt should start
  only with the Owner at the screen and the phone unlocked.
- Because the fence is `uncertain` at epoch 11, a new Owner-authorized
  reconciliation (epoch 11 → 12) is required before another bootstrap
  authorization can be used.
- No live handshake exists; the phone-side login outcome remains UNPROVEN.

## 7. Verdict

The single authorized attempt ran inside the window, passed every preflight
predicate and reached `qr-shown`, but the provider QR expired unscanned. The
fenced state is preserved, no session or account data exists, the viewer and QR
copies are gone, and no retry occurred.

**`G5A_BOOTSTRAP_FAIL`**
