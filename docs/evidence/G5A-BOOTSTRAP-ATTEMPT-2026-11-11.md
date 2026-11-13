# G5-A — Single QR bootstrap attempt (2026-11-11)

**Date:** `2026-11-11T00:54:32Z`–`00:54:45Z`
**Authorization:** the Owner's single G5-A QR bootstrap authorization (verified HEAD `bb295af`)
**Authorized window:** `2026-11-11T00:52:00.000Z`–`2026-11-11T01:22:00.000Z` (UTC)
**Verdict:** **`G5A_BOOTSTRAP_FAIL`**
**Classification:** `gate=unavailable`, `reason=redirect-denied`, detail `redirect-after-hop`
**Consent / grant:** `G5A-OWNER-AUTH-2026-11-11T0052Z` / `g5a-enroll-2026-11-11T0052Z` (consumed, not reused)
**Correlation id:** `87a17e09-4212-46f9-b569-8c4ffdd3711d`

One attempt, one QR, one scan. No retry, no second grant, no second QR, no alternative flow,
no reconciliation.

## 1. Preflight (all mandatory checks passed before contact)

| Check | Result |
| --- | --- |
| Actual UTC inside the window | PASS (`00:54Z`) |
| Ownership | `idle`, epoch 8 (fenced pair `af5048a8-…`/7 preserved) |
| Provider | `disconnected`, gap 8, `reconciliation_required=false` |
| Session material | `session.enc` absent, `session.key` present |
| Competing connector/worker | none (container list and host processes empty) |
| Unresolved work / advisory locks | 0 / 0 |
| Identity sessions | 0; one idle `zs_app` TLSv1.3 pool session from the application |
| Application / gateway | `running healthy` / `running healthy` |
| PostgreSQL TLS | `sslmode=verify-full` in both private env files; live session TLSv1.3 |
| Rotated credentials | application authenticated with the rotated `zs_app` password |
| Network boundary | `ops/local/check-pilot-network.sh`: all assertions PASS; four hosts exactly `id.zalo.me`, `jr.chat.zalo.me`, `jr.zaloapp.com`, `wpa.chat.zalo.me`; no `chat.zalo.me` |
| Deployed artifact | `zalo-shared-connector:g5-ci-8d9e39d`, image `sha256:220982a7…`, uid 65532; embedded `sourceCommit 8d9e39d…`, lock `17dcd254…`, SDK integrity `sha512-pBU0T0/…Ox4pgA==`; archive hash `d416e76f…` verified at staging |
| Windows viewer channel | rehearsal PASS: session 1, interactive, valid fixture shown, corrupt fixture refused, staged copy removed |
| Grant binding | offline image preflight `ok:true`, `gate=admitted`, `purpose=enroll-session`, expires `01:22:00Z` |

## 2. Timeline (UTC)

| Time | Event |
| --- | --- |
| `00:54:30` | Windows viewer started; session 1, interactive |
| `00:54:32` | Connector command started through the reviewed compose |
| `00:54:35.589` | `start` |
| `00:54:35.675` | `ownership-acquired` (epoch 9), `owner-checked` |
| `00:54:36.391` | `sdk-loaded`, `login-requested` |
| `00:54:36.650` | Gateway tunnel 1 admitted: `id.zalo.me:443` |
| `00:54:36.927` | `qr-shown`; QR written to the private view file (0600) |
| `00:54:38` | Viewer staged and showed the QR in a foreground window, session 1, 399×399 |
| `00:54:43.171` | `scanned` — the Owner scanned with the official Zalo A phone |
| `00:54:44.895` | Gateway tunnel 2 admitted: `jr.zaloapp.com:443` |
| `00:54:44.986` | `failed`: `request=redirect-follow`, `redirect=redirect-after-hop`, `source=jr.zaloapp.com`, `destination=jr.chat.zalo.me`, `hops=1` |
| `00:54:44.993` | Ownership fenced `uncertain` epoch 9 (`fault=shutdown`); audit rows 32/33 (`connector.reserved`, `connector.uncertain`) |
| `00:54:45` | Connector exited 1; container removed; viewer closed (`viewer-close source-cleared`) |

The reviewed policy admitted the single validated `checkSession` redirect to
`jr.zaloapp.com`, then refused the provider's **second** redirect from
`jr.zaloapp.com` to `jr.chat.zalo.me`. No tunnel to `jr.chat.zalo.me` was opened
(the refusal happened before egress), so provider contact was limited to
`id.zalo.me` and `jr.zaloapp.com`.

## 3. Owner-side outcome

- The scan itself succeeded (`scanned` stage); the phone-side approval was not
  sufficient, as expected, because the SDK handshake failed closed afterwards.
- No UID was ever obtained, displayed or recorded; no display-name confirmation
  was requested and no `confirm` input was accepted.
- No encrypted session was written (`session.enc` absent); no account data,
  message, contact, media or peer was touched.
- The official phone was not altered; no session was stored anywhere, so there is
  nothing to revoke and nothing to log out.

## 4. Post-state (read-only)

| Field | Value |
| --- | --- |
| `connector_ownership.phase` | uncertain |
| `owner_id` / `owner_label` | `0280fd84-9026-4c91-bda2-7e16013ee7dd` / `pilot-enrollment` |
| `epoch` / `fault_code` | 9 / `shutdown` |
| `uncertain_at` | `2026-11-11T00:54:44.993048Z` |
| `last_fenced_owner_id` / `last_fenced_epoch` | `af5048a8-41c7-46b3-920c-310855d6c911` / 7 |
| `provider_state.status` | disconnected |
| `reconciliation_required` / `gap_version` | true / 9 |
| `provider_state.fault_code` | `shutdown` |
| audit rows | 33 (31 → 33: one `connector.reserved`, one `connector.uncertain`) |
| `session.enc` | absent |
| QR view directory | empty; staged Windows copy removed |
| connector container / host process | none |
| application / gateway | `running healthy` / `running healthy` |

Reconciliation is required. None was performed: the reconciliation authority was
consumed on 2026-11-11T00:20Z and this authorization forbids automatic
reconciliation.

## 5. Disclosures and cleanup deviations

1. **Staged QR copy.** After `viewer-close source-cleared`, the staged Windows copy
   `C:\Users\Admin\pilot-private-qr\qr.png` was still present; it was removed
   manually at approximately `2026-11-11T01:00Z`. It was a dead, already-scanned,
   single-use code and never left the host. The viewer window itself closed at
   `00:54:45Z`.
2. **Grant wiring reverted.** The private interpolation file was pointed at the
   consumed grant for the attempt; it was restored atomically afterwards to the
   synthetic `g5-synthetic/manifest.bootstrap.json` so no live grant is wired.
   The consumed manifest remains in the private `g5-enroll` directory as evidence.
3. **Second hop is an Owner policy question.** The failed destination
   (`jr.chat.zalo.me`) is one of the four admitted hosts, but the reviewed policy
   follows exactly one redirect. Extending it to a second hop would be a policy
   change requiring review; nothing was loosened during execution.

## 6. Non-actions

- No retry, extension, rescheduling or second request; the window was used once.
- No gateway, firewall, allowlist, compose or image change; no `chat.zalo.me` contact.
- No session, UID, QR or credential was committed, published or uploaded.
- No G5-B observe, G5-C send-test, message/media processing or contact discovery.
- No reconciliation, database repair, deployment, PR merge or G2 usage.

## 7. Next step

The pilot is fenced `uncertain` at epoch 9, gap 9, `reconciliation_required=true`.
A further bootstrap requires (a) a separate Owner authorization for one
reconciliation through the reviewed API with a new UTC window, and (b) an Owner
decision on the observed two-hop handshake (`jr.zaloapp.com` →
`jr.chat.zalo.me`) before any new enrollment grant. No retry is permitted under
this authorization.
