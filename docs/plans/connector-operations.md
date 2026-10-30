# Privileged connector operations implementation plan

> Implement task by task using subagent-driven-development or executing-plans. Owner delegated engineering design/execution; no additional approval is required for these reversible offline changes. Live account resources, material risk acceptance and production remain separate gates.

**Goal:** Give administrators a bounded, auditable view of connector uncertainty and safe evidence-based resolution without retrying uncertain sends or hiding new gaps.

**Architecture:** PostgreSQL owns fault versions, retained conflict evidence and resolution records. Authenticated operations use current-role checks inside the existing request transaction, exact identifiers, concurrency checks and append-only audit. UI distinguishes connectivity, admission, reconciliation and message uncertainty. No operation authenticates Zalo or sends a message.

**Spec:** Owner invariants; docs/DESIGN.md; docs/plans/connector-core.md; docs/plans/connector-media.md; docs/plans/connector-ownership.md; docs/operations/SDK-RISKS.md.

## Global constraints

- Configuration remains disabled/mock, SDK development-only, no QR/login/session endpoint, public listener, real account/customer data or production action.
- Only current active ACCOUNT admins may read detailed recovery evidence or mutate recovery state. Agents/supervisors may see aggregate nonpersonal availability counts only. Existing audit read policy remains unchanged.
- Every mutation requires existing authenticated session, exact Origin and CSRF checks, current-role/session recheck under the staff-change lock, strict bounded body and account filtering. Recheck admin **inside** the transaction; a pre-handler role check alone is insufficient.
- Unknown never becomes pending/processing. No resend/reset/delete-history/force-takeover operation is introduced. Text/time similarity is never attribution evidence.
- Preserve staff actor, original canonical provider event, all retained variants, accepted part IDs and immutable audit. Never expose credentials, SDK objects, media locators, raw errors or attachment bytes in recovery summaries.
- Provider fault versions and ownership epochs are decimal bigint strings, never JS numbers. Audit evidence references use restricted printable nonsecret references, not URLs/tokens/customer text.

## Current gaps inspected

`provider-store.ts` retains canonical event/body and a conflict flag but discards the differing payload. This is an auditability limitation: current logs cannot reconstruct conflicting variants. Replayed conflicts reassert disconnected/reconciliation_required, but there is no monotonic fault generation, so a future unconditional gap-clear could erase a simultaneous new fault. `recordPartAccepted` already performs exact-ID mapping with transactional conversation locking and rejects competing mappings; reuse it rather than introducing similarity reconciliation. `acknowledgeConnectorFence` already performs current-admin, transaction, lifetime-lock and expected-owner/epoch checks; expose that service without weakening its boundary. Current `/api/provider` returns only mode/status/time, and the UI cannot distinguish reconciliation from socket connectivity. Root's native actor-null label correction uses “Zalo / thiết bị khác”; preserve it.

## Review focus

1. Administrator is revoked while a recovery request is in flight: transaction rechecks must deny the mutation and leave no audit/state change.
2. A new fault arrives while an operator acknowledges an older gap: expected fault version CAS must fail or the later fault must reassert quarantine.
3. Provider ID reused in another thread/direction/account, already linked event, or ambiguous unknown job: reject cross-scope or competing mapping before any change.
4. Variant flooding exceeds retention budget: keep bounded evidence and an explicit unresolved overflow gate; never pretend full evidence was retained.
5. Two operators act on stale screens: exact row/version/owner comparisons must yield a conflict, never duplicate finalization or silent overwrite.

## Task 1 — versioned faults and bounded conflict evidence

Files: `server/provider-schema.ts`, new `server/provider-faults.ts`, `server/provider-store.ts`, `server/connector-ownership.ts`, `adapters/zalo/connector-runtime.ts`; tests `tests/backend/provider-faults.test.ts`.

Interfaces:

```ts
recordProviderFault(db: pg.PoolClient, code: ProviderFaultCode): Promise<{gapVersion:string}>;
// Existing explicit transaction required. Sets disconnected, reconciliation_required,
// increments gap_version exactly once for this receipt and returns decimal version.
```

- [ ] Add `provider_state.gap_version bigint NOT NULL DEFAULT 0 CHECK(gap_version>=0)`. Add `provider_events.resolution_version bigint NOT NULL DEFAULT 0`, `resolved_at`, `resolved_by`, `resolution_ref`, `variant_overflow boolean NOT NULL DEFAULT false`, `overflow_receipts bigint NOT NULL DEFAULT 0`, `last_overflow_hash char(64)`.
- [ ] Add `provider_event_variants(event_id UUID REFERENCES provider_events ON DELETE CASCADE, semantic_hash char(64), sender_id varchar(200), kind text, text text CHECK(length(text)<=10000), client_id varchar(200), provider_timestamp varchar(64), received_at timestamptz, PRIMARY KEY(event_id,semantic_hash))`. Retain at most 8 differing normalized payloads per canonical event; canonical row is separate. This is bounded normalized evidence, never raw SDK JSON or URLs.
- [ ] RED tests for two changed variants, exact replay dedup, canonical preservation, overflow at ninth differing variant, resolution invalidated by a new variant, and bigint precision. Existing conversation row lock serializes variant admission. On overflow retain first 8, set overflow flag, increment bounded-storage receipt counter and replace only last_overflow_hash; never store unbounded payloads.
- [ ] First conflict/new differing hash invalidates prior resolution, increments resolution_version, records fixed audit and calls recordProviderFault. An unresolved conflict replay continues to reassert quarantine as existing policy requires. Known canonical/retained variant replay after explicit resolution is an observed known receipt and does not invent a new resolution or payload. A genuinely new variant reopens conflict. Overflow is permanently unresolved in this initial UI/service; no force-clear endpoint. Document escalation/investigation instead of pretending evidence is complete.
- [ ] Route all gap-producing paths through the same transactional version increment: store conflict, owned runtime connection/ingress faults, ownership healthy uncertainty/fencing acknowledgement and restore quarantine. Database-loss paths may fail to persist; durable nonidle ownership must still block takeover. Do not claim a failed write incremented the version.
- [ ] Keep fixed bounded fault codes. Ordinary inbound receipt/heartbeat, mock status change and successful socket reconnect must not clear reconciliation or reset version.
- [ ] Run focused SQL tests and independent review. No local EPERM failure counts as a pass.

## Task 2 — recovery service and exact-ID confirmation

Files: new `server/connector-operations.ts`; tests `tests/backend/connector-operations.test.ts`; existing `server/provider-store.ts` only if a narrow audited helper is necessary.

Interfaces (caller owns explicit transaction):

```ts
type OperationActor={id:string};
confirmUnknownPart(db, actor:OperationActor, input:{
  messageId:string; part:number; eventId:string; expectedResolutionVersion:string;
  evidenceRef:string; confirmProviderIdObserved:true;
}):Promise<{messageStatus:'unknown'|'sent'}>;
resolveKnownConflict(db, actor:OperationActor, input:{
  eventId:string; expectedResolutionVersion:string; expectedVariantHashes:string[];
  decision:'retain-canonical'; evidenceRef:string; confirmExternalReview:true;
}):Promise<void>;
acknowledgeProviderGap(db, actor:OperationActor, input:{
  expectedGapVersion:string; expectedOwnerId:string|null; expectedOwnerEpoch:string;
  evidenceRef:string; confirmHistoryReviewed:true;
}):Promise<void>;
```

- [ ] Share one explicit-transaction/current-admin helper: staff-change shared lock, current active ACCOUNT admin `FOR SHARE`, validated actor/UUID/version/reference, fixed safe error. Acquire per-job `pg_try_advisory_xact_lock(73001)` before manual delivery reconciliation; fail while another worker holds it. Match existing worker lock ordering: worker lock, outbox lock, conversation lock, part/event checks. Do not introduce a second concurrent dispatcher.
- [ ] `confirmUnknownPart` requires message and outbox unknown, selected part unknown, same-account/conversation outbound event held and nonconflicting, exact observed provider ID, matching resolution version and no prior competing mapping/native projection. Run `recordPartAccepted` with the event's exact ID; never accept caller text/time/provider-ID-only guesses. Evidence reference is an administrator attestation, not proof independently established by this software.
- [ ] If all parts are sent/skipped, finalize message/outbox sent using first real accepted ID and reconcile held self events in the same transaction; preserve actor and confirmed parts. Otherwise message/outbox remain unknown. Record `connector.part_confirmed` with admin, message/part/event/scoped ID and evidence reference atomically. No SDK method is called.
- [ ] `resolveKnownConflict` requires exact current version/hash set, no overflow and explicit external review. Preserve canonical message/body and all variant rows; record chosen canonical decision/admin/reference and resolved timestamp, increment resolution_version, append `connector.conflict_resolved`. Do not set the provider connected or clear the gap here. A new variant must reopen it.
- [ ] `acknowledgeProviderGap` locks ownership and provider row, compares exact gap version and owner/epoch, refuses reserved/uncertain owner, unresolved conflict/overflow, held events and unknown/processing jobs. Permit pristine/externally-fenced idle or matching active owner only. Requires external history review attestation. Set reconciliation_required=false/fault_code=NULL with CAS; keep status disconnected. Append `connector.gap_acknowledged` with prior version/owner and evidence reference. No automatic history-completeness claim.
- [ ] Owned runtime may mark status connected only after a fresh actual connected event plus current owner and unchanged gap-version/reconciliation checks; a gap acknowledgement alone never means connected. Race tests cover fault after acknowledgement and owner revocation during it.
- [ ] Keep unsupported unresolved cases visible and blocked: no arbitrary native classification, abandoned-unknown reset, deletion, overflow clear or automatic retry command in this phase.
- [ ] RED/GREEN tests: role/inactive/cross-account denials, outside-TX denial, stale version/hash/owner conflicts, reused ID across threads/directions, accepted-ID competition, partial confirmation preservation, two-operator race, no SDK calls, new fault vs acknowledgement and immutable actor audit. Review before HTTP integration.

## Task 3 — authenticated routes and operator UI

Files: `server/app.ts`, `client/src/api.ts`, new `client/src/ConnectorOperations.tsx`, existing `client/src/App.tsx`/styles; tests `tests/backend/connector-operations-http.test.ts`, `tests/e2e/connector-operations.spec.ts`.

Routes (all existing private authenticated application, no new listener):

- `GET /api/provider`: safe additive fields `reconciliationRequired`, `gapVersion`, counts `{held,unresolvedConflicts,unknownJobs}`, `ownershipPhase`. No owner details/session identifiers for ordinary staff. Existing mode/status remains honest when disabled.
- `GET /api/provider/operations`: current-admin only; ownership identity/epoch, fixed fault, timestamps and aggregate counts. No cookies/raw SDK/locators.
- `GET /api/provider/operations/events?state=held|conflict&limit=1..50&cursor=...`: admin-only keyset `(received_at,id)` pagination, ACCOUNT filter, bounded summaries. Separate selected-event detail returns canonical/retained normalized variants, exact IDs, version and overflow flag; no unbounded all-history response.
- `GET /api/provider/operations/unknown?limit=1..50&cursor=...`: admin-only keyset jobs/parts with accepted IDs and private attachment metadata, not byte contents.
- `POST /api/provider/operations/confirm-part`, `/resolve-conflict`, `/ack-gap`: strict bodies above, existing request transaction and current-admin recheck, fixed 409 for stale state, no reset/resend.
- `POST /api/provider/operations/ack-fence`: strict existing fence service input, authenticated transaction/current admin. Invoke `acknowledgeConnectorFence`; do not duplicate or weaken its lifetime lock/CAS. Display existing external-fencing runbook and explicit attestation.

- [ ] Write HTTP role/CSRF/Origin/stale-session/concurrent-revocation tests before routing. Check GET pagination bounds and account isolation. Catch safe operation errors into fixed user messages without exposing SQL.
- [ ] Add admin-only “Đối soát Zalo” screen. Separate status cards for mode, connection, ownership and reconciliation; counts link to paginated lists. Show no “connected” success while reconciliation is required. Supervisors/agents retain informational banner only.
- [ ] Detail confirmation shows exact conversation/message/part/provider event/ID and accepted parts; requires evidence reference and explicit acknowledgement, disables action on overflow/ambiguous/prerequisite failure. Refresh on 409 instead of retrying a mutation silently. No bulk-confirm or retry button.
- [ ] Unknown message copy continues “Kết quả chưa xác định. Không gửi lại để tránh trùng tin.” Native/shared actor NULL renders “Zalo / thiết bị khác”; a missing known staff name may remain “Đội ngũ”. No text/time inference in UI.
- [ ] Browser tests use synthetic fixture state, four distinct staff sessions and admin recovery view: agent/supervisor denied; admin exact-ID confirmation preserves original actor and produces no new send; stale gap page cannot clear a newly injected fault; label native sender honestly; keyboard/focus/loading/error states. State precisely whether SDK/phone are simulated.

## Task 4 — durability, evidence and runbooks

Files: `ops/counts.sql`, `ops/integrity.sql`, `ops/ci-provider-journal.ts`, `ops/ci-backup-drill.sh`, `ops/restore.sh`, `docs/operations/CONNECTOR-OPERATIONS.md`, readiness/evidence.

- [ ] Add conflict-variant table to counts/full-row fingerprints. Guarded fixture retains at least two normalized variants, resolved metadata, unresolved conflict, held event, unknown job and nonzero gap version. Assert exact hashes/admin linkage survive unclean restart and fresh encrypted restore before quarantine.
- [ ] Restore increments gap_version while setting disconnected/reconciliation_required and retaining uncertainty/evidence. No restored session or job becomes dispatchable. Existing bound-media/ownership/audit assertions remain.
- [ ] Runbook explains evidence attestation limitations, exact-ID-only recovery, externally verified fencing, no retry/reset, overflow escalation, retained customer-content access/retention and separate live history review. No claim the system verifies external firewall truth or real-provider completeness.
- [ ] Full build, SQL/concurrency/crash, four-client/browser, load, backup/restore and independent whole-delta review. Record tested source SHA and PASS/FAIL/UNPROVEN. Actual Zalo delivery, phone coexistence and production readiness remain separate acceptance gates.

## Execution ledger

Task1 versioned faults/evidence passed hostedCI40997300485/source945d30f3 with136units and variant/gap restart/restore. Tasks2service and3UI implemented and independently reviewed conditionalSQL/browser;3pure service cases/typecheck PASS. HTTP routes implemented; cursor year0000 defect reproduced/corrected and independently re-reviewed. Four-staff actual-browser recovery test uses an independently guarded disposable database to avoid the main worker's database-wide lock. Operator positive resolution/admin metadata and exhausted-version restore fixtures are included in the next snapshot; runtime assertions remain pending CI. No actual SDK, Zalo account, phone or production action.

- Coordinating full client/server build PASS and4/4pure service/cursor checks PASS. All scoped source reviews accepted; realSQL/HTTP/four-browser/restore assertions remain pending the operator snapshot CI.

- HostedCI41026456993/source4dd6f300 passed145units/2SDKguards/9browser cases (1skip), fourstaffactualbrowserrecovery and positive resolved/admin/MAX restore fixtures. FirstoperatorCI41024495394 failed canonical exact-text UI assertion after145units/8browserpasses; separatedparagraph fixedit, allstagesreran/passed. Operatorofflinephaseaccepted, actualexternalfencing/phone/historyreview remainsunproven.
