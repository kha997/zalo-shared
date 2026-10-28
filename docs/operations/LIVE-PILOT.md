# Personal Zalo pilot handoff

Prepared 2026-10-28. **Runbook preparation only: live integration is not complete and this document grants no production approval.** See [current evidence and open gates](../READINESS.md) and [operations runbook](RUNBOOK.md).

## Present boundary

The current application is an original Fastify/React/PostgreSQL shared inbox with individual admin, supervisor and agent identities, durable application messages/outbox and a simulator. Staff use the application; they do not each start a Zalo session. One backend transport would own the personal account connection.

An offline injectable Zalo transport, AES-GCM vault and gated session facade exist, but **are not wired into the application/worker**. Exact SDK2.2.0 is development-only: guarded tests import the actual ESM/CJS package and models without login; session tests inject fake login. The facade denies access before vault/import unless explicitly authorized. There is no enabled application SDK login or QR path. Configuration currently accepts only `disabled` or `mock` provider modes and rejects live mode. Recorded simulator, browser-context and HTTP load results do not establish real delivery, four physical workstations or owner-phone coexistence.

## Engineering work before owner participation

These tasks can proceed without account credentials or a QR login:

1. Select and review an exact SDK revision/version, license and notices; pin dependency/lockfile, inspect install scripts and advisories, and record reproducible build evidence. The development baseline now pins npm2.2.0 with artifact/license evidence; registry gitHead differs from the historical research source. Hosted advisory/signature verification and future production promotion remain separate gates.
2. Implement an explicit, disabled-by-default live configuration path with private deployment boundaries, fail-closed startup and no automatic authentication. Keep ordinary application staff excluded from account/session operations; add secret redaction, vault recovery and key-rotation procedures.
3. Bridge the worker to the injectable transport with actual text/media inputs, attachment-level progress and honest confirmed/unknown outcomes. Preserve request-key idempotency after reassignment. Never automatically resend an ambiguous accepted send.
4. Wire inbound events to a durable transaction: scoped provider-ID deduplication, message/conversation update and audit before local acceptance. Reconcile self-echoes to original sends; attribute native-phone sends to native/shared identity rather than inventing a staff actor. Do not assume history/backfill is available.
5. Implement bounded, durable media ingestion/storage and retrieval, content validation, retention and restore verification. Explicitly reject unsupported formats. Test multipart failure without silently losing later parts or resending confirmed parts.
6. Specify and test exclusive connection ownership, shutdown/reconnect cancellation and takeover. A PostgreSQL advisory lock cannot prevent a paused old process from sending after it loses its DB connection. Require confirmed old-owner termination or independently enforced egress fencing before live takeover; no active-active listeners.
7. Run injected transport contract/security/failure tests: timeout after acceptance, crash before mapping, duplicate/reordered callbacks, self-echo, media failures, revocation/CSRF/IDOR, secret leakage, restart and fresh-database restore. Record these as offline results, not provider results.

Notify the owner when this engineering gate is complete and the next necessary step is private real-account login or an observation only Zalo can supply. Do not ask for secrets to finish offline work.

## Owner preparation checklist — needed only at the live gate

- Arrange a legitimately owned dedicated test personal account/device and one consenting test peer; use synthetic contacts/content only, with no production/customer history. Record the owner's explicit consent to the limited pilot and residual unofficial-client/terms/account-restriction risk.
- Have the owner available on the official phone to authorize a private QR interaction, inspect warnings, revoke the test session and restore official-phone use. **Never send passwords, cookies, tokens, QR images or session material in chat, repository issues, screenshots or evidence archives.** QR participation occurs directly in the private pilot environment under the owner's control.
- Prepare four physical staff workstations with distinct application users, private LAN/VPN and TLS ingress; choose an operator, test window, peer and stop/recovery contact. Staff must not start competing Zalo Web listeners.
- Agree supported message/media types, latency and recovery thresholds, backup RPO/RTO, evidence retention and a 7–14 day low-volume window. Suggested historical thresholds require explicit adoption and measurement; they are not present guarantees.

## Live-only gates

Run only after the offline gate and owner participation are ready. The [historical research protocol](../research/PILOT-PROTOCOL.md) supplies detailed test IDs/counts and failure scenarios. **Its Chatwoot/bridge/webhook/Redis architecture is historical:** map its tests onto this original app, PostgreSQL, worker and transport; do not deploy Chatwoot or assume its webhook behavior applies here.

| Gate | Required real-provider evidence |
| --- | --- |
| Four workstations and collisions | Four physical machines concurrently receive/send with separate application identities; assignment conflicts are explicit; intended messages survive and same-key retries do not duplicate. Browser contexts alone do not satisfy this gate. |
| Owner phone | Phone remains usable while staff operate; phone-originated messages and echoes reconcile once with accurate shared/native attribution. Record phone/OS/Zalo versions and network transitions. |
| Delivery and media | Verify both directions with the consenting peer, supported text/media types, rejection/limits and multipart partial failure. Compare downloaded hashes where originals are preserved; distinguish transformed previews and receipt semantics. |
| Invalidation | Owner-controlled revocation/expiry and a deliberately competing test web session stop sends safely, show reauthentication-needed state and do not leak credentials or trigger retry storms. |
| Reconnect and recovery | Network interruptions, worker restart and post-acceptance crash preserve committed state; unknown sends remain held. Measure gaps/history recovery and prove one active listener plus fenced takeover. Do not infer missing-history recovery from reconnect success. |
| Restore and soak | Restore isolated DB/media/keys with dispatch quarantined, then reconcile before reconnect. Observe 7–14 days of low-volume synthetic operation including overnight idle, daily phone checks and recovery drills. No unexplained gaps/duplicates, forced logouts or warnings. |

Stop immediately on account warning/restriction, unauthorized disclosure, credential leakage, repeated listener eviction, unexplained missing/duplicate sends or uncertain exclusive ownership. Disable dispatch, preserve sanitized evidence and have the owner revoke the test session. Do not evade detection or automate replacement accounts. A passing pilot cannot establish ban safety; production requires a separate explicit decision.

## Acceptance record

For each case record: `run_id`, `test_id`, UTC start/end, source SHA and lock hash, sanitized environment/device/version, actor role/workstation, synthetic local/request/provider correlation IDs, expected and observed counts/outcomes, latency/recovery measurements, `PASS|FAIL|UNPROVEN`, evidence path, limitation, operator and follow-up owner. Keep secrets and real account identifiers out of the record.

Record owner pilot consent/risk decision by reference, supported-type matrix, adopted thresholds, stop incidents, restore RPO/RTO and final unresolved gates. Distinguish offline-injected, browser-context, physical-workstation and real-provider evidence explicitly. Any blocked or unperformed case remains UNPROVEN.
