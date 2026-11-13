# G5-A — Epoch-7 reconciliation execution (2026-11-11)

**Date:** `2026-11-11T00:05:23Z`–`00:05:38Z`
**Authorization:** the Owner's epoch-7 single-reconciliation authorization (verified GitHub HEAD `674db426`)
**Authorized window:** `2026-11-11T00:05:00.000Z`–`2026-11-11T00:20:00.000Z` (UTC)
**Window reference:** `OWNER-EPOCH7-RECONCILIATION-2026-11-11T0005Z-0020Z`
**Request executed (UTC):** `2026-11-11T00:05:29.085Z`–`00:05:29.606Z` (one HTTP request)
**Verdict:** **`G5A_RECONCILIATION_PASS_AWAITING_BOOTSTRAP_DECISION`**
**Request id:** `521bbecd-f666-4f0d-8e6c-efe73ebcc3ef` (unchanged, not regenerated)
**Evidence reference:** `G5A-OWNER-AUTH-2026-11-10-RECONCILIATION` (unchanged, not regenerated)

Executed by `ops/local/reconcile-20261110.sh execute` around the reviewed driver
`ops/local/reconcile-pilot-state.mjs`. Exactly one authenticated request was sent. No retry,
no replay, no second request, no direct SQL mutation of any control row and no provider
contact. The Owner-supplied private window file carried the exact UTC bounds above and the
authorization reference, and no pinned HEAD; the wrapper recorded the reviewed HEAD itself.

## 1. Reviewed identity at execution

| Item | Value |
| --- | --- |
| Repository HEAD | `eda6c18` (the remote HEAD verified by the Owner was `674db42`; `eda6c18` changed only the wrapper's post-state assertion) |
| Driver blob | `bb7a18cc7baf9307845d378f50bc8a7b6ac79400` (matched the pinned blob) |
| Preflight blob | `b3f342748c64b4d9feaf6a41fcb8f3d9b020f218` (matched the pinned blob) |
| Application image | `zalo-shared:g5-patched-af2be54`, `sha256:989c61541cc95931bef1bd223934032f6d42b5937ff78de62b5e451dc0fbe824`, user `65532:65532` |
| Prepared request | `notSent: true`, bound to owner `af5048a8-…`, epoch 7, gap 7, evidence reference `G5A-OWNER-AUTH-2026-11-10-RECONCILIATION` |
| Uncommitted reviewed source | none (`server`, `connector`, `ops/local`, `dist`) |

## 2. Pre-state and quiescence (read-only)

The wrapper stopped the deployed application first, then proved that no other database session
remained before running the read-only preflight.

| Field | Value |
| --- | --- |
| Database / TLS | zalo / `ssl=true` |
| `connector_ownership.phase` | uncertain |
| `owner_id` / `owner_label` | `af5048a8-41c7-46b3-920c-310855d6c911` / `pilot-enrollment` |
| `epoch` / `fault_code` | 7 / `shutdown` |
| `uncertain_at` | `2026-11-09T13:25:18.446420Z` (prefix `2026-11-09T13:25:18`) |
| `provider_state.status` | disconnected |
| `reconciliation_required` / `gap_version` | true / 7 |
| prior audit rows / max id / `connector.reconciled` rows | 28 / 28 / 3 |
| advisory locks / other active sessions after quiescence | 0 / 0 |
| connector, bootstrap or worker container | none |
| egress gateway | `running healthy`, last event `startup`, zero tunnels |
| private state | session key only; `session.enc`, `qr.png`, quarantine absent |
| reviewed read-only preflight | `ok:true`, all 13 assertions PASS (fencing fields, provider state, empty work tables, one admin, zero sessions, no prior request id, zero locks) |

Quiescence observed: `app=stopped`, zero `pg_stat_activity` sessions other than the preflight
connection, one loopback-only application container started from the reviewed image with no
published port.

## 3. Transaction

| Field | Value |
| --- | --- |
| Route | `POST /api/provider/operations/reconcile` on `http://127.0.0.1:3100` |
| HTTP status | 200 |
| Response | `{"ok":true,"epoch":"8","gapVersion":"8","alreadyApplied":false}` |
| Transport | known (no timeout, `transportUnknown:false`) |
| Expected owner / epoch / gap | `af5048a8-…` / 7 / 7 |
| Applied epoch / gap | 8 / 8 |
| Idempotent replay / retry | none |

The driver ran 20 reviewed checks; all 20 passed, including the exact-incident route check,
the single-use request id, CSRF handling, session closure and the closed-session 401.

## 4. Post-state (separate read-only connection, re-confirmed at `00:07:29Z`)

| Field | Value |
| --- | --- |
| `connector_ownership.phase` | idle |
| `owner_id` / `owner_label` | `null` / `null` |
| `epoch` | 8 |
| `fault_code` / `uncertain_at` | `null` / `null` |
| `last_fenced_owner_id` / `last_fenced_epoch` | `af5048a8-41c7-46b3-920c-310855d6c911` / 7 |
| `last_fenced_at` | `2026-11-11T00:05:29.515344Z` |
| `provider_state.status` | disconnected |
| `reconciliation_required` / `gap_version` | false / 8 |
| `provider_state.fault_code` | `null` |
| users / admins / identity sessions | 1 / 1 / 0 |
| message, delivery and provider tables | all 0, unchanged |
| unresolved work | 0 |
| `connector.reconciled` rows for this request | 1 |
| advisory locks | 0 |
| database sessions after restart | 1: the application's own idle `zs_app` pool connection over TLSv1.3 |

Fencing history is preserved: the prior fence pair `7cc878cf-…`/5 remains in the audit, and
the reconciled incident is recorded as the new fence baseline `af5048a8-…`/7 by the reviewed
driver, exactly as in the previous executions.

## 5. Audit

| id | action | request / reference | UTC |
| --- | --- | --- | --- |
| 28 | `connector.uncertain` (incident, pre-existing) | — | `13:25:18.446420` (2026-11-09) |
| 29 | `auth.login` | — | `00:05:29.424077` |
| 30 | `connector.reconciled` | `521bbecd-…` / `G5A-OWNER-AUTH-2026-11-10-RECONCILIATION`, `7→8`, `7→8` | `00:05:29.515344` |
| 31 | `auth.logout` | — | `00:05:29.546462` |

Totals: 31 rows (was 28), max id 31 (was 28), 4 `connector.reconciled` rows (was 3), exactly
one new reconciliation record carrying the request id. Action history otherwise intact:
4 `connector.reserved`, 4 `connector.uncertain`, 9 `auth.login`, 9 `auth.logout`,
1 `auth.admin_provisioned`.

## 6. Application, gateway and provider boundary

- The application was restarted by the wrapper's cleanup trap and reports `running healthy`
  (container started `2026-11-11T00:05:31.207634782Z`; health confirmed by `00:05:38Z`, still
  healthy at `00:07:29Z`).
- The egress gateway stayed `running healthy`; its log is unchanged from before the run — the
  last line is still the `startup` event at `2026-11-10T14:24:51.654Z` with no tunnels.
- No connector, bootstrap or worker container existed before or after the run.
- No QR, no login to Zalo, no provider request, no observe or send-test, no reconnect.

## 7. Disclosures

1. **Wrapper post-check defect.** The reviewed request succeeded, but the wrapper's post-check
   block then failed on an unbound variable (`prior_reconciled`, line 360) and on an incorrect
   assumption of a `+1` audit-row delta, because the reviewed driver writes three rows
   (`auth.login`, `connector.reconciled`, `auth.logout`). The trap restored the application and
   the single-attempt marker recorded `outcome: verification-failed, exitCode: 1`. The
   authoritative post-state was independently correct. The defect was fixed in `9eedf5c`
   (correct counter names; reconciled rows `+1`, max id advanced) and the marker was **not**
   rewritten, so the single-attempt guard stays closed.
2. **One refused invocation before the window.** An earlier invocation returned
   `outside-window` (exit 2) before the window opened. It stopped nothing, wrote no attempt
   marker and sent no request. The only request is the one recorded above.
3. **HEAD during execution.** The wrapper ran at `eda6c18`, one commit after the Owner-verified
   `674db42`; that commit changed only the wrapper's post-state assertion. The driver and
   preflight executed from the pinned reviewed blobs, and the image digest is unchanged.
4. **G2 residual unchanged.** The unrelated `zalo-shared-g2-postgres-1` stack was not used,
   restarted or modified. The earlier finding remains: the pre-rotation pilot password
   authenticates no g2 role (corrected in the rotation verification addendum), and the two
   stacks shared the value in their environment files before rotation. Credential revocation
   there needs a separately scoped decision.

## 8. Non-actions

- No second request, retry, replay or rescheduling; the window was used once.
- No direct SQL update/insert/delete of ownership, provider or audit rows.
- No Docker volume deletion, no G2 restart, no WSL shutdown or relocation.
- No deployment, image change, allowlist change or PR merge (PR #3 stays draft).
- No secret appears in this report, in the repository or in the sanitized logs.

## 9. Next step

The 2026-11-09 incident is reconciled: ownership is `idle`, epoch 8, gap 8,
`reconciliation_required=false`, with the prior control state preserved in the audit and the
fence history intact. Any further G5-A live bootstrap requires a new explicit Owner
authorization naming a fresh UTC window and a grant bound to the deployed artifact
(`sourceCommit 8d9e39d…`); the epoch-7 reconciliation authority is consumed and expires at
`2026-11-11T00:20:00.000Z`.
