# G5-A deployment remediation: independent review and dispositions

**Date:** 2026-11-03
**Scope:** the D1–D4 deployment-remediation change set on `feat/shared-inbox`
(deployed environment versus the reviewed CI/topology configuration)
**Live Zalo action:** none. No login, QR scan, session, account or provider
contact was involved in this review. D1–D4 were verified with synthetic inputs
only.

## 1. How the review was done

The review was run against the deployed environment and the working tree, not
against the evidence prose alone. It had three parts:

1. **Environment comparison.** The reviewer read the deployed container state
   (`docker inspect` for `pilot-postgres`, `egress-gateway`, the pilot networks
   and the connector image), the reviewed compose/topology checks and the CI
   workflow, and compared them with the claims in the D1–D4 documents.
2. **Adversarial reading of the verifiers.** Each assertion was checked for
   falsifiability: could it pass while the property under test was false? This
   is what found the D1 vacuity finding below.
3. **Closure re-run.** After the fixes, the Engineering Lead re-ran the whole
   dependent chain on the actual host: D1 TLS/privilege suite, the fixture
   network suite, the deployed-pilot verifier, the enrollment suite and the
   end-to-end dry run. Every suite was re-run against the hardened database, not
   only against the pre-fix state.

The reviewer did not have access to any real account, session material or
provider credential, and none was needed.

## 2. Blocking finding and closure

### H1 — the runtime role could delete control state and roll the send budget back

`zs_app` held the default table grants from the migration role: `DELETE` and
`TRUNCATE` on `connector_ownership`, `provider_state`, `pilot_send_budget` and
`pilot_part_ledger`, and `UPDATE` on `pilot_part_ledger`. A compromised
connector process could therefore delete the open ownership row, reset
`pilot_send_budget` to its initial reservation, or rewrite the ledger.

Impact: the budget is one of the enforced G5 limits (1–10 parts/day, at most 10
per grant). Being able to reset it defeats the limit with database access alone,
and deleting ownership state removes the evidence that a second owner was
refused. The TLS and network boundaries were unaffected; this is an
authorization defect inside the trust boundary, not a boundary bypass.

Disposition: **fixed and verified.**

1. `ops/local/migrate-pilot-db.sh` now revokes `DELETE`/`TRUNCATE` on all four
   control tables and `UPDATE` on the ledger from `$app_role` after the
   migrations run.
2. It installs a `pilot_budget_monotonic` trigger that rejects any update which
   changes the day, lowers `reserved_parts` or raises `max_parts`, so the budget
   cannot be rolled back even if a future grant accidentally allows `UPDATE`.
3. It asserts the resulting privilege state and the trigger count at the end of
   the migration, so a re-run cannot silently regress.
4. `ops/local/verify-pilot-db-tls.sh` proves the denial independently: `DELETE`
   on each table, `UPDATE` on the ledger, a permitted one-part reservation, and
   three refused budget rewrites (rollback, day change, cap raise).

The suite was re-run after the migration and reported all checks PASS, including
`runtime role cannot delete ownership/budget rows or update the ledger` and
`the send budget is protected by an append-only trigger`.

## 3. Other findings

| ID | Finding | Disposition |
| --- | --- | --- |
| M1 | The D1 verifier contained assertions that could not fail (a "not connected to" check that only compared names), so the document's PASS could be vacuous | Fixed: replaced with container start-time versus `pg_postmaster_start_time()` and G2 container creation comparisons, both with explicit PASS/FAIL lines; the evidence doc was corrected to match |
| M2 | The docs and the compose comment said the gate admits only `verify-full`; the gate also admits `require` and `verify-ca` | Fixed in wording only. The deployed URL remains `sslmode=verify-full` and the gate was not weakened |
| M3 | The fixes existed only in the working tree, so the committed verifier could go stale and the evidence was not reproducible from the repository | Fixed: the change set is committed and pushed on `feat/shared-inbox`; PR #3 stays draft |
| L1 | On container reuse, the provisioner did not prove the container was actually serving the audited certificate files | Fixed: compares the SHA-256 of each mounted CA/server certificate with the file inside the container and asserts `SHOW ssl_cert_file` / `SHOW ssl_ca_file` |
| L2 | The D4 gateway-log slice could pass on an empty or shrinking log | Fixed: requires the log to be non-empty, non-shrinking, contain at least one refusal, and contain zero admitted tunnels |
| L3 | The D1 `neg()` helper treated any error as a refusal, so a connection failure would have counted as a TLS denial | Fixed: each negative case passes an expected error pattern and fails on the wrong reason |
| L4 | Connector-path and migration env files holding credentials were left on disk | Fixed: both scripts remove their env files on exit |
| L5 | The fixture network suite defaulted to the deployed egress subnet and a stale image tag, so it could not run beside the deployment | Fixed: defaults moved to `172.16.28.0/24` and `g5-local`; the suite runs against the deployment |
| N1 | A stale enrollment fixture was admitted because it had been generated 20 minutes earlier | Disclosed as a finding in [G5A-ENROLLMENT-PREFLIGHT.md](G5A-ENROLLMENT-PREFLIGHT.md). The fixtures are now regenerated on every run; the gate code was not changed |

No finding remains open at High or Medium. N1 is a timing property of synthetic
fixtures, not a defect in the gate.

## 4. Claims re-measured after the fixes

All four suites below were re-run on the actual host after the D1 hardening, so
the D3/D4 runs inherited the revoked grants and the budget trigger.

| Claim | Measurement |
| --- | --- |
| D1 database TLS and least privilege | `verify-pilot-db-tls.sh`: all checks PASS, including the new privilege and budget negatives |
| D2 fixture network boundary | `verify-pilot-network.sh`: 25/25 PASS |
| D2 deployed network boundary | `verify-deployed-pilot.sh`: 48/48 PASS |
| D3 enrollment readiness | `verify-enrollment-readiness.sh`: 46 assertions PASS (11 denials) |
| D4 end-to-end dry run | `verify-local-dryrun.sh`: all D4 assertions PASS |
| Product source unchanged | `git diff 2dff06e..HEAD -- connector server tools adapters` is empty; the 327/327 local suite and CI run 41650617518 still describe the same source |
| Hosted CI on the committed change set | [CI 41669199182](https://github.com/kha997/zalo-shared/actions/runs/41669199182) on `ecc0600`: both jobs `test` and `pilot` succeeded |

## 5. Residual risks and what remains UNPROVEN

These are recorded so the Owner can weigh them; none is hidden behind a PASS.

1. **Image provenance (UNPROVEN).** Both images are local and unsigned. A
   `docker image inspect` digest is not a registry digest or a signed
   attestation, and CI does not push images.
2. **Docker daemon trust.** Anyone able to talk to the Docker socket is
   equivalent to root on this host and can attach networks, replace images or
   read database volumes. No control in this change set reduces that.
3. **Root entrypoint in the database container (accepted).** The Postgres
   container starts as root and drops to the database user in its entrypoint.
   The container is on an internal network with no published port; the trade-off
   is recorded in [G5A-DB-TLS-VERIFICATION.md](G5A-DB-TLS-VERIFICATION.md).
4. **Host-wide LAN isolation (UNPROVEN).** Only the pilot resources were
   verified; the host firewall is `NotConfigured` and no second physical device
   was used.
5. **WSL2/Docker Desktop scope.** The negative results are specific to this
   WSL2 host. They do not prove that `DOCKER-USER` rules exist on a native Linux
   host.
6. **Runtime-only provider paths (UNPROVEN).** The observe and send-test
   service-map and WebSocket hosts cannot be proven offline and currently fail
   closed.
7. **No real grant (UNPROVEN).** The enrollment template is inert. A real grant,
   a real QR display and a real session exchange have not been exercised, by
   design.
8. **Synthetic session store (UNPROVEN in production).** The encrypted store was
   round-tripped with synthetic records only.

## 6. Gate impact

The High finding is closed and verified on the deployed database; the Mediums
are fixed; the remaining items are Low, disclosed or accepted with a reason.
Nothing found in this review remains as a blocker for
`D5_DEPLOYMENT_REVIEW_PASS`.

This review says the deployment remediation is complete and independently
checked. It does **not** authorize G5-A, does not choose an activation time and
does not permit any live Zalo action. A new Owner authorization with an explicit
UTC start and expiry is still required before any live stage.
