# G5-A — Pilot admin provisioning and authentication verification

**Date:** 2026-11-04
**Authorization:** `G5A_PILOT_ADMIN_PROVISIONING_ONLY` — create and verify
exactly one dedicated administrative identity in the isolated pilot database.
**Verdict:** **`G5A_PILOT_ADMIN_READY_AWAITING_OWNER_RECONCILIATION`**
**Scope note:** no reconciliation was executed, on either database or against
the pilot state. The pilot control rows are unchanged.

## 1. Result

The pilot database now contains exactly one active administrative identity that
authenticates through the reviewed login route, receives a strict session
cookie and a CSRF token, and is authorised on the operations surface. The
reconciliation route is reachable for that admin but was **not invoked**: the
only POST used an empty body, which the route's strict schema rejects with
`400` before the operation runs. The full success path was proven separately on
a disposable database.

| Requirement | Result |
| --- | --- |
| Exactly one intended Admin | PASS — `users=1`, `admins=1`, `other_roles=0` |
| Authenticates through the reviewed mechanism | PASS — `POST /api/auth/login` → `200`, role `admin` |
| Valid session and CSRF token | PASS — `HttpOnly`, `SameSite=Strict` cookie; 43-byte CSRF |
| Invalid credentials rejected | PASS — wrong password and unknown identity → `401` |
| Requests without CSRF rejected | PASS — `POST` without `x-csrf-token` → `403` |
| Non-admin authorization rejected | PASS — agent `403` on both operations routes (disposable) |
| Reconciliation route reachable, not invoked | PASS — malformed body → `400`; `connector.reconciled=0` |
| No unexpected accounts, privileges or sessions | PASS — see §7 |
| No secret disclosed | PASS — sanitized output only; no value in Git, logs or this document |
| Control state preserved | PASS — ownership and provider rows byte-identical to baseline |

## 2. Reviewed identity and implementation

- Branch `feat/shared-inbox`, `HEAD` `c7bc2c11d472caf37790ce3fd1cc6df8e1f09fb6`
  (the commit recorded by the blocked reconciliation preflight).
- `dist/` was rebuilt at that commit (`npm run build`, all stages passed) and
  mounted read-only into the containers, so the reviewed server code is what
  ran; the older contents of the image's `/app/dist` were not used.
- Container image `zalo-shared:g2-adf8ceca9bd6`
  (`sha256:9d3454015db1d8c6558c2d461fde86a2f71de0a26193d997432352115a890d65`).
  Local and unsigned, as recorded in the deployment evidence.
- New reviewed files:

| File | Purpose |
| --- | --- |
| `ops/local/provision-pilot-admin.mjs` | Bootstrap the single admin via the reviewed `users` model and `seed()` |
| `ops/local/verify-pilot-admin-auth.mjs` | Non-reconciling pilot auth/authorization/CSRF proof |
| `ops/local/verify-disposable-admin-http.mjs` | Disposable success-path proof (setup + run) |
| `ops/local/verify-disposable-admin-http.sh` | Loopback driver for the disposable proof |

### Why provisioning is needed

The blocked preflight (`G5A-RECONCILIATION_BLOCKED`) found `users=0` and
`sessions=0`: the reviewed reconciliation route requires an active `admin`
session and a CSRF token, so no authorized request was possible. This
authorization resolves only that prerequisite.

### Provisioning method

1. One short-lived container on `zalo-shared-pilot-db` connects as `zs_owner`
   with `sslmode=verify-full` and the pilot CA. The owner URL is passed in a
   `0600` env file outside the repository and deleted on exit; no password
   appears in argv, logs or image layers.
2. The tool refuses to run if any account already exists, if the credential
   file exists, if the credential directory is group/other-accessible, or if a
   non-loopback URL lacks `verify-full`.
3. It generates a 64-character base64url credential from 48 random bytes,
   writes `admin.env` with `0600` **before** the insert, then calls the reviewed
   `seed()` inside one transaction under a `LOCK TABLE users` guard.
4. It verifies exactly one row, `role='admin'`, `active=true`, and that
   `checkPassword()` accepts the credential, appends one
   `auth.admin_provisioned` audit row, and commits.
5. Any failure rolls back the insert and removes the credential file. A
   committed-but-unverified row is deleted by id.
6. It never calls `migrate()` and never touches `connector_ownership`,
   `provider_state`, delivery tables, sessions or the allowlist.

The runtime role `zs_app` was not used for provisioning and its grants were not
changed. The owner credential is used only for this one bootstrap transaction.

## 3. Sanitized account reference

| Field | Value |
| --- | --- |
| Account reference (SHA-256 of the email, first 12 hex) | `4fd6c034d5e7` |
| User id | `0b3030ee-1e4b-4798-912c-34006c9b1428` |
| Login identity | `pilot-admin@zalo-shared.invalid` (non-routable, synthetic) |
| Role / status | `admin` / active |
| Account scope | `00000000-0000-4000-8000-000000000001` (the reviewed single-account model) |
| Password hash shape | `32 hex salt : 128 hex key` (scrypt, reviewed `hashPassword`) |

The credential itself is **not** reproduced here or anywhere else in the
repository.

## 4. Credential protection

| Item | State |
| --- | --- |
| Location | `/home/zen/pilot-private/zalo-shared/pilot-admin/admin.env` (outside the repo) |
| Private directory | `0700`, owned by `zen:zen`; parent `pilot-private/zalo-shared` is `0700` |
| Credential file | `0600`, owned by `zen:zen`, exactly two keys (`PILOT_ADMIN_EMAIL`, `PILOT_ADMIN_PASSWORD`) |
| Credential | 64 characters, base64url, 48 random bytes; verified by `checkPassword()` |
| Output discipline | Tools print lengths/modes and account references only; the value is never written to stdout, stderr or Git |
| Reuse | Not derived from any G2/G3 or unrelated credential; generated on the host in this run |
| Exposure surface | No listener is published by any container; the app bound `127.0.0.1:3100` **inside** its container only |

The verification container ran as the host UID rather than the connector's
`65532` so that a `0600` file owned by the Owner could be read without widening
its mode. The container was `--read-only`, `--cap-drop=ALL`,
`no-new-privileges`, had no published ports, and was removed after the run.

### Rotation

Rotation is available through the reviewed admin API and requires a separate
Owner authorization:

1. Authenticate the current admin and obtain the session + CSRF token.
2. `POST /api/users` with `role: "admin"` and a new strong credential
   (reviewed `hashPassword`, `user.create` audit row).
3. Authenticate the replacement, then `PATCH /api/users/<old-id>` with
   `{"active": false}`. The route deletes all sessions for that user and writes
   `user.update`; it refuses to deactivate the last active admin, which is why
   the replacement comes first.
4. Delete the old private credential file. The inactive row is retained for the
   audit trail.

### Revocation

- With a replacement admin in place, the same `PATCH ... {"active": false}`
  immediately invalidates the identity and deletes its sessions.
- Revoking the **only** admin cannot be done through the reviewed API (the
  "last active administrator" guard) and must not be done by editing the
  control rows. It requires an Owner-authorised owner-level operation that sets
  `active=false`, deletes that user's sessions and appends an audit row, with
  the same TLS and private-file handling used here. That operation is not
  implemented under this authorization.
- In both cases also delete the private credential file and confirm
  `SELECT count(*) FROM sessions` is zero.

## 5. Pilot authentication and route-access verification

Run inside a transient app container on `zalo-shared-pilot-db`, with
`PROVIDER_MODE=disabled`, no published ports and the reviewed code mounted
read-only. **22/22 checks passed.**

| # | Check | Observed |
| --- | --- | --- |
| 1 | Baseline is `uncertain`, epoch 1, reconciliation required, one admin | PASS |
| 2 | Health endpoint | `200` |
| 3 | Operations require a session | `401` |
| 4 | Forged session cookie | `401` |
| 5 | Wrong password | `401` |
| 6 | Unknown identity | `401` |
| 7 | Admin login | `200`, role `admin` |
| 8 | Session cookie flags | `HttpOnly`, `SameSite=Strict`, 54 bytes; no `Secure` because the surface is loopback HTTP inside the container |
| 9 | CSRF token | 43 bytes |
| 10 | `/api/auth/me` resolves the admin | `200` |
| 11 | State-changing request without CSRF | `403` |
| 12 | Foreign origin with valid CSRF | `403` |
| 13 | Reconciliation route with `{}` | `400`, no operation |
| 14 | Admin reads `/api/provider/operations` | `200`, `uncertain`, epoch `1`, gap `1`, reconciliation required |
| 15 | Logout | `200` |
| 16 | Old cookie after logout | `401` |
| 17 | Ownership row unchanged (phase, epoch, owner, fault, timestamps) | PASS |
| 18 | Provider row unchanged (status, flag, gap, fault, timestamp) | PASS |
| 19 | `connector.reconciled` rows | `0` |
| 20 | Messages, outbox, delivery parts, provider ledger | all `0`, unchanged |
| 21 | Users / admins / other roles / sessions | `1 / 1 / 0 / 0` |
| 22 | Audit delta | `+2`, appended actions exactly `auth.login`, `auth.logout`; prefix unchanged; no `connector.reconciled`, no `user.create` |

The check set covers all nine ownership/provider fields, and the audit check
compares the full action sequence, not only the row count. The harness was run
twice: once before the review hardening and once after it; both returned
`22/22`. The second run observed audit `5 → 7` because the first run's
login/logout pair is already in the baseline it snapshotted.

The `400` is produced by the route's strict schema before
`reconcileUncertainOwnership` is called, so the real pilot state cannot be
reconciled by this probe. The harness also snapshots the two control rows before
and after and fails on any difference.

## 6. Disposable success-path proof

The successful reconciliation was exercised only on a disposable database on
the local test instance. The setup reproduces the pilot's fenced state
(`uncertain`, epoch 1, gap 1, `fault_code='shutdown'`, provider disconnected)
with synthetic rows, and seeds one reviewed admin and one agent. **19/19 checks
passed.**

- Invalid credentials → `401`; admin login → `200` with CSRF; agent login → `200`.
- No CSRF → `403`; foreign origin → `403`; unconfirmed body → `400`.
- Agent on the reconciliation route and on the operations summary → `403`.
- Admin with the exact fenced body → `200`, `epoch:"2"`, `gapVersion:"2"`,
  `alreadyApplied:false`; summary becomes `idle`, owner `null`, gap `2`,
  reconciliation cleared.
- Replay of the same `requestId` → `200`, `alreadyApplied:true`; exactly one
  `connector.reconciled` audit row, matched to the request id.
- No message, outbox, delivery-part or ledger row created; both sessions log
  out; no session survives; the stored credential still verifies.

Driver: `ops/local/verify-disposable-admin-http.sh` against
`TEST_DATABASE_URL` (`zalo_admin_http_test`, dropped afterwards). Setup now
requires an explicit `DISPOSABLE_ALLOW=1`, refuses any database that is not the
expected name, and refuses a target that already has users or audit rows, so
the reconcile-capable path cannot be aimed at a non-fresh database.

## 7. Provisioning tool tests (throwaway database)

Before touching the pilot the tool was exercised on a disposable database:

- Non-loopback URL without `verify-full` → refused before connecting.
- Group-readable credential directory → refused before writing.
- Positive run → one active admin, one `auth.admin_provisioned` audit row,
  `0600` file in a `0700` directory, password absent from stdout.
- Second run with the file present → refused; user count stays `1`.
- Run against a database that already has accounts → refused; file removed;
  user count stays `1`.
- Credential path inside the repository → refused before writing.

The full transcript of the final run is in Appendix A.

## 8. Before/after control state

Captured with the owner credential over `verify-full` inside `pilot-postgres`.

| Field | Before | After |
| --- | --- | --- |
| `connector_ownership.phase` | `uncertain` | `uncertain` |
| `epoch` | `1` | `1` |
| `owner_id` | `d4729725-5302-42d6-a4ee-ff55971fbdbb` | same |
| `owner_label` / `fault_code` | `pilot-enrollment` / `shutdown` | same |
| `uncertain_at` | `2026-11-04T00:56:01.670407+00` | same |
| `last_fenced_*` | null | null |
| `provider_state.status` | `disconnected` | `disconnected` |
| `reconciliation_required` | `true` | `true` |
| `gap_version` | `1` | `1` |
| `fault_code` | `shutdown` | `shutdown` |
| `users` / `admins` | `0 / 0` | `1 / 1` |
| `sessions` | `0` | `0` |
| `audit` | `2` | `7` |
| audit rows | `connector.reserved`, `connector.uncertain` | those two, plus `auth.admin_provisioned` and two verified `auth.login` / `auth.logout` pairs |
| `connector.reconciled` | `0` | `0` |
| messages / outbox / delivery parts / ledger / events / media jobs | all `0` | all `0` |

The pre-existing incident and audit records are preserved; the five new audit
rows are append-only evidence of the authorized provisioning and the two
verified login/logout cycles. Nothing was cleared, reset or replayed.

## 9. Posture and non-actions

- No real Zalo authentication, QR generation, SDK call, provider traffic,
  observe or send-test. The egress gateway stayed `exited`; the app ran with
  `PROVIDER_MODE=disabled` and makes no outbound call at startup.
- No migration was applied, no schema or grant was changed, no allowlist was
  changed, no firewall change was made.
- The pilot database was started for the verification and returned to
  `exited`; it was `exited` before this work and is `exited` now.
- No container publishes a port; `docker port pilot-postgres` is empty and the
  verification container is removed.
- No PR merge, deployment, or shared-infrastructure change.
- Temporary owner and app env files were `0600` and deleted; the private
  credential file is the only retained secret.

## 10. Independent review

An independent reviewer examined the four new files, the evidence claims and
the recorded results against the authorization. Verdict: **PASS WITH FINDINGS**
— no High findings, three Medium and six Low. Dispositions:

| Finding | Severity | Disposition |
| --- | --- | --- |
| Credential could be sent to an unvalidated base URL | Medium | **Fixed** — both harnesses now refuse any non-loopback base URL |
| Disposable refusal was a substring check only | Medium | **Fixed** — explicit `DISPOSABLE_ALLOW=1`, expected-database check, and a fresh-database (zero users, zero audit) precondition |
| Disposable and tool-test claims lacked recorded artefacts | Medium | **Addressed** — both suites were re-run after the fixes; Appendix A records the final transcripts |
| Credential path could be inside the repository | Low | **Fixed** — the tool refuses a path under its own repository root |
| Failure messages could echo parameters | Low | **Fixed** — credential and URL password are redacted from failure output |
| Post-commit cleanup could leave a live admin without its credential | Low | **Fixed** — a failed cleanup retains the credential file and says so |
| Pilot comparison omitted fields / audit only counted rows | Low | **Fixed** — all ownership fields and the full audit action sequence are checked |
| "Read-only" label was imprecise | Low | **Fixed** — described as non-reconciling; normal auth rows are stated |
| Sole admin cannot be revoked through the API | Low | Disclosed in §11; recovery needs a replacement admin or an Owner-authorised owner-level operation |

The reviewer confirmed the pilot probe cannot satisfy the strict reconcile
schema, that no pilot path reaches `reconcileUncertainOwnership`, and that the
recorded JSON matches the ownership, provider and delivery invariants.

## 11. Remaining risks and limitations

- **Credential lifetime.** The admin credential is static until rotated or
  revoked by a later Owner-authorised procedure; there is no MFA or password
  change endpoint in this release.
- **Loopback HTTP.** The cookie has no `Secure` attribute because the verified
  surface is HTTP on loopback inside the container. It never leaves the
  container namespace and no port is published, but a future deployment must
  serve HTTPS before the identity is used from a browser.
- **Bootstrap uses the owner role.** The insert requires owner privilege; the
  runtime role remains least-privileged and cannot create accounts.
- **Entry-state semantics.** Provisioning itself was a control-state change
  (one account) authorised by this instruction; it does not clear
  `uncertain`/`reconciliation_required`.
- **Local unsigned image.** The app image is local and unsigned, as recorded in
  the deployment evidence.
- **Replay of this result.** The provisioning tool is one-shot: it refuses any
  non-empty database, so re-running it is expected to fail, not to reconcile
  or rotate.
- **Audit rows are permanent.** `auth.admin_provisioned` and the verified
  login/logout rows cannot be removed by design.
- **Recovery dependency.** The sole active admin cannot be deactivated through
  the reviewed API (last-admin guard). Losing the credential therefore requires
  a replacement admin or an Owner-authorised owner-level revocation; the owner
  role remains the recovery path.

## Appendix A — final run transcripts (sanitized)

Provisioning tool tests (throwaway database, final run):

```text
== negative: non-loopback URL without verify-full
pilot-admin: FAIL a non-loopback database URL must use sslmode=verify-full
== negative: group-readable credential directory
pilot-admin: FAIL credential directory 755 is accessible to group or others
== negative: credential path inside the repository
pilot-admin: FAIL the credential file must live outside the repository
== positive: provision one admin
{"ok":true,"action":"pilot-admin-provisioned","users":1,"admins":1,"otherRoles":0,"sessions":0,"role":"admin","active":true,"credentialVerifies":true,"credentialMode":"600","directoryMode":"700","migrationsRun":false}
identity, credential mode, audit and no-secret-output checks PASS
== negative: second run with the credential file present
pilot-admin: FAIL the credential file already exists; refusing to overwrite it
== negative: a database that already has accounts
{"ok":false,"action":"pilot-admin-provisioning-failed","reason":"the database already has user accounts"}
provisioning tool tests PASS
```

Disposable HTTP proof (final run, 19/19):

```text
{"ok":true,"action":"disposable-setup","users":2,"admins":1,"credentialMode":"600"}
{"ok":true,"scope":"disposable-database", ... "checks":[19 entries, all pass] ...}
  applied: 200 epoch "2" gapVersion "2" alreadyApplied false
  replay:  200 alreadyApplied true
  audit:   1 connector.reconciled row for the request id
  delivery: messages 0, outbox 0, delivery_parts 0, provider_ledger 0
  logout:  both sessions 200; sessions 0; credential still verifies
```

The full check-by-check output was inspected during the run; random synthetic
request, owner and account identifiers are omitted here.

## 12. Next step

The admin prerequisite is satisfied. Reconciliation remains **not authorised**
and **not executed**; the gate stays `G5A_AWAITING_OWNER_RECONCILIATION` until
a separate Owner authorization names the reviewed operation, the exact expected
control state, and its validity window. Execution must use this admin identity
and the reviewed route; the control rows must not be edited directly.
