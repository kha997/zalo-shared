# G5-A local end-to-end dry run

**Gate:** `D4_DEPLOYED_PREFLIGHT_PASS`
**Date:** 2026-11-03 (UTC)
**Scope:** deployed topology, synthetic inputs, no provider communication
**Branch:** `feat/shared-inbox`; reviewed source commit `2dff06e063b87d6abf5e25e4a1ca9c369ba7236e`

## Command

```text
./ops/local/verify-local-dryrun.sh
pilot-dryrun: all D4 deployed dry-run assertions PASS
```

[ops/local/verify-local-dryrun.sh](../../ops/local/verify-local-dryrun.sh) runs each item below in order and fails on the first mismatch. Everything destructive happens on disposable clones, temporary directories or the dedicated synthetic containers it removes on exit.

## Required items

| # | Item | Evidence | Result |
| --- | --- | --- | --- |
| 1 | Source/image identity | Image `/app/build-identity.json` equals the lock hash and the enrollment template's build block; source commit `2dff06e063b8` | PASS |
| 2 | Database TLS connectivity | `verify-connector-db-path.sh` through the image's own `requireTlsDatabaseUrl` gate; TLSv1.3 `TLS_AES_256_GCM_SHA384`; the same host without `sslmode` is refused before a socket opens | PASS |
| 3 | Connector ownership admission | On a disposable template clone of `zalo`: acquire → active; a second owner is refused; shutdown quarantines the clone to `uncertain` with `reconciliation_required=true` | PASS |
| 4 | Deployed network enforcement | `verify-deployed-pilot.sh` re-run in place, **48/48** assertions | PASS |
| 5 | Bootstrap host allowlist | Rendered connector allowlist and `extra_hosts` pins asserted; unapproved SNI refused; empty policy fails closed | PASS |
| 6 | Grant scope and expiry | `verify-enrollment-readiness.sh` re-run, **46 assertions**: admission, 11 denials, stage separation, QR/private modes | PASS |
| 7 | Local synthetic QR display | Synthetic 33-byte PNG through `PrivateQrFileView`: `0600`, UID 65532, only `qr.png`, safe `clear()`, loose/symlink/non-PNG/foreign-dir refusals | PASS |
| 8 | Encrypted session-store fixtures | Random in-memory key; `PrivateSessionFile` round-trip; `0600`; wrong key, wrong key id and truncated ciphertext refused; quarantine refuses a later read | PASS |
| 9 | Safe shutdown | Synthetic connector stops on `SIGTERM` within the 5 s timeout (exit 137); no residual `g5-*` or connector container | PASS |
| 10 | No unintended external traffic | Gateway audit slice for the run contains 4 events and **0 `sni_allow`**; every probe target was reserved or documentation space | PASS |

## Previous blockers reproduced as negative tests

- The earlier live attempt stopped on a non-loopback `DATABASE_URL` without `sslmode`. The connector gate refuses that URL before opening a socket, and the deployed URL (`sslmode=verify-full`) is admitted over TLSv1.3.
- The earlier attempt had no deployed internal-network topology. A connector attached to the non-internal uplink refuses to start, and the deployed namespace has no IPv4 or IPv6 default route.
- The earlier attempt had only a placeholder manifest. The enrollment preflight now admits a correctly bound synthetic manifest and denies 11 out-of-scope variants, while observe and send-test refuse the enrollment-only grant.

## Isolation guarantees

- The live pilot `connector_ownership` row remains `idle` with `reconciliation_required=false` after the run (asserted after the clone test).
- The ownership test uses `zalo_ownership_check`, created from `TEMPLATE zalo` and dropped on exit. It never writes the live `zalo` ownership or provider state.
- The compose dry-run uses the deployed private compose and interpolation files, but the default command is `dry-run`; it admits and exits without SDK login, provider contact or a live grant.
- No probe resolves or dials a real provider hostname. The only gateway events are refusals for reserved `.test` names and local probes.
- The gateway was stopped and restarted only inside the D2 verification, and it returned to `healthy`.

## Residual risks

- The session fixture uses synthetic ciphertext in a temporary directory. It proves the file-store behaviour, not a real provider session or a recovery from a lost real key.
- The ownership clone proves transaction semantics on the same PostgreSQL instance. It does not prove fencing of a second host; ownership recovery still requires the reviewed admin reconciliation and external attestation of old-owner termination.
- HTTP-level provider behaviour, rate-limit responses and real message delivery are outside this dry run and remain UNPROVEN.
- This is a local single-host dry run. It is not a production capacity, availability or compliance proof.

## Status

`D4_DEPLOYED_PREFLIGHT_PASS` — PASS on the actual host. No live Zalo action was involved or implied.
