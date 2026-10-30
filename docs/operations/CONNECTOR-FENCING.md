# Connector ownership and external fencing

This library is not enabled in the running application. No command or environment variable in this phase enables real login. One connector owner is independent of staff count: staff replicas share the database/outbox, while one dedicated PostgreSQL session holds lock `(73002,1)` before any external initialization.

A committed ownership reservation remains blocking after process crash, graceful stop, database loss or uncertain initialization. The owner epoch is a decimal bigint string. Missing heartbeat, elapsed time, a released database lock or killing a PostgreSQL backend do not prove the old process stopped sending to Zalo. These conditions never permit automatic takeover. Transport stop and SDK close likewise cannot cancel an already entered external operation.

Before acknowledging an old owner as fenced, an administrator must identify its exact deployment/owner UUID/epoch, stop its workload and deny its provider egress or remove its network/workload credential capability, then independently verify termination. If the old workload cannot be located or its external capability cannot be excluded, leave it blocked. Revoking an upstream session is an additional dedicated-account operator decision; it is not performed by this library or during offline tests.

Record only a nonsecret stable evidence reference (for example `incident-42/fence-verified`), never an access token, cookie, password or credential URL. The acknowledgement function rejects URL syntax and control characters. Application audit records the administrator's attestation; it cannot independently verify firewall or orchestrator truth.

The future private operator control must show expected owner UUID and epoch, require explicit external-fence acknowledgement, carry normal session/CSRF/Origin checks, and call `acknowledgeConnectorFence` inside its authenticated transaction. The service rechecks current active administrator role, locks against staff-role changes and refuses acknowledgement while another session holds the lifetime lock. A stale owner/epoch or replay is rejected.

Acknowledgement sets ownership idle but retains the prior owner/epoch in fencing history and leaves provider status disconnected with reconciliation required. It never retries a message, clears an unknown delivery or clears an event gap. Separately reconcile provider events and unresolved sends before enabling any connection. Restored ownership also requires conservative quarantine; completing that restore integration is a later task.

Database ownership guards local admission only. They do not provide provider-side fencing or reliable automatic failover. Actual Zalo session behavior and phone coexistence remain unproven until the approved dedicated-account pilot.
