# Private pilot connector operations

Prepared 2026-11-02. **Activation pending.** This document authorizes no real login, QR scan, account activation, deployment or production use. The Owner approved D1–D7 **in scope** ([G5-SCOPE-APPROVAL.md](../evidence/G5-SCOPE-APPROVAL.md)) but has not authorized live activation; the network boundary is now verified (`G5A_NETWORK_BOUNDARY_VERIFIED`) and a new G5-A authorization is required before activation ([G5-LIVE-PILOT-PROCEDURE.md](G5-LIVE-PILOT-PROCEDURE.md)). See [READINESS.md](../READINESS.md) for PASS/FAIL/UNPROVEN evidence.

## Boundary

The pilot connector is a **separate, intentionally SDK-bearing image**. The application image (`ops/Dockerfile`) stays SDK-free and must keep passing the existing `zca-js`-absent assertion. The connector:

- publishes no ports and exposes no HTTP health, QR or session endpoint;
- defaults to `dry-run`, which validates a private manifest and touches no vault, SDK, database or network;
- runs as UID 65532 with a read-only root filesystem, no capabilities and `no-new-privileges`;
- never starts from ordinary application startup, CI test jobs or the default Compose stack.

## G5 approved scope (activation pending)

The Owner approved this narrower scope for the staged G5 pilot. It is enforced in addition to the generic policy below:

- exactly one dedicated account and exactly one allowlisted direct peer; enrollment is the only mode with a null account and zero peers;
- 1–10 outbound parts per account per day and a minimum 2000 ms interval;
- a 2-hour wall-clock cap per activated observe/send-test session, after which the loop stops with `session-limit`;
- text only: an outbound attachment request is refused before reservation or egress;
- no automatic reconnect (`maxReconnectAttempts: 0`); a lost connection becomes one durable fault and aborts the session;
- one stored-credential login per process, with no QR/password re-enrollment or retry loop, no automatic resend after an unknown result and no concurrent connector owner;
- `preflight` validates the exact stage manifest against these bounds offline and verifies that the manifest build block matches the image's `/app/build-identity.json`; the live command repeats the identity check before any key, session, database or SDK action;
- stage order `bootstrap` → `run-observe` → `run-send-test`, each with separate explicit Owner authorization.

Any broadening of account, peer, purposes, budget, interval, media, risk or window requires renewed Owner approval.

## Build identity

Record these values in the private manifest; they bind the grant to a reviewed artifact:

```bash
git rev-parse HEAD                                            # sourceCommit (40 hex)
sha256sum connector/package-lock.json                         # lockSha256 (64 hex)
node -e 'console.log(require("./connector/package-lock.json").packages["node_modules/zca-js"].integrity)'  # sdkIntegrity
```

The image build requires the same commit and embeds `/app/build-identity.json` derived from the actual build inputs:

```bash
docker build --build-arg SOURCE_COMMIT="$(git rev-parse HEAD)" \
  -f ops/Dockerfile.connector -t zalo-shared-connector:pilot .
```

At startup of every live command (bootstrap and both run modes), the runtime compares the embedded identity with the manifest's `build` block before reading the key, session, database URL or SDK. A manifest copied onto the host with a different commit, lock hash or SDK integrity is refused; the grant cannot be rebound to another artifact by editing the manifest alone. CI also asserts the image identity equals the checked-out commit and the connector lock.

This identity is build-derived, not a cryptographic attestation of the image contents: anyone able to rebuild or replace the image can write a matching file. The trust anchor is the **CI-built image digest recorded in the pipeline**; record it with the grant and deploy only that digest. The runtime cannot verify its own image provenance from inside the container, and `dry-run` validates the manifest shape only without reading `/app/build-identity.json`.

`connector/package.json` pins `zca-js@2.2.0`, `pg` and `ipaddr.js` exactly. The runtime stage installs only that lock with `--omit=dev --ignore-scripts`; it never copies or prunes the root development tree. `crypto-js@4.2.0` is a transitive, deprecated dependency of `zca-js`; this residual risk is recorded in the scan summary and remains an explicit live-promotion gate.

## Private files

Keep all material outside the repository, on the private pilot host:

| Path | Mode | Purpose |
| --- | --- | --- |
| `manifest.json` | 0600 | Build identity, Owner consent scope, expiring technical grant |
| `session.key` | 0600 | 32-byte AES-256-GCM session key; never in env, argv, Compose or images |
| `state/session.enc` | 0600 | Encrypted `{version:1,accountId,session}` record written by the connector |
| `state/view/` | 0700 | Local-only QR PNG directory; cleared after enrollment |
| `state/view/qr.png` | 0600 | Short-lived enrollment view; never copied to evidence |

`DATABASE_URL` must be a `postgres://` or `postgresql://` URL. A non-loopback host must also carry `sslmode=require`, `verify-ca` or `verify-full`; `ssl=false` is always refused. Loopback is accepted for a database on the same private host. The pilot connector never accepts a database, key or session value as a command argument.

On the G5-A host the database is the dedicated `pilot-postgres` container, not the shared host cluster. It is provisioned idempotently by [`ops/local/provision-pilot-db.sh`](../../ops/local/provision-pilot-db.sh) on the internal network `zalo-shared-pilot-db` (`172.16.30.0/24`). `DATABASE_URL` uses `sslmode=verify-full`. Because `requireTlsDatabaseUrl` refuses `sslrootcert` as a query parameter, the private CA is supplied as `NODE_EXTRA_CA_CERTS=/run/pilot/db-ca.crt` and mounted read-only; `NODE_EXTRA_CA_CERTS` adds a trust anchor and cannot disable verification. `pg_hba.conf` admits `hostssl` on the internal subnet with `scram-sha-256` and rejects `hostnossl`; the only `local` trust line is the container-private Unix socket. [G5A-DB-TLS-VERIFICATION.md](../evidence/G5A-DB-TLS-VERIFICATION.md) records the certificate, role and restore evidence.

The container runs as UID 65532, so bind-mounted files must be owned by that UID (or a host user with the same numeric UID). The connector rejects symlinks, non-regular files, wrong owners/modes and escaping directories on POSIX.

The session key and any media locator encryption key are separate capabilities with separate files. Select the envelope key identifier explicitly with `PILOT_KEY_ID` (default `v1`); it is bound into both the ciphertext envelope and the AES-GCM associated data, so a record written under one id cannot be read under another. Rotate by installing a new key file, selecting a new id, verifying decryption of a new session write, and only then retiring the old file after the agreed transition. There is no silent migration and no automatic key deletion. The pilot session path uses this private file store; the application's general credential vault is unchanged and is not used by the pilot connector.

## Connector egress boundary

The boundary is the **network topology**, not the Node.js guard. The connector is attached only to Docker networks declared `internal=true`, so its namespace has no default route and no external resolver, and an unknown destination fails at the kernel. The only workload with an uplink is `egress-gateway`, a separate distroless container that admits an exact allowlisted TLS SNI on port 443, resolves the name itself, validates that every answer is public unicast, and splices opaque bytes without intercepting TLS. Each decision is one JSON audit line. See [`docs/evidence/G5A-NETWORK-BOUNDARY.md`](../evidence/G5A-NETWORK-BOUNDARY.md) for the architecture, bypass matrix and verification.

The connector image preloads [`ops/pilot-egress-guard.cjs`](../../ops/pilot-egress-guard.cjs) through both `NODE_OPTIONS=--require=/app/egress-guard.cjs` and the image entrypoint (`/nodejs/bin/node --require=/app/egress-guard.cjs`). Clearing `NODE_OPTIONS` through an env file therefore does not remove the guard. The guard also sets a non-enumerable process marker; `preflight` and the live commands refuse when the image contains `/app/egress-guard.cjs` but the marker is absent, so a deliberate entrypoint override cannot run unguarded. The guard installs a default-deny layer before any application module or SDK is imported, so it does not depend on the SDK honouring a proxy or allowlist option.

`pilot-db` is operator-supplied from the compose file's point of view, but this host provisions it as a dedicated internal network; it cannot be declared internal by the service itself, so the precondition is checked twice: `ops/local/preflight-connector.sh` refuses unless `docker network inspect "$PILOT_DB_NETWORK"` reports `Internal=true`, and the image sets `PILOT_REQUIRE_INTERNAL_NETWORK=1`, which makes the guard refuse to start if the namespace has a usable IPv4 or IPv6 default route.

- `PILOT_EGRESS_HOSTS` is a comma-separated list of **exact** provider hostnames; wildcards, IP literals and trailing dots are refused. If it is empty or unset, every provider connection is denied. `PILOT_EGRESS_PORTS` defaults to `443`.
- The only other permitted destination is the exact `DATABASE_URL` host and port. Database query parameters that could redirect the target (`host`, `port`, `user`, `password`, `ssl`) cause the URL to be treated as unusable, and the connection is denied. Database addresses must resolve to private, loopback or unique-local space; public, link-local, multicast and metadata addresses are refused.
- Provider destinations must resolve only to public unicast addresses. Loopback, private, link-local, carrier-grade NAT, documentation, benchmarking, multicast and IPv4-mapped addresses are refused. This blocks DNS rebinding and direct-IP substitution.
- `dns.resolve*`, `lookupService` and `reverse` are denied. `dns.lookup` and the internal `net`/`tls` lookup admit only an allowlisted hostname, and every returned address is checked. `net.Socket.prototype.connect` injects the guarded lookup, so `fetch`, `http`, `https`, `http2`, `ws` and the SDK's WebSocket listener all pass through the same check.
- UDP (`dgram`), child processes and worker threads are denied. Proxy environment variables (`HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, lower-case variants and `NODE_USE_ENV_PROXY`) and `NODE_TLS_REJECT_UNAUTHORIZED=0` fail closed at startup. `checkUpdate` is disabled in the connector, and `registry.npmjs.org` would be denied anyway.
- The guard is process-local. It is not a network namespace, host firewall or sandbox: a host/Docker administrator, root in the container, a native addon, a replaced image, `process.binding` or a native constructor reached through a prototype chain can bypass it. The pinned SDK does not use those paths, and the image digest stays pinned, but the enforcement boundary is the internal-network topology plus the gateway. The guard is defense in depth. The local unit tests are in [`tests/backend/pilot-egress-guard.test.ts`](../../tests/backend/pilot-egress-guard.test.ts).

The pinned SDK source confirms static bootstrap hosts (`id.zalo.me`, `wpa.chat.zalo.me`, `jr.chat.zalo.me`), configuration-only references (`chat.zalo.me`, `zalo.me`), a disabled npm update check, and the regex-only `stc-zlogin.zdn.vn` string that is never dialled. It also receives `zpw_service_map_v3` and `zpw_ws` from `getServerInfo` after login; those are server-provided API and WebSocket hosts and cannot be enumerated safely offline. Do not invent or wildcard them. The three static names are admitted; everything else fails closed at the kernel and at the gateway. Under the revised gate (`R2_EGRESS_ENFORCEMENT_PASS`, bootstrap only), QR enrollment and stored-credential login may proceed under a new Owner authorization; observe and send-test remain blocked until their runtime-only hosts are observed and admitted, and no real Zalo traffic is permitted for endpoint discovery without a separate authorization. See [`docs/evidence/G5A-PROVIDER-ENDPOINT-POLICY.md`](../evidence/G5A-PROVIDER-ENDPOINT-POLICY.md).

### Inspecting private configuration

Never `cat`, `env`, `docker inspect` or otherwise print a private env file or container environment directly. Use the approved helper, which emits variable names only:

```bash
ops/private-env-keys.sh /private/pilot-private/app.env
ops/private-env-keys.sh --container zalo-shared-g2-app-1
```

When a diagnostic needs a value, prove a property instead of printing it (for example, compare parsed values in memory and print a boolean). The G5-A credential incident record documents why this rule exists: [G5A-CREDENTIAL-INCIDENT.md](../evidence/G5A-CREDENTIAL-INCIDENT.md).

## Binding the grant

A manifest contains exactly `version`, `build`, `consent` and `grant`. The grant is valid only when:

- `sourceCommit`, `lockSha256` and `sdkIntegrity` match the reviewed artifact recorded in `build`;
- `issuedAt <= now + 30s` and `expiresAt > now`; enrollment grants last at most 1 hour, observe/send-test at most 8 hours;
- `ownerConsentRef` matches the separate consent scope, and the purpose is allowed by that scope;
- observe/send-test carry a non-null exact `expectedAccountId` and 1–4 unique exact direct-peer IDs; **G5 uses exactly one peer**;
- an enrollment manifest may carry a null `expectedAccountId`, but its consent scope must then allow only `enroll-session` and may contain 0–4 peers; the enrollment manifest is never reused for observe or send;
- `maxPartsPerDay` is 1–30 and `minIntervalMs` is 2000–60000, within the consent limits; **G5 uses at most 10 parts/day and a 2-hour session**;
- expiration never exceeds `consent.notAfter`, and all timestamps use millisecond precision (`YYYY-MM-DDTHH:MM:SS.sssZ`).

A routine reviewed rebuild may receive a refreshed technical grant under the same consent reference. Broadened account, peers, purposes, budget, interval or risk requires a new Owner decision.

## Commands

The repository ships only [`ops/pilot-compose.example.yml`](../../ops/pilot-compose.example.yml). Copy it to a private path outside the repository (mode 0600) and render it with a private interpolation env file that sets `PILOT_CONNECTOR_IMAGE`, `PILOT_ENV_FILE`, `PILOT_MANIFEST_FILE`, `PILOT_KEY_FILE`, `PILOT_STATE_DIR` and `PILOT_DB_NETWORK`. The connector joins the operator-supplied `PILOT_DB_NETWORK`, which **must be `internal=true`** (checked by `preflight-connector.sh` and by the image at startup), plus the internal `pilot-egress` network. `egress-gateway` is the only member of the non-internal `pilot-uplink` network. The connector and gateway publish no ports and PostgreSQL stays unpublished.

```bash
# Default: offline gate only.
docker compose --env-file /private/pilot-interpolation.env -f /private/pilot-compose.yml run --rm pilot-connector

# Offline G5 scope check for the exact stage manifest (no network, no SDK, no DB).
docker compose --env-file /private/pilot-interpolation.env -f /private/pilot-compose.yml run --rm pilot-connector \
  dist/connector/tools/pilot-connector.js preflight

# Explicit one-time enrollment under an Owner-controlled phone interaction.
docker compose --env-file /private/pilot-interpolation.env -f /private/pilot-compose.yml run --rm pilot-connector \
  dist/connector/tools/pilot-connector.js bootstrap --acknowledge-pilot-risk

# Observe only: no dispatcher is constructed.
docker compose --env-file /private/pilot-interpolation.env -f /private/pilot-compose.yml run --rm pilot-connector \
  dist/connector/tools/pilot-connector.js run-observe --acknowledge-pilot-risk

# Send-test: allowlisted direct peers only, reserved budget per part.
docker compose --env-file /private/pilot-interpolation.env -f /private/pilot-compose.yml run --rm pilot-connector \
  dist/connector/tools/pilot-connector.js run-send-test --acknowledge-pilot-risk
```

`--manifest` (or `PILOT_MANIFEST`) must be an absolute path. Credentials, tokens, cookies, keys and URLs are never accepted as arguments. CLI output contains only the command, safe gate outcome, purpose and expiry.

### Local G5-A readiness stack

These scripts provision and verify the dedicated resources on the private host. They never log in, generate a real QR, contact a provider or admit a live grant.

```bash
# Dedicated TLS-only PostgreSQL on an internal network (idempotent).
bash ops/local/provision-pilot-db.sh
bash ops/local/verify-pilot-db-tls.sh

# Deploy and verify the reviewed internal-network + gateway topology.
bash ops/local/deploy-pilot-topology.sh
bash ops/local/verify-deployed-pilot.sh      # stops/restarts the dedicated gateway

# Bind and verify an enrollment-only template against the reviewed image.
node ops/local/make-enroll-fixtures.mjs      # writes only under the private directory
bash ops/local/verify-enrollment-readiness.sh

# Full deployed dry run with synthetic inputs.
bash ops/local/verify-local-dryrun.sh
```

`ops/local/verify-pilot-network.sh` remains the disposable-network suite (safe to run before deployment). `verify-deployed-pilot.sh` asserts the live deployment, including kernel-only denials with the guard absent, an empty policy, a stopped gateway and a wrong network attachment. Evidence is in `docs/evidence/G5A-*`.

Bootstrap writes the QR PNG only to the private view directory for the Owner to view on the local host; it never prints QR/token material, fetches avatars, starts a viewer or retries after expiry/decline. Enrollment requires a private local UID confirmation after final SDK resolution. Ordinary startup can never use the enrollment exception.

## Dispatch and inbound rules

- A successful start publishes `provider_state.status='connected'` only after ownership, the UID-bound facade, transport start and `markActive`, inside a transaction holding the active owner row. Publication is refused while `reconciliation_required` is set. Normal shutdown invalidates ownership and returns the row to `disconnected` with reconciliation required, exactly like the generic connector.
- Send-test reserves a durable per-account/UTC-day budget row before every external part, and the ledger also caps each grant at 10 parts so a midnight rollover cannot double a short session. Accepted, failed and unknown attempts consume the reservation; refunds never occur. A repeat reservation for the same part is refused before egress; the worker marks that row terminally `failed` with a `reservation-already-consumed` audit and does not halt the pilot. It is never resent.
- Only exact allowlisted direct peers (`threadType 0`) are dispatchable; groups and unlisted peers are refused before reservation. The worker claim itself is scoped to the grant peers, so mail for any other conversation is never claimed or marked failed.
- The bound account's own UID can never appear in the peer allowlist; it is rejected by the grant parser, provider, connector and CLI.
- Inbound persistence is limited to the bound account and the same allowlist. Unexpected direct peers, group events, a non-self sender that is not the peer, and a self sender that is not the bound account are dropped before persistence, without storing body, locator, identity or raw SDK error; the runtime reports only a count.
- The 1–4 peer allowlist is the generic pilot safety scope; G5 further restricts the connector to exactly one peer. This is not a product seat limit. The application itself has no seat cap.
- An expired grant, quota stop, lost ownership or uncertain result stops the loop. Local ownership gap state stays closed; do not add a permissive resume shortcut. Ownership recovery requires the reviewed admin reconciliation and externally verified old-owner termination.

## Media scope

The pilot runs with media scheduling disabled (`media:false`) and, under G5, a dispatch policy that rejects any outbound attachment before reservation or egress. Inbound media events are journaled only as unsupported metadata: no locator is captured, no CDN download is attempted and no bytes are stored. The locator key described above is provisioned separately and is not passed to the pilot connector in this mode.

Outbound media dispatch exists in the shared worker/provider code, but the pilot has no operator path to enqueue media and it has not been exercised against a provider. Real inbound media, CDN hosts, cookie-free downloads and outbound media delivery remain UNPROVEN; enabling media requires a separately reviewed private host policy and an Owner decision.

## Scanning and CI

```bash
docker build --build-arg SOURCE_COMMIT="$(git rev-parse HEAD)" \
  -f ops/Dockerfile.connector -t zalo-shared-connector:pilot .
bash ops/pilot-scan.sh zalo-shared-connector:pilot
```

The scanner records vulnerabilities, licenses, the resolved `zca-js` version, the embedded build identity and the runtime UID. It fails on any high/critical finding, any exposed port, a UID other than 65532, an unexpected SDK version, a missing/malformed build identity or any of the four known private filenames (`manifest.json`, `session.key`, `session.enc`, `qr.png`) under `/app` or `/run` (excluding `node_modules` and `.cache`); it is a filename/path scan, not a content scan of arbitrary artifacts. Hosted CI runs the image default `dry-run` with a synthetic manifest, no network namespace and fake-only evidence; it never imports the real SDK for a login.

## Backup and restore

Back up the encrypted session file, the separate key, the binding/budget database state and the current manifest/grant. A database backup without the key is not a session recovery proof. The offline restore drill (`tests/transport/pilot-recovery.test.ts`) copies the ciphertext and key into a fresh private directory, verifies the bound session reads back, and rejects a wrong key, a wrong account binding, corrupted ciphertext and a truncated envelope. The hosted PostgreSQL drill seeds an interrupted `processing` outbox/message/part fixture, asserts it before backup and verifies restore quarantines all three to `unknown`, while never-attempted `pending` work is preserved. Restored ownership and grants remain quarantined: an expired grant is refused before any vault or pool work, and an uncertain old owner requires external fence attestation before replacement. Ciphertext deletion on a healthy host does not erase offline or retained backups; retention policy remains an Owner decision.

## Owner activation gate

Pre-G5 offline baseline (historical; not the G5-A activation artifact): hosted CI 41386800622 on `a810087` (PR merge `2bd5e7f`) passed 273/273 units, 2/2 guarded SDK checks, 9 browser cases + 1 skip, four-staff browser and 4/10/25/50 load, the encrypted restore drill (including a seeded interrupted-processing fixture quarantined to `unknown`), and the pilot dry-run/scan with the PR merge identity, UID 65532, no ports/private files and 0 HIGH/CRITICAL. Load p95 was 62.9/82.9/222.5/435.6 ms at 4/10/25/50 clients, 119.7 ms at 50×50 and 928.7/1661.8 ms at 100/200; **500 clients FAIL** at 3135.5 ms. The prior run 41385140560 on `e0e635d` reported 65.0/79.6/212.3/441.8 ms and 701.5/1525.0 ms. These are short synthetic API workloads; the 200-client result varies across runs. This establishes enforceable local boundaries only; no real login, phone interaction or provider delivery has occurred.

The current G5-A artifact and its offline evidence are recorded in [G5A-ACTIVATION-READINESS.md](../evidence/G5A-ACTIVATION-READINESS.md); the baseline above is retained only as history.

No live item is activated. The Owner approved D1–D7 in scope on 2026-11-02 ([G5-SCOPE-APPROVAL.md](../evidence/G5-SCOPE-APPROVAL.md)), fixing one dedicated account, exactly one consenting direct peer, a private host with local-only QR, the staged order, 10 parts/day, ≥2 s, 2 hours, text-only and the risk acceptance. The network boundary is now verified (`G5A_NETWORK_BOUNDARY_VERIFIED`; see [PILOT-GATE-STATUS.md](../../PILOT-GATE-STATUS.md)), but live entry still requires a separate explicit authorization for each stage ([procedure](G5-LIVE-PILOT-PROCEDURE.md)).

The scope record does not authorize production, HANU/customer accounts, more recipients, higher limits, media, public exposure, PR #3 merge, G6 soak or an automatic production transition. Any change to account, peer, purposes, budget, interval, media, risk or window requires a new Owner decision. Never request cookies, passwords or QR images through chat.

## Stop conditions

Stop immediately on account warnings, credential leakage, repeated listener eviction, unexplained missing/duplicate sends, uncertain exclusive ownership or provider-policy changes. Disable dispatch, preserve only sanitized evidence and have the Owner revoke the test session. Never evade account/device limits or automate replacement accounts. When the pilot ends, follow [PILOT-TEARDOWN.md](PILOT-TEARDOWN.md) for the D7 deletion and inventory.
