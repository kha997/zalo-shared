# G5-A credential rotation and security closure — 2026-11-10

**Status:** `G5A_CREDENTIALS_ROTATED_RECONCILIATION_READY`

Authority: Owner directive "PRIVATE-PILOT CREDENTIAL ROTATION AND RECONCILIATION
PREPARATION ONLY" at HEAD `375a253`. The two credentials exposed through the
2026-11-09 Docker recovery backup were treated as **potentially exposed, not as
evidence of confirmed compromise**. Both were rotated inside the dedicated
private pilot. No reconciliation, QR, provider contact, observe/send test, SQL
repair of ownership or provider state, production deployment, PR merge, volume
deletion, host-wide shutdown or secret disclosure occurred.

No secret value — old or new — appears in this document, in the console output
of any step, in git, or in CI.

> **Verification addendum — 2026-11-10, later the same day.** An independent re-verification
> of this rotation is recorded in
> [G5A-CREDENTIAL-ROTATION-VERIFICATION-2026-11-10.md](G5A-CREDENTIAL-ROTATION-VERIFICATION-2026-11-10.md).
> Two statements below are corrected there and remain in place only as the historical record:
> the pilot password is **not** accepted by the g2 stack (§1 — the shared-value finding was an
> environment comparison; authentication probes against g2 `zs_app` and `zalo_owner` are
> rejected), and the copy scan in §5 missed two further copies of the old values (a stale
> `<PILOT_PRIVATE>/app.env`, which is also the g2 compose environment file, and one Qoder
> transcript), both redacted in place afterwards. No part of this document was rewritten.

## 1. Dependency inventory (read-only, before rotation)

| Credential | Consumers found | Decision |
| --- | --- | --- |
| `zs_app` database password | `pilot-db/secrets/app.pw` (source of truth, `root:systemd-journal` 0440), `pilot-app/app.env` `DATABASE_URL`, `pilot-db/secrets/pilot-connector.env` `DATABASE_URL`, the running application container (`zalo-shared-pilot-app-1`) | Rotated |
| `METRICS_TOKEN` | `pilot-app/metrics.token` (source, 0600), `pilot-app/app.env` `METRICS_TOKEN`, the application's `/metrics` bearer check | Rotated |
| Pilot admin HTTP credential | `pilot-admin/admin.env` (`PILOT_ADMIN_EMAIL` / `PILOT_ADMIN_PASSWORD`) | **Not rotated** — separate credential, outside the exposure |
| `zs_owner` PostgreSQL role | used only by the reviewed provisioning/preflight scripts over the local socket | **Not rotated** — different role; not in the exposed DSN |
| TLS material, session key | `pilot-db/pki/*`, `pilot/session.key` | **Not touched** |
| Stale renderings | a root-owned `app.env`, `g3.env` and `g3-container.env` from earlier generations | **Not modified** — not read by any running container |

**Unmitigated finding.** The pilot `zs_app` password also authenticates the
unrelated `zalo-shared-g2-postgres-1` stack (`shared_with_g2 = true` at the
preflight). §4 prohibits rotating unrelated service credentials, so it was left
alone and is reported for a separate decision. The pilot password is now
independent of it; the g2 stack still holds the old value in its own private
env file, which is outside this pilot's authority.

Boundary check: `log_statement=none`, so the `ALTER ROLE` is not logged. Before
rotation the database showed zero advisory locks and the application's single
idle `zs_app` pool session, which is expected. After rotation the PostgreSQL log
contains exactly six authentication failures, all for `zs_app`: five during the
four rotation attempts' rejection probes at `14:56:50Z–14:58:11Z` and one during
the independent rejection test at `15:10:46Z`. No other user, host or window
recorded a failure; there is no evidence of unauthorised use.

## 2. Procedure

Reviewed script `ops/local/rotate-pilot-credentials.sh`
(`sha256 34c6f4c1…7a9bf918`), uncommitted at run time and committed with this
record. It generates both values locally, alters the role through
`docker exec -i … psql` over stdin (never argv or console), proves the new value
authenticates and the old one does not over `sslmode=verify-full`, atomically
replaces the four consumer files (`install`/`printf` to `.new` + `mv -f`,
0600), recreates the application through the reviewed
`ops/local/deploy-pilot-app.sh`, then verifies health, metrics auth, TLS and the
fenced control state. Any failure after the `ALTER ROLE` restores the previous
password, the previous files and the previous rendering.

| Attempt (Z) | Outcome |
| --- | --- |
| 14:56:50 | Aborted: the staged secret files had not been written; rollback verified |
| 14:57:18 | Aborted: the deploy script is not executable (invoked through `bash` now); rollback verified after a connector-env repair |
| 14:57:51 | Aborted: the new consistency check included a file the deploy step had not yet rendered; rollback verified |
| 14:58:11–14:58:24 | **Succeeded** |

Result: a new 48-character URL-safe database password and a new 43-character
metrics token, independent of each other and of every other credential.

## 3. Old credential rejected, new credential accepted

Run independently of the rotation script, using the **exposed values read from
the backup file itself** as the test inputs (staged into a 0600 file and deleted
afterwards; no value printed):

| Test | Result |
| --- | --- |
| Exposed DSN password over `sslmode=verify-full` | `password authentication failed` |
| Current DSN password over `sslmode=verify-full` | accepted (`select 1` = 1) |
| Exposed `METRICS_TOKEN` against `/metrics` | HTTP 401 |
| Current `METRICS_TOKEN` against `/metrics` | HTTP 200 |

The exposed and current values are distinct (`old_pw_equals_new = false`,
`old_tok_equals_new = false`).

## 4. Post-rotation verification (independent, read-only)

| Check | Result |
| --- | --- |
| `pilot-postgres`, application, egress gateway health | `healthy` / `healthy` / `healthy` |
| Application image and identity | `sha256:989c6154…fbe824`, user `65532:65532`, started `14:58:14Z` |
| Consumer files consistent | `app.env`, connector env, `app.pw`, `metrics.token` all carry the same current values; all 0600; DSN `sslmode=verify-full` |
| Provider flags | `PROVIDER_MODE=disabled`, `MOCK_ENABLED=false` |
| Application database session | one `zs_app` backend, idle, `ssl=true`, `TLSv1.3` / `TLS_AES_256_GCM_SHA384`, opened after the rotated container started |
| Egress gateway | running/healthy; last log line still the `14:24:51Z` `startup` event; no tunnel; sole uplink member |
| Connector / bootstrap containers | none; no `session.enc`, `qr.png` or quarantine artefact; `session.key` intact |
| Control state (separate read-only transaction) | `uncertain`, epoch 7, owner `af5048a8-41c7-46b3-920c-310855d6c911`, fault `shutdown`, `uncertain_at` `2026-11-09T13:25:18…Z`; provider `disconnected`, gap 7, `reconciliation_required=true` |
| Audit | 28 rows, max id 28, 3 `connector.reconciled`, incident prefix intact |
| Work and locks | unresolved work 0, advisory locks 0 |
| Networks | database and egress networks internal; uplink carries only the gateway |

No flag was reset and no reconciliation was performed.

## 5. Backup hygiene

ACLs re-verified at `15:2xZ`: `D:\WSL-Backups\recovery-2026-11-09` and its
`logs` directory are `inheritance=False` with only `SYSTEM`, `BUILTIN\Administrators`
and `DESKTOP-U0Q31VK\Admin`; no `BUILTIN\Users`, `Everyone` or sandbox account
appears. The VHDX backup was not read for content, moved or altered.

A scan with the original values taken from the live backup record covered:

- the WSL private tree and the repository — 571 files, 0 matches;
- all 132 commits of the repository (`git grep -l` over every revision) — 0 matches;
- `D:\WSL-Backups`, the Qoder project store and `%TEMP%` — 7,485 text files,
  **2 matches**: the backup record and one past subagent transcript.

Both copies were rewritten in place at byte level with same-length
`[REDACTED-ROTATED-2026-11-10]` placeholders, so the surrounding structure and
byte offsets are preserved:

| File | Before (sha256) | After (sha256) | Size |
| --- | --- | --- | --- |
| `…\logs\inspect-before.json` | `3700491b…f45d6c314` | `ccbfe44c…423f0d30c` | 40,931 B (unchanged) |
| `…\subagents\agent-ageneral-purpose-70416dff5ee50e79.jsonl` | `fb131377…e8b4247f` | `83fbe942…63b707b8` | 522,359 B (unchanged) |

After rewriting, the record still parses as the original three-container
inspection document with 33 environment entries, and the DSN keeps its scheme,
role, host and database with only the password replaced. A second scan for the
**new** values over the same five roots found them only in the three intended
live consumer files (`pilot-connector.env`, `metrics.token`, `app.env`); no
transcript, log or artifact carries them.

## 6. Reconciliation preparation (not executed)

`ops/local/reconcile-20261110.sh` (`sha256 0f3fd68c…a6b5dc`, syntax-checked,
not run) wraps the reviewed `ops/local/reconcile-pilot-state.mjs` for the epoch-7
incident. It:

- pins the reviewed driver blob `bb7a18cc…`, preflight blob `b3f34274…` and the
  deployed image digest, and refuses a dirty reviewed tree;
- binds the incident to owner `af5048a8-…`, epoch 7, gap 7, fault `shutdown`,
  `uncertain_at` `2026-11-09T13:25:18`, last-fenced `7cc878cf-…`/5 and three
  prior reconciliations, and to the prepared request
  `521bbecd-…` — refusing if that request is marked sent;
- takes the window **only** from the Owner-supplied private file
  `…/pilot-admin/reconcile-window-20261110.json` (`notBefore`, `notAfter`,
  `authorizationRef`, optional `head`); the file does not exist yet and no
  window is hardcoded;
- enforces the window against the process clock, holds a host `flock`, records a
  single-attempt marker before any action and never retries;
- quiesces `zalo-shared-pilot-app-1`, proves zero other database sessions, runs
  the reviewed read-only preflight, starts one loopback-only application
  container from the reviewed image, invokes the admin route once, removes that
  container, restarts the deployed application in place and independently
  verifies `idle/epoch 8/gap 8/reconciliation_required=false`, the +1 audit row,
  zero advisory locks and zero unresolved work.

`preflight` mode is read-only and reports `app_quiesce_required=1`. Execution
still requires a separate Owner UTC window and explicit confirmation.

## 7. Unrelated infrastructure

No non-pilot container was started, stopped, created or removed by this
directive. Running containers afterwards: the pilot PostgreSQL, the pilot
application, the pilot egress gateway and the unrelated
`zalo-shared-g2-postgres-1`, which was already up. No image, volume, build cache
or VHDX was deleted or relocated; no WSL compaction, shutdown or relocation was
attempted.

## 8. Residual risks and decisions for the Owner

1. **Shared g2 secret.** The old pilot password still authenticates the
   unrelated g2 stack; rotating it requires a separate, g2-scoped authorization.
2. **Metrics token scope.** `METRICS_TOKEN` guards only the loopback `/metrics`
   endpoint; the new token is not stored by any monitoring component.
3. **Backup record.** The sanitized `inspect-before.json` remains as forensic
   structure with redacted values; the original bytes are not recoverable from
   it, which is the intended, documented cleanup.
4. **Reconciliation window.** The wrapper is ready but not executable until the
   Owner creates the window file and opens a UTC window.
5. **Pre-existing residuals** remain unchanged: `C:` free space, the invalid
   `D:` VHDX copy, the gateway restart policy `no`, and the containers left down
   after the 2026-11-09 outage.

## 9. Prohibitions observed

No reconciliation execution. No real QR or provider contact. No observe/send
test. No direct SQL repair of ownership or provider state. No production
deployment. No PR merge. No Docker volume deletion. No host-wide WSL shutdown.
No secret disclosure.
