# G5-A credential rotation — independent verification (2026-11-10)

**Status:** `G5A_CREDENTIALS_ROTATED_RECONCILIATION_READY`
**Verification window:** 2026-11-10T16:23Z–16:30Z
**Authority:** Owner directive *PRIVATE-PILOT CREDENTIAL ROTATION AND RECONCILIATION
PREPARATION ONLY*. The directive named HEAD `375a253`; the branch had already advanced to
the rotation commit `a49775f`, so this record verifies that commit and the live pilot rather
than repeating the rotation.

This verification was run independently of the rotation session. It re-read the live
database, probed both credentials over TLS, exercised the metrics endpoint, re-ran the
reconciliation preflight read-only and scanned every reachable copy of the secrets. No
secret value — old or new — appears in this document, its console output, git or CI.

## 1. Repository state

| Item | Value |
| --- | --- |
| Mandated starting HEAD | `375a253` (*Record the post-recovery ACL restriction, prepared request and storage findings*) |
| Local clone before verification | `aab3891` (*State the blocked attempt's PR head precisely*) |
| `origin/feat/shared-inbox` | `a49775f` (*Rotate the exposed pilot credentials and prepare the epoch-7 reconciliation*) |
| Local HEAD after fast-forward | `a49775f6ebf6cd2a44d77f8fdbf751a875aa48ce` |
| Working tree | only a pre-existing empty untracked file `4,` (2026-11-07); no tracked change |
| PR #3 | OPEN / **Draft**, base `main`, not merged |

`375a253` is an ancestor of `a49775f`; the fast-forward introduced no merge commit and no
history rewrite. The rotation was executed at `14:58:14Z` on the deployed application, which
started inside that same minute from image
`sha256:989c61541cc95931bef1bd223934032f6d42b5937ff78de62b5e451dc0fbe824`.

**No second rotation was performed.** The private marker `rotation-20261110.done` and record
`rotation-20261110.json` (both `0600`) exist; the reviewed script refuses to run again, so a
repeat would have been a no-op. The verification instead proved that the applied values are
the only live values.

## 2. Dependency inventory (read-only)

| Credential | Consumers found | State |
| --- | --- | --- |
| `zs_app` password | `pilot-db/secrets/app.pw` (0440, `root:systemd-journal`), `pilot-app/app.env` `DATABASE_URL`, `pilot-db/secrets/pilot-connector.env` `DATABASE_URL`, the application container env | rotated; all four agree |
| `METRICS_TOKEN` | `pilot-app/metrics.token` (0600), `pilot-app/app.env`, the application container env, the `/metrics` bearer check | rotated; all agree |
| Pilot admin credential | `pilot-admin/admin.env` | not rotated, outside the exposure |
| `zs_owner` PostgreSQL role | provisioning/preflight scripts over the local socket | not rotated, different role |
| TLS material, `session.key` | `pilot-db/pki/*`, `pilot/session.key` | untouched |

**Sharing check.** The g2 compose project used the historical file
`<PILOT_PRIVATE>/app.env` as its environment file, and that file contained the exposed pilot
password. It is **not** a live shared credential: password authentication with that value is
rejected by the g2 `zs_app` role **and** the g2 `zalo_owner` role (the same probe accepts the
`zalo_owner` password, validating the method). The current pilot password is also rejected
there, so the g2 role password is independent of both. The earlier statement in
`G5A-CREDENTIAL-ROTATION-2026-11-10.md` that the old value “also authenticates” the g2 stack
was based on env-value comparison, not an authentication test; this record supersedes it.
The g2 stack's own credentials remain outside this directive.

## 3. Independent verification results

### 3.1 File and consumer consistency

| Check | Result |
| --- | --- |
| `app.pw` mode / owner | `0440`, `root:systemd-journal` |
| `metrics.token`, `app.env`, `pilot-connector.env` | `0600`, `zen:zen` |
| `app.env` password == `app.pw` | true |
| connector env password == `app.pw` | true |
| container env password == `app.pw` | true |
| `METRICS_TOKEN` in container == token file | true |
| DSNs carry `sslmode=verify-full` (file, connector, container) | true / true / true |

### 3.2 Credential probes (from a throwaway container, `verify-full`)

| Test | Result |
| --- | --- |
| New `zs_app` password, host `pilot-db`, `sslmode=verify-full` | **accepted** (`select 1`) |
| Arbitrary wrong password, same path | **rejected** (`password authentication failed`) |
| Previous shared value, pilot `zs_app` | **rejected** |
| Previous shared value, pilot `zs_owner` | **rejected** |
| Previous shared value, g2 `zs_app` / `zalo_owner` | **rejected** / **rejected** |
| New `METRICS_TOKEN` on `/metrics` | **200** |
| Wrong token / no token | **401** / **401** |

The previous `METRICS_TOKEN` was already replaced and its plaintext copies are redacted
(§4); the endpoint accepts only the current file value, which the 200/401 pair proves.

### 3.3 Service and boundary state

| Check | Result |
| --- | --- |
| Pilot application | `running/healthy`, user `65532:65532`, `PROVIDER_MODE=disabled`, `MOCK_ENABLED=false` |
| `/health/live`, `/health/ready` | 200 / 200 |
| PostgreSQL | `healthy` |
| Application session TLS | `TLSv1.3 / TLS_AES_256_GCM_SHA384 / idle` |
| Egress gateway | `running/healthy`; last event `startup` at `14:24:51Z`; **0** tunnel events |
| Connector / bootstrap containers | none |
| Zalo session artefacts | `session.enc` absent, `qr.png` absent, `quarantine` absent, `session.key` present |
| Identities / sessions | 1 user, **0** sessions |
| Database network | internal; members only application + PostgreSQL |
| Egress network | internal; uplink non-internal with only the gateway |
| Unresolved delivery work | **0** |
| Advisory locks | **0** |
| Other database sessions | 1 idle `zs_app` pool session (the known condition the wrapper quiesces) |

### 3.4 Authoritative control state (separate read-only connection)

| Field | Observed |
| --- | --- |
| Ownership | `uncertain` |
| Epoch | **7** |
| Owner | `af5048a8-41c7-46b3-920c-310855d6c911` |
| Fault / `uncertain_at` | `shutdown` / `2026-11-09T13:25:18Z` |
| Preserved fence | `7cc878cf-cdb1-4b4a-9905-2d107aa21482` / epoch 5 |
| Provider | `disconnected`, gap **7**, `reconciliation_required=true`, fault `shutdown`, no `last_event_at` |
| Audit | 28 rows, max id 28, 3 `connector.reconciled`, tail `connector.uncertain/connector.reserved/auth.logout/auth.login` |

No control flag was reset, no SQL repair was run and no reconciliation was performed.

## 4. Secret-copy containment

No live value appears in the repository, its 132-commit history, the pilot tree outside the
four consumer files, `D:\WSL-Backups`, the Qoder project store or `%TEMP%`.

The scan *did* find the previous password in two secondary copies that the rotation record
had not listed:

| Copy | Before | Action |
| --- | --- | --- |
| `<PILOT_PRIVATE>/app.env` (stale generation; also the g2 compose environment file) | 1× previous password, 1× previous 64-char token | length-preserving redaction |
| prior session transcript `<QODER_STORE>/C--Users-Admin-Projects-zalo-shared/103e39ae-….jsonl` | 5× previous password, 4× previous token | length-preserving redaction |

| File | Size | SHA-256 before → after |
| --- | --- | --- |
| stale `app.env` | 552 B unchanged | `6689abd2c798db036e3636e850c9bfe8676d457c80d9d232e90249ab6f0f709c` → `8bf1d3eb6c51084101319c893d14d99762f705cbdb5c62a35ab5a7d1b357573c` |
| transcript | 78,738,821 B unchanged | `8fb03fe55b8d0248cbc057d03dd704cb8cf65bdf62693039997ce0a5e311dadf` → `665f0bf74b746605c0c96d6fedcad98da9d66c880f99a52e919fd6af491b8962` |

Only the matched spans changed (`only_expected_bytes_changed=true`); file size, offsets and
mtime were preserved, and the transcript still parses as 32,320 valid JSONL records before
and after. A post-change scan returns **0** copies of the previous password in the repository,
the pilot tree, the backup set, the Qoder store and `%TEMP%`, and the current values only in
the four intended consumer files.

**Disposition of the two remaining copies (not modifiable under this directive):**

- the g2 container env still carries the previous value (authentication-rejected; changing a
  running container's env requires recreating it, which the directive forbids);
- the 2026-11-09 VHDX is unchanged (147,385,745,408 B, mtime `2026-11-09T15:17:55Z`) and
  internally contains the previous value; rotation makes it dead, and the directive forbids
  altering the VHDX.

`D:\WSL-Backups` retains its restricted ACL: inheritance removed; only `SYSTEM`,
`BUILTIN\Administrators` and `DESKTOP-U0Q31VK\Admin` hold FullControl; a recursive check of
every non-VHDX item found no `Users`, `Everyone`, `Authenticated Users` or `Codex*` ACE.

## 5. g2 configuration side effect (disclosed)

`<PILOT_PRIVATE>/app.env` is also the compose environment file of the unrelated
`zalo-shared-g2` project. The redaction removed the previous pilot password (and a dead
64-char token) from it; it did **not** touch `POSTGRES_PASSWORD` or any other g2 credential.
No g2 container was started, stopped, recreated or modified: `zalo-shared-g2-postgres-1`
remains `running/healthy` and its role password is independent. Any future recreation or
credential refresh of the g2 stack requires a separate g2-scoped authorization.

## 6. Reconciliation wrapper readiness (not executed)

`ops/local/reconcile-20261110.sh` at `a49775f`, reviewed blobs pinned
(`reconcile-pilot-state.mjs` = `bb7a18cc…`, `preflight-pilot-reconciliation.mjs` =
`b3f34274…`). Its read-only preflight was run from a temporary LF worktree at the same HEAD
(the Windows checkout is CRLF; the worktree was removed afterwards) and passed:

- request `521bbecd-f666-4f0d-8e6c-efe73ebcc3ef`, `notSent=true`, `evidenceRef
  G5A-OWNER-AUTH-2026-11-10-RECONCILIATION`;
- fence `uncertain|7|af5048a8-…|shutdown|2026-11-09T13:25:18|7cc878cf-…|5`;
- provider `disconnected|7|true|shutdown`; audit 28 rows, 3 reconciliations;
- advisory locks 0; one idle application session → `app_quiesce_required=1`;
- gateway healthy with only the startup event; session key only; no connector.

Guards verified in the wrapper: host `flock` single-flight, a no-clobber attempt marker
written before any action (no retry), window read **only** from the Owner file
`<PILOT_PRIVATE>/pilot-admin/reconcile-window-20261110.json` (absent), process-clock
enforcement, `PILOT_RECONCILE_CONFIRM=ONE_SHOT`, quiesce + zero-session proof, one loopback
container, one admin request, independent post-verification of `idle/epoch 8/gap 8/
reconciliation_required=false`, +1 audit row, zero locks and zero unresolved work.

Neither the wrapper nor the driver was executed: no window file, no attempt file and no new
`reconciliation-*.json` exist.

## 7. Residuals and Owner decisions

1. **g2 stack hygiene (separate authorization).** The previous value is dead but still
   stored in the g2 container env; the g2 compose environment file now holds a placeholder.
   Decide whether to rotate/rebuild the g2 stack before any restoration.
2. **VHDX.** The original backup still contains the dead value; it must not be altered under
   this directive.
3. **Disk.** `C:` has 8.4 GB free (99 % used). Disk recovery is a separate recommendation.
4. **Gateway restart policy** remains `no`, unchanged from the earlier record.
5. **Unrelated workloads** left exactly as found (no start, stop, delete or volume change).
6. The untracked empty `4,` file predates this directive and was left untouched.

## 8. Prohibitions observed

No reconciliation execution, no QR or provider contact, no observe/send test, no direct SQL
repair of ownership or provider state, no production deployment, no PR merge, no Docker image
or volume deletion, no host-wide WSL shutdown or compaction, and no secret disclosure.

## 9. Verdict

`G5A_CREDENTIALS_ROTATED_RECONCILIATION_READY` — both exposed credentials are rotated and
verified, the old values are rejected everywhere they can be tested, the services and
boundary are healthy, the authoritative control state is the fenced epoch-7 incident, and the
one-shot reconciliation wrapper is ready but unexecuted. The g2 stack and the VHDX are the
only remaining carriers of the dead value and are outside this directive.
