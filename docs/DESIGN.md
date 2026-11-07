# Zalo Shared — implementation design

Owner directive 2026-10-27 delegates design, implementation and review decisions to Engineering Lead. No real Zalo authentication, production deployment or irreversible action is authorized. This design is the lead's decision under that directive, not a production approval.

## Decision and alternatives

The research preferred hardened zca-bridge + Chatwoot over unchanged prototypes. Shipping that unchanged retains observed authorization and partial-delivery defects; maintaining a deep Chatwoot integration also introduces two message stores and delivery gaps. Original inbox/control-plane code with a narrowly scoped adapter boundary gives testable ownership of authorization, transactions, per-attachment progress and audit. Choose original TypeScript/Fastify + PostgreSQL + React with a deterministic provider simulator as default. MIT zca-js remains a future transport integration; there is no live personal-account connector enabled in this release. This costs more development and makes live readiness an explicit open gate. No unlicensed upstream application source is redistributed.

## Invariants

- One workspace and shared Zalo identity; any number of named staff, bounded only by measured capacity and configured resources. Roles admin/supervisor/agent. No public registration or default credentials.
- Authenticated HttpOnly opaque sessions stored hashed in PostgreSQL; password scrypt; current role/active state checked on each request; same-origin mutations plus CSRF token, throttled login, bounded schemas. Agents cannot access provider/session/admin controls.
- PostgreSQL is source of truth. Persist inbound provider IDs uniquely per account/thread; transactional message/outbox/audit insertion. Client Idempotency-Key maps one logical send per actor/conversation/key with payload mismatch rejection. Assignment requires expected version and authorization; agents send only when assigned to themselves; admin/supervisor can reassign.
- Durable outbox pending -> processing -> sent/failed/unknown. Claim work with row locking; single provider worker. Once external execution may have occurred, interruption/uncertain error produces unknown, never automatic resend. Simulator supports idempotency to test reconciliation; live provider has no assumed exactly-once guarantee.
- Only one provider worker runs. Advisory locking is a DB coordination aid, not a guarantee against a paused stale process sending externally. Real-provider failover requires operator fencing/confirmed old owner termination; no active-active.
- Metadata and attachments carry actor, direction, status and timestamps. Synthetic attachments stored privately, bounded size/type, authenticated reads; no arbitrary URL fetch. No promise of voice/video/real Zalo delivery until provider type tests.
- Audit events appended in same transactions as critical changes; app cannot update/delete audit rows; export restricted to admins/supervisors, logs redact session/password/message bodies. Append-only application controls are not independent tamper proof against DB administrators.
- Private/loopback local API; no telemetry/public deployment. Dev mock controls off unless explicitly enabled and admin-authorized. Mock reset endpoints never exist in production configuration.

## Product

Vietnamese inbox with login, searchable conversation list, assignment/unread/status filters, message timeline, text and bounded file composer, per-message delivery states, explicit disconnected/unknown warnings, staff administration (admin) and audit screen (admin/supervisor). Responsive keyboard-accessible layout, clear loading/empty/error states. Polling initially every 2 seconds with authenticated endpoints; do not claim realtime capacity until measured. Independent browser contexts validate 4 actual UI sessions; no claim of 4 physical workstations if only browser profiles were exercised.

## Deployment and evidence

One app + one worker + PostgreSQL and private media volume in Docker Compose. Multiple stateless app replicas can be tested later; provider worker never scales horizontally for one account. Local build/test, actual PostgreSQL integration and browser tests, load runs at 4/10/25/50 users, security tests, persistence restart and backup restore proof. Record measured throughput/latencies/errors and environment rather than extrapolate. CI builds and tests only, no deployment workflow. SBOM/advisory results and runbooks tracked.

Production-ready gate remains closed until live approved separate-account phone/text/media/invalidation/reconnect soak, real failover fencing, independent security review, backup restore drill, dependency/image verification and Owner's risk acceptance. Being feature-complete under simulator is not platform readiness.
