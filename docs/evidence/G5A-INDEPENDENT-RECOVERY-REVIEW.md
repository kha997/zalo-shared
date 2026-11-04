# G5-A — Independent recovery review

**Date:** 2026-11-04
**Subject:** reconciliation operation, redirect analysis and diagnostics
**Reviewer:** a separate review context with no part in writing the change,
working read-only against the repository. **Independence limitation:** the
review was executed by the same agent tooling and model, not by a different
human or organization. It is a genuine second pass with fresh context and
adversarial instructions, but it is not an external audit. A human reviewer
should still reproduce the checklist before any live execution.

## 1. Verdict

**PASS WITH FINDINGS.** All ten acceptance checks passed. Every finding is
Low/Info: none allowed unauthorized control-state movement, secret disclosure,
delivery-state reset or a fencing bypass that the reviewer could construct.

## 2. Check results

| # | Check | Result |
| --- | --- | --- |
| 1 | Exact epoch/state binding | PASS — both rows locked and read together; fresh path requires `phase='uncertain'`, exact owner/epoch, gap, `reconciliation_required=true`, `status='disconnected'`; updates independently conditional; every mismatch `409` |
| 2 | Fencing cannot be bypassed while a connector/worker is live | PASS — empirically confirmed on the disposable DB that session-level one-key `73001` blocks transaction one-key `73001`, and session two-key `73002` blocks transaction two-key `73002`; PostgreSQL keeps both in one lock space across sessions |
| 3 | Unresolved session/outbox blocks recovery | PASS — held/overflow/missing/conflict events, held/pending/processing media, pending/processing/unknown outbox/messages/parts; terminal statuses correctly excluded |
| 4 | Duplicate handling is idempotent and non-replayable | PASS — prior `requestId` lookup plus exact post-state equality; a different incident changes epoch/gap or is `uncertain`, so it `409`s first; never writes twice |
| 5 | Transactional / failure atomic | PASS — route uses `secured` → `transaction()` (BEGIN, advisory, fresh session read, COMMIT/ROLLBACK), conditional updates, post-update consistency read, `protect` maps unexpected errors to `409` |
| 6 | No secrets in audit or errors | PASS — metadata is UUIDs, counters, bounded `evidenceRef`, literals and closed-vocabulary fault codes; parameterized INSERT; no provider text, cookie, UID, QR or session content |
| 7 | Delivery state untouched | PASS — writes only `connector_ownership`, `provider_state`, `audit`; no INSERT/UPDATE/DELETE on messages/outbox/parts/events/media |
| 8 | Redirect analysis and allowlist unchanged | PASS — test loads real `zca-js@2.2.0`; guard throws `PILOT_EGRESS_DENIED` synchronously before a socket; allowlist still admits exactly three hosts and excludes `chat.zalo.me`; no runtime config diff |
| 9 | Negative tests reproduce | PASS — typecheck exit 0; four-file run **47/47** (reconciliation 8, HTTP 4, redirect 5, bootstrap 30 at review time); pilot containers stopped and not started |
| 10 | Changed-file scope | PASS with note — only expected code/tests plus documentation; no package/compose/ops change. The evidence docs were being written during the review; code hashes stayed stable |

## 3. Findings and dispositions

| # | Severity | Finding | Disposition |
| --- | --- | --- | --- |
| 1 | Low | `localState` (`sessionFile`/`quarantine = "absent"`) is a client-supplied attestation; the server cannot inspect the connector filesystem | **Accepted, documented.** `G5A-RECONCILIATION-IMPLEMENTATION.md` §4/§8 call it the weakest safeguard; the execution procedure requires the host check before the call, and the attestation is audited |
| 2 | Low | `qr-shown` could still be staged if an abort arrives while `showPng` is in flight | **Fixed.** `adapters/zalo/qr-bootstrap.ts` re-checks `finished \|\| aborted` after the awaited display; regression test "an abort during an in-flight QR display never reports it as shown" (bootstrap suite 31/31) |
| 3 | Low | Advisory-lock keys are duplicated literals; `(73002,1)` and `(73002)` do not conflict, so a one-sided edit would silently disable the fence | **Accepted with mitigation.** A comment at `server/connector-operations.ts` now states the two-key form must match `connector-ownership.ts`. Moving the keys to shared constants would touch the connector path and is left as a separate follow-up |
| 4 | Low | The conflict predicate assumes `state='conflict'` implies `conflict=true, resolved_at=NULL`; no DB CHECK enforces it | **Accepted residual.** Unreachable through reviewed writers, which set the fields together; recommend a CHECK constraint in a future migration |
| 5 | Low | The idempotency lookup is not account-scoped and has no uniqueness constraint | **Accepted residual.** Correct for the single-account pilot; must be revisited if the operation is reused for multiple accounts |
| 6 | Info | Media-worker lanes `73003/73005/73004` are not checked | **Accepted.** In-flight media is still caught by the job-status query; no state movement was constructible |

## 4. Reproduction evidence

- `npm run typecheck` — exit 0.
- Four-file suite at review time — **47 pass / 0 fail**:
  `connector-reconciliation` 8, `connector-operations-http` 4,
  `sdk-redirect` 5, `qr-bootstrap` 30.
- After the finding-2 fix, the author re-ran the bootstrap suite (**31/31**)
  and the full suite; see `G5A-RECONCILIATION-TEST-EVIDENCE.md` §2 for the
  main run and the single known pre-existing guard flake.
- `docker ps`: `pilot-postgres` Exited(127),
  `zalo-shared-pilot-egress-gateway-1` Exited(255); the reviewer did not start
  them and modified no repository file.

## 5. What the review could not verify

- Real provider redirect behaviour and `chat.zalo.me` admission — static SDK
  inspection and synthetic fixtures only, no network.
- Filesystem absence of `session.enc`/quarantine on the connector host.
- The guard **allow** path for the three admitted hosts (only refusal was
  exercised).
- A live execution of the reconciliation operation; the pilot rows were not
  read or written.

## 6. Conclusion

The reviewer found no path to move fenced ownership without the exact incident
identity, no way to run while a connector or worker is live, no delivery-state
write, and no secret in the audit path. The one in-scope defect (finding 2) is
fixed and covered by a regression test. The remaining findings are accepted
residuals with documented conditions.

**STOP — `G5A_RECONCILIATION_IMPLEMENTED_AWAITING_OWNER_EXECUTION`. The review
does not authorize execution, deployment, allowlist change or any live
provider action.**