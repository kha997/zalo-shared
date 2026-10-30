# Cost planning for the current architecture

Prepared 2026-10-28. All amounts below are **USD planning ranges per month**, not vendor quotes, invoices, committed spend or measured operating costs. Taxes, exchange rates and regional/data-residency requirements are excluded. See the [project scope](../../README.md), [readiness evidence](../READINESS.md) and [operations runbook](RUNBOOK.md).

The current design is an original Fastify/React application with PostgreSQL, private attachment storage in the database, a worker and optional monitoring. It does not deploy Chatwoot, so there is **no Chatwoot per-seat charge** in this estimate. There is no implemented software seat cap; that does not imply unlimited infrastructure capacity. The owner has not resolved the original repository's license choice. Review dependency and future SDK licenses separately before distribution or business deployment; a public repository is not itself a license grant.

## Small private pilot

Assume one non-HA host, synthetic low-volume traffic, modest attachment retention, private access and one operator. A candidate starting allocation is 2–4 vCPU, 4–8 GB RAM and 40–100 GB disk, subject to measured application/DB/monitoring memory and storage use. This is a sizing assumption, not a demonstrated user or message capacity.

| Item | Monthly planning allowance | Scope |
| --- | ---: | --- |
| Single host and primary disk | $20–60 | Application, PostgreSQL and worker; host loss interrupts service. Confirm whether disk and traffic are included in an eventual quote. |
| Encrypted off-host backup | $5–20 | Modest retained backups; encryption/key recovery and restore drills still require operator work. |
| Private access, DNS and TLS | $0–15 | Existing private VPN/LAN and certificate automation can minimize recurring service charges; domain cost, if needed, is annual cost amortized. Setup time is labor. |
| Monitoring and notification | $0–15 | Local metrics and modest external checks/notification allowance; local-only monitoring cannot report total host loss reliably. |
| Additional storage/egress contingency | $5–25 | Beyond assumed included disk/traffic; avoid double-counting included allowances when obtaining quotes. |
| **Infrastructure planning subtotal** | **$30–135** | No paid support, HA or managed database assumed. |
| Operations labor | **$100–600** | **4–12 hours/month at $25–50/hour**; actual effort can exceed this during incidents or platform changes. |
| **Ongoing total including labor** | **$130–735** | A planning envelope, not a promised bill. |

Operations includes dependency/OS updates, backup and restore checks, monitoring review, storage/retention management, staff access changes, incident response and eventual provider-session recovery. Owner and staff participation time, test phone/account connectivity, legal/licensing review and business disruption from account restriction are not priced here. No official personal-Zalo API/service fee is assumed or quoted; future lawful access arrangements may change cost and feasibility.

Attachment volume usually drives growth: retained original bytes, database overhead, indexes, WAL, backup copies and restore workspace all consume space. Full backup retention can multiply storage; measure actual compression and retention. Media downloads and restores can dominate egress. Set quotas/retention and obtain provider-specific storage, traffic and snapshot prices before purchasing.

## One-time engineering still required

The offline injectable transport/vault is **not wired into the application or worker**; no live SDK/QR path is enabled. The [live-pilot handoff](LIVE-PILOT.md) defines remaining SDK/version/license review, configuration, durable inbound/self-echo handling, real media integration, fencing, key recovery and injected/live acceptance work.

Allow **80–200 engineering hours ($2,000–10,000 at $25–50/hour)** for that remaining integration, security hardening and acceptance preparation as an initial budgeting range. Unknown SDK behavior, history gaps, media failures or unavailable provider idempotency can exceed it or prevent acceptance; it is not a fixed-price estimate or a statement that the work is done. Plan separately for **2–4 operator days** spread across a **7–14 day** owner-participating low-volume pilot; do not add those days twice if the same person's hours are already included. Production deployment, high availability and ongoing support contracts require separate scoping.

## Larger deployment and availability

Do not derive infrastructure prices or staff-seat capacity from the recorded API load runs. They measure particular synthetic workloads, datasets and runner conditions; they do not measure real Zalo throughput, browser fleet behavior, media retention or production soak. Obtain representative workload measurements and availability targets before selecting a larger host, managed DB, separate media store, independent monitoring or redundant application instances.

A future multi-host/managed-service footprint might require **$150–600+/month infrastructure**, but this is an order-of-magnitude budgeting placeholder, not an HA design, quote or demonstrated requirement. Storage, regional service pricing, backup/egress and on-call expectations can move it substantially. Re-estimate labor as well rather than carrying the small-pilot allowance forward.

Application/DB redundancy does not permit active-active personal-Zalo transports. One live account must have one exclusive listener/sender; safe takeover requires enforced fencing or confirmed old-owner termination. A second worker or host alone does not establish uninterrupted service or duplicate-free failover. Production authorization and real-provider risk acceptance remain separate from any infrastructure budget.
