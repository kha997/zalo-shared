# G5-A credential incident record — contained

**Incident class:** local credential exposure in an agent transcript (P1)
**Detected:** 2026-11-03 during G5-A preflight (before the authorized window)
**Contained:** 2026-11-03T05:31Z
**Status:** contained; rotation verified
**Live Zalo action:** none

## 1. What happened

During read-only G5-A environment inspection, the local G2 application
container's `DATABASE_URL` was printed unmasked into the private Qoder session
transcript. The value contained the password for the PostgreSQL application role
`zs_app` on the local, unpublished G2 database.

The value was **not** a Zalo credential, account UID, phone number, QR, cookie,
session record or encryption key. It was not written to the repository, git
history, CI artifacts or private pilot logs.

## 2. Exposure scope

Checked without printing the value:

| Location | Result |
| --- | --- |
| Repository working tree | 0 matches |
| Git history (all refs) | 0 commits |
| `~/pilot-private` logs and state | 0 matches |
| Hosted CI artifacts for run `41432693470` | 0 matches |
| Private Qoder session transcript | 3 occurrences |

The transcript is the only remaining copy. It is local and private, but it must
be treated as compromised private data. The credential is inert because it has
been rotated.

## 3. Rotation and verification

- A new 256-bit random password was generated without printing it.
- `ALTER ROLE zs_app WITH PASSWORD ...` was applied through stdin, not argv.
- Existing `zs_app` sessions were terminated; the app was recreated.
- Only `~/pilot-private/zalo-shared/app.env` (0600, owner `zen`) was updated.
  No other database, role, service or project was changed.
- Application health and `http://127.0.0.1:3100/health/ready` both PASS.
- New credential over the SCRAM-enforced private network: **PASS**.
- Old credential over the same path: **REJECTED**.
- Independent wrong-password control: **REJECTED**.
- Current `zs_app` sessions: 1, created after the restart (the app's pool).

The `127.0.0.1` entries in the PostgreSQL container's `pg_hba.conf` use `trust`;
that is a local in-container convenience and was not used for the rotation
proof. The proof used the same `host all all all scram-sha-256` path as the
application. Hardening the in-container trust rule is a separate residual, not a
network bypass.

## 4. Prevention

- Added `ops/private-env-keys.sh` to inspect an env file or container and emit
  **variable names only**.
- Added `tests/backend/private-env-keys.test.ts`, which asserts that fake values
  never appear in the helper output.
- Updated `docs/operations/PRIVATE-PILOT.md` to make the helper the only
  approved inspection method and to require proving properties instead of
  printing values.

## 5. Residual risk and follow-up

- Three occurrences remain in the local Qoder transcript. They should be removed
  under the private retention policy after the session record is no longer
  needed; do not publish or copy the transcript.
- Rotate the credential again if the transcript or any copy is shared outside
  the private host.
- The in-container `trust` rule for loopback connections should be tightened in a
  separate reviewed database-hardening change if the container is ever shared.

## 6. Evidence boundary

This record contains no password, connection string, cookie, key, real account
identifier or QR. It is a sanitized incident record, not live provider evidence.
