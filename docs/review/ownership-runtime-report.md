# Injected owned connector runtime report

Implemented Task3 of docs/plans/connector-ownership.md. No live executable/configuration, SDK import/default authentication, real login/phone/customer data or external network was introduced. This is a single-lifetime injected runtime: stop/revocation is terminal; replacement requires a fresh instance and durable admission/external-fence policy.

## Boundaries

- Ownership reservation is acquired before facade/vault construction. Every API factory/reconnect and session persistence checks current ownership; initialization results are fenced after awaits. Stop fences a pending factory, disposes late facade/transport/API resources, observes late promises and sanitizes cleanup errors.
- Runtime exposes guarded runOnce/persistSession, not its provider/raw API/session. Provider ownership is checked before dispatch and after SDK completion. A result after owner loss is uncertain; it cannot become ProviderNotDispatchedError or an automatic retry. Existing accepted parts remain durable.
- Ingress uses both a local assertCurrent check and a token-conditional owner row SHARE lock inside the existing projection transaction. Context-free ingestion remains available only for explicit synthetic fixtures. Matching durable token alone cannot prove session liveness after database-session death; the local runtime gate is mandatory. A reserved/active durable row remains conservative takeover protection if loss cannot be persisted.
- Fault observation blocks dispatch synchronously before pooled persistence. The fault transaction locks the matching owner row FOR SHARE before updating provider state/audit, so a callback cannot cross a fence/new-epoch change and disconnect the replacement. A retained stale callback after new epoch is a hosted regression. SET LOCAL statement_timeout=2000ms bounds server-side fault lock/query work. Pool acquisition and a broken network may still wait beyond that server deadline; local gap/terminal gates remain closed, and no automatic takeover is inferred.
- The local gap gate never clears itself after reconnect. It requires a separately designed privileged reconciliation/restart procedure; this library conservatively needs a new explicitly fenced/admitted runtime to resume. Runtime active means ownership initialization completed, not confirmed provider delivery or gap-free history.

## Executed evidence

- Initial runtime tests failed with missing connector-runtime module before implementation.
- Nine focused runtime cases PASS: failed admission gives zero factories; reserve-before-factory/single-flight; late facade/transport disposal; reconnect/session refusal after revoke; actual transport/bridge call finishing after revoke stays uncertain with one call; safe factory/cleanup failure; synchronous local fault gate plus transaction lock order; late API error sink.
- Reviewer found P2 late-API error sink omission. New regression first failed with unwanted late error, then passed after both discarded-API branches install a permanent sink before stop. Original finding retained by independent review.
- Earlier complete transport/facade/vault run passed54/54 (six runtime cases), actual guarded SDK cases2/2; three new runtime cases subsequently passed in the focused nine-case run. Final coordinating full run is required for the final snapshot.
- npm run typecheck PASS after all current runtime/provider/store/SQL test edits; git diff --check PASS.

## Hosted-only evidence

Four PostgreSQL cases are authored but not executed locally because the already established local PostgreSQL EPERM remains: valid/stale owned ingestion and migration; one runtime/four distinct staff intents/contender refusal/database-backend loss/fenced next epoch; accepted SDK-shaped call followed by lifetime DB loss persisted unknown with no resend; retained old fault callback cannot mutate newer provider state/audit. These are synthetic SDK-shaped and database tests, not four physical workstations, an actual provider-side fence or phone operation. Root must run hosted SQL/restart/restore/whole-branch checks before acceptance. No production-ready claim.
