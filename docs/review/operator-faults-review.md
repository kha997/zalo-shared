# Versioned fault and conflict evidence independent review

Verdict: **no remaining P0/P1/P2 identified in the scoped Task1 source; accepted conditionally on hosted PostgreSQL/concurrency and recovery evidence**. This is not operator-service, real-provider or production acceptance.

## Scope and method

Reviewed the current delta against local a3462f6 in provider-schema.ts, provider-faults.ts, provider-store.ts, connector-ownership.ts and connector-runtime.ts, together with provider-faults tests, updated runtime observer test, implementation report and Task1 plan. Inspected actual transaction/lock context and existing acceptance/reconciliation helpers. No product edits, external network, login/account activity, PostgreSQL attempts or commits were performed. Only this review was authored.

## Assessment

- Account/thread/direction identity remains unchanged. Conversation locking serializes variant admission; canonical body and existing projected message are not overwritten. At most eight differing normalized bodies are retained; later receipts update bounded counters/last hash and preserve the permanent overflow gate. Known retained/canonical replay after explicit resolution does not reopen evidence; genuinely new evidence clears resolution attribution, advances its version and reasserts the gap. Unresolved replay still reasserts quarantine.
- Legacy conflicts with previously discarded evidence are marked missing on migration, and new receipts do not clear that durable marker. Migration reruns preserve retained evidence. Task2 must refuse missing evidence, overflow and exhausted versions; this review does not imply those not-yet-implemented service checks exist.
- Resolution version reaching the bigint ceiling immediately sets the permanent overflow gate. Gap versions remain decimal strings and saturate rather than wrap. Recovery must reject MAX_GAP_VERSION even on the first receipt that reaches it; fault_code changes to version-exhausted on the subsequent already-at-ceiling receipt. This requirement is documented in the helper/report.
- Fault updates are atomic inside the caller transaction; the helper refuses missing explicit transaction markers and non-enumerated codes. Runtime retains synchronous local dispatch blocking, matching owner SHARE lock, statement timeout and transactional fault/audit persistence. Healthy ownership invalidation retains its bounded dedicated-client atomic CTE while sharing the fixed increment expression. Fence acknowledgement invokes the transactional helper without clearing reconciliation. No new takeover or resend path was found.
- No arbitrary SDK JSON or new locator storage is introduced. Retained normalized text is existing customer-content scope, requiring the planned admin-only view/retention controls. Metadata counters do not establish complete overflow evidence.

## Executed evidence and remaining gates

Independently ran the pure fault boundary plus all nine owned-runtime tests with an explicit positive name filter: **10/10 PASS**, zero failures. `git diff --check` passed. The filter excluded all PostgreSQL cases; no setup failure is counted as a pass.

Hosted CI must execute variant/replay/reopening, thirty-concurrent-receipt cap/overflow, legacy migration, bigint precision/ceiling, explicit transaction and stale-ack-vs-new-fault SQL scenarios alongside existing ownership/store/worker tests. Root must include provider_event_variants in counts/fingerprints, nonempty retained-evidence fixtures and restore gap-version advancement before whole-phase acceptance. New privileged service/UI checks remain separate required work. No real schema/CDN/phone/provider-fencing evidence is established here.
