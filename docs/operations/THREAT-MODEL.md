# Pilot threat model

Assets: staff passwords/session material, private contact/message/media bytes, provider identity, attributable audit, durable delivery status and recovery keys. Trust boundaries: browser to same-origin API; API/worker to private PostgreSQL; operator to Docker/host; CI to repository/dependencies; backup host to offline identity storage. No real provider boundary is implemented.

| Threat | Control and residual limit |
| --- | --- |
| Internet scanning / DB exposure | Loopback API publication, no database publication, internal network. Host/Docker administrators bypass these boundaries. |
| Stolen or stale staff authority | Hashed opaque sessions, active role checks, admin disable/revoke tests. A stolen active session remains authoritative until revoked/expired. |
| Browser forgery or script injection | Origin + CSRF enforcement, HttpOnly/SameSite cookies, React escaping, bounded private attachments and safe content disposition. Verify browser tests; local HTTP is loopback only. |
| Duplicate or ambiguous remote send | Transactional outbox and request keys; uncertain execution becomes unknown. No claim of remote exactly-once; future live takeover requires external fencing. |
| Data exfiltration through media/logs | Authenticated byte reads, no URL fetch, body/token redaction, private backup encryption. Authorized staff still see workspace conversations under current role policy. |
| Backup theft or replay | age authentication/encryption, independent identity custody, hashes/count checks, fresh isolated restore, revoked sessions and quarantined jobs. Operator mistakes and key loss still threaten availability. |
| Audit tampering | Runtime DB privilege separation required; application append-only is not independent tamper proof. DB owner can alter local evidence; external protected sink is future work. |
| Compromised dependency or CI action | Lockfile npm ci, exact action commits and image version tags. Digests/advisories/provenance must be independently checked; no deployment credentials in CI. |
| Resource exhaustion | Input limits, login throttling, bounded queries and measured load. Pilot monitoring/retention/storage budgets still require owner targets. |

Do not place real account or customer data in this synthetic pilot until live security and recovery gates in RUNBOOK are accepted. No external telemetry, public hosting or infrastructure spending is configured.

Image audit: CI uses the official Trivy0.76.1 Linux64 release with SHA256c7cbe3137fb8a48a17574bede3dd6beb16742d1e9772929940fc90082c39d9c0 verified against GitHub release asset metadata. The scanner reads a saved image archive, without access to Docker's privileged socket. Full high/critical findings are retained; fixable high/critical findings fail CI. Unfixed findings require explicit assessment before production; a passing scan is not a guarantee of absence of vulnerabilities.
