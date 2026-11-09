# G5-A single authorized bootstrap attempt — 2026-11-09

**Verdict:** `G5A_BOOTSTRAP_FAIL` — the one authorized attempt ended `redirect-denied`
before the login handshake completed. No session was stored, no delivery work exists and
the fenced ownership now requires the reviewed reconciliation. There was no retry.

## 1. Authorization

| Field | Value |
| --- | --- |
| Consent reference | `G5A-OWNER-AUTH-2026-11-09T1312Z` |
| Authorized UTC window | `2026-11-09T13:12:00.000Z` – `2026-11-09T13:42:00.000Z` |
| Attempts authorized | exactly one, no automatic retry |
| Stages authorized | bootstrap only (no observe, no send-test) |
| Grant | `g5a-enroll-2026-11-09T1312Z`, purpose `enroll-session`, expires `2026-11-09T13:42:00.000Z` |

## 2. Artifact

| Field | Value |
| --- | --- |
| Image | `zalo-shared-connector:g5-ci-1052466` |
| Source commit | `10524666274704daa8e940a9ddad13719a56a967` |
| CI run | [42602520323](https://github.com/kha997/zalo-shared/actions/runs/42602520323) |
| Archive sha256 | `a9d2f2440ead231c5b86e5975ce262554a1bb454bdd0bfd4b885794ed701cb76` |
| Lock sha256 | `17dcd25426639f7112b80764bc8aa27f9be2af3acf0aaf0f2cd490c434030c9b` |
| SDK integrity | `sha512-pBU0T0/…` (reviewed zca-js 2.2.0) |

The grant and the manifest build block name the same commit, lock hash and SDK integrity as
the image's embedded `build-identity.json`; a mismatched manifest would have been refused.

## 3. Preflight (offline, before provider contact)

```
network precondition: zalo-shared-pilot-db is internal=true
{"command":"preflight","ok":true,"gate":"admitted","purpose":"enroll-session",
 "accountBound":false,"peerCount":0,"maxPartsPerDay":10,"minIntervalMs":2000,
 "lifetimeMs":1084539,"expiresAt":"2026-11-09T13:42:00.000Z"}
```

State at launch: ownership `idle` epoch 6; provider `disconnected` gap 6
`reconciliation_required=false`; zero sessions; zero outbox rows; zero provider-ledger rows;
no connector container; application and gateway healthy; four-host allowlist unchanged; DB
`verify-full`; diagnostic sink present. The Windows viewer channel was confirmed live
immediately before launch: interactive session 1, foreground window `TopMost`, staged copy
removed on close.

## 4. Execution timeline (UTC)

| Time | Event |
| --- | --- |
| 13:24:39 | QR viewer started, waiting for the source file |
| 13:25:05 | Connector launched once in a PTY session |
| 13:25:07.161 | `start` |
| 13:25:07.290 | `ownership-acquired` (epoch 7) |
| 13:25:07.296 | `owner-checked` |
| 13:25:07.629 | `sdk-loaded` |
| 13:25:07.629 | `login-requested` (provider contact begins) |
| 13:25:08.325 | Gateway `sni_allow` for `id.zalo.me` → `49.213.95.230` (only tunnel opened) |
| 13:25:09 | QR emitted, staged to the Windows viewer (399×399 PNG) |
| 13:25:10 | QR shown in a foreground window, session 1, `TopMost` |
| 13:25:16.544 | `scanned` — the Owner scanned the QR with the official phone |
| 13:25:18.441 | `failed` `redirect-denied` |
| 13:25:18 | Connector exited (exit code 1, container removed) |
| 13:25:19 | Source QR cleared by the connector; viewer closed and removed its staged copy |

Console result:

```
{"command":"bootstrap","ok":false,"gate":"unavailable","reason":"redirect-denied",
 "purpose":"enroll-session","expiresAt":"2026-11-09T13:42:00.000Z"}
```

## 5. Refusal detail (closed vocabulary)

```
{"stage":"failed","reason":"redirect-denied","request":"check-session",
 "redirect":"unexpected-location","source":"id.zalo.me",
 "destination":"jr.zaloapp.com","hops":0}
```

After the QR was scanned, the SDK's `check-session` request to `id.zalo.me` returned a
redirect to `jr.zaloapp.com`. That host is not in the reviewed four-host inventory
(`id.zalo.me`, `wpa.chat.zalo.me`, `jr.chat.zalo.me`, `chat.zalo.me`), so the connector's
fetch policy refused the hop before any connection to it. The gateway opened exactly one
tunnel (`id.zalo.me`, one `sni_allow` line); there is no gateway record for the refused
destination. This is the intended fail-closed behavior; the policy was not changed in
response. No URL, path, query, cookie, token, QR payload or UID is recorded here.

## 6. Post-state

| Item | Value |
| --- | --- |
| `connector_ownership` | `phase=uncertain`, `epoch=7`, `uncertain_at=2026-11-09T13:25:18.446Z`, `fault_code=shutdown` |
| `provider_state` | `disconnected`, `gap_version=7`, `reconciliation_required=true`, `fault_code=shutdown` |
| Sessions | 0 |
| `session.enc` | absent |
| Outbox / ledger | 0 / 0 |
| Connector container | none (removed) |
| QR source file | cleared (view directory empty, 0700, uid 65532) |
| Windows staged copy | removed; viewer logged `viewer-closed cleanup=final` |
| Viewer process | terminated; no `qr.png` remains in the stage directory |

No authenticated session exists, so there is nothing to revoke from the phone; any pending
phone-side prompt refers to a login that never completed. The ownership fence is preserved
as-is: no reconciliation reset, no grant reuse and no second connector were attempted.

## 7. What this establishes

- The reviewed CI-built artifact runs under the deployed topology and reaches only the
  admitted provider host.
- The automatic Windows QR handoff works end-to-end against a real QR: emitted inside the
  private state directory, staged by the reviewed viewer, shown in the interactive
  foreground session, and cleared on failure.
- The Owner scanned a real, single-use QR within the window.
- The remaining blocker is a provider-side redirect target, `jr.zaloapp.com`, that the
  reviewed allowlist deliberately does not admit. Resolving it requires an Owner decision
  on the redirect policy (a reviewed allowlist extension with gateway pin, guard policy and
  regression tests), not a runtime workaround.

## 8. Required next steps (not authorized here)

1. The reviewed admin reconciliation for the fenced state (`epoch 7 → 8`, `gap 7 → 8`,
   return to `idle`, `reconciliation_required=false`) in a new explicit Owner window.
2. An Owner decision on whether `jr.zaloapp.com` may join the reviewed provider inventory,
   with independent review of that change before any further live attempt.
3. A new single-attempt authorization after both are complete. No retry is implied by this
   report.
