# Private pilot connector operations

Prepared 2026-11-02. **Offline operations only.** This document authorizes no real login, QR scan, account activation, deployment or production use. The live pilot requires an explicit Owner decision on the account, consenting peers, private host and platform-risk acceptance. See [READINESS.md](../READINESS.md) for PASS/FAIL/UNPROVEN evidence.

## Boundary

The pilot connector is a **separate, intentionally SDK-bearing image**. The application image (`ops/Dockerfile`) stays SDK-free and must keep passing the existing `zca-js`-absent assertion. The connector:

- publishes no ports and exposes no HTTP health, QR or session endpoint;
- defaults to `dry-run`, which validates a private manifest and touches no vault, SDK, database or network;
- runs as UID 65532 with a read-only root filesystem, no capabilities and `no-new-privileges`;
- never starts from ordinary application startup, CI test jobs or the default Compose stack.

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

The container runs as UID 65532, so bind-mounted files must be owned by that UID (or a host user with the same numeric UID). The connector rejects symlinks, non-regular files, wrong owners/modes and escaping directories on POSIX.

The session key and any media locator encryption key are separate capabilities with separate files. Select the envelope key identifier explicitly with `PILOT_KEY_ID` (default `v1`); it is bound into both the ciphertext envelope and the AES-GCM associated data, so a record written under one id cannot be read under another. Rotate by installing a new key file, selecting a new id, verifying decryption of a new session write, and only then retiring the old file after the agreed transition. There is no silent migration and no automatic key deletion. The pilot session path uses this private file store; the application's general credential vault is unchanged and is not used by the pilot connector.

## Binding the grant

A manifest contains exactly `version`, `build`, `consent` and `grant`. The grant is valid only when:

- `sourceCommit`, `lockSha256` and `sdkIntegrity` match the reviewed artifact recorded in `build`;
- `issuedAt <= now + 30s` and `expiresAt > now`; enrollment grants last at most 1 hour, observe/send-test at most 8 hours;
- `ownerConsentRef` matches the separate consent scope, and the purpose is allowed by that scope;
- observe/send-test carry a non-null exact `expectedAccountId` and 1–4 unique exact direct-peer IDs;
- an enrollment manifest may carry a null `expectedAccountId`, but its consent scope must then allow only `enroll-session` and may contain 0–4 peers; the enrollment manifest is never reused for observe or send;
- `maxPartsPerDay` is 1–30 and `minIntervalMs` is 2000–60000, within the consent limits;
- expiration never exceeds `consent.notAfter`, and all timestamps use millisecond precision (`YYYY-MM-DDTHH:MM:SS.sssZ`).

A routine reviewed rebuild may receive a refreshed technical grant under the same consent reference. Broadened account, peers, purposes, budget, interval or risk requires a new Owner decision.

## Commands

The repository ships only [`ops/pilot-compose.example.yml`](../../ops/pilot-compose.example.yml). Copy it to a private path outside the repository (mode 0600) and render it with a private interpolation env file that sets `PILOT_CONNECTOR_IMAGE`, `PILOT_ENV_FILE`, `PILOT_MANIFEST_FILE`, `PILOT_KEY_FILE`, `PILOT_STATE_DIR` and `PILOT_DB_NETWORK`. The connector joins the application's internal database network plus a non-internal egress network; it publishes no ports and PostgreSQL stays unpublished.

```bash
# Default: offline gate only.
docker compose --env-file /private/pilot-interpolation.env -f /private/pilot-compose.yml run --rm pilot-connector

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

Bootstrap writes the QR PNG only to the private view directory for the Owner to view on the local host; it never prints QR/token material, fetches avatars, starts a viewer or retries after expiry/decline. Enrollment requires a private local UID confirmation after final SDK resolution. Ordinary startup can never use the enrollment exception.

## Dispatch and inbound rules

- A successful start publishes `provider_state.status='connected'` only after ownership, the UID-bound facade, transport start and `markActive`, inside a transaction holding the active owner row. Publication is refused while `reconciliation_required` is set. Normal shutdown invalidates ownership and returns the row to `disconnected` with reconciliation required, exactly like the generic connector.
- Send-test reserves a durable per-account/day budget row before every external part. Accepted, failed and unknown attempts consume the reservation; refunds never occur. A repeat reservation for the same part is refused before egress; the worker marks that row terminally `failed` with a `reservation-already-consumed` audit and does not halt the pilot. It is never resent.
- Only exact allowlisted direct peers (`threadType 0`) are dispatchable; groups and unlisted peers are refused before reservation. The worker claim itself is scoped to the grant peers, so mail for any other conversation is never claimed or marked failed.
- The bound account's own UID can never appear in the peer allowlist; it is rejected by the grant parser, provider, connector and CLI.
- Inbound persistence is limited to the bound account and the same allowlist. Unexpected direct peers, group events, a non-self sender that is not the peer, and a self sender that is not the bound account are dropped before persistence, without storing body, locator, identity or raw SDK error; the runtime reports only a count.
- The 1–4 peer allowlist is a pilot safety scope, not a product seat limit. The application itself has no seat cap.
- An expired grant, quota stop, lost ownership or uncertain result stops the loop. Local ownership gap state stays closed; do not add a permissive resume shortcut. Ownership recovery requires the reviewed admin reconciliation and externally verified old-owner termination.

## Media scope

The pilot runs with media scheduling disabled (`media:false`). Inbound media events are journaled only as unsupported metadata: no locator is captured, no CDN download is attempted and no bytes are stored. The locator key described above is provisioned separately and is not passed to the pilot connector in this mode.

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

Offline gate evidence: hosted CI 41386800622 on `a810087` (PR merge `2bd5e7f`) passed 273/273 units, 2/2 guarded SDK checks, 9 browser cases + 1 skip, four-staff browser and 4/10/25/50 load, the encrypted restore drill (including a seeded interrupted-processing fixture quarantined to `unknown`), and the pilot dry-run/scan with the PR merge identity, UID 65532, no ports/private files and 0 HIGH/CRITICAL. Load p95 was 62.9/82.9/222.5/435.6 ms at 4/10/25/50 clients, 119.7 ms at 50×50 and 928.7/1661.8 ms at 100/200; **500 clients FAIL** at 3135.5 ms. The prior run 41385140560 on `e0e635d` reported 65.0/79.6/212.3/441.8 ms and 701.5/1525.0 ms. These are short synthetic API workloads; the 200-client result varies across runs. This establishes enforceable local boundaries only; no real login, phone interaction or provider delivery has occurred.

No item here is accepted or authorized yet. Before any live login, the Owner must explicitly approve:

1. one dedicated legitimate test account and its official phone, with the account not used for production or customers;
2. 1–4 consenting direct-message test peer IDs and the exact test window;
3. a private pilot host that can show the QR locally to the Owner, with controlled egress and no public ports;
4. the staged command order — `bootstrap` once, then `run-observe`, then `run-send-test` only if the same approved scope includes sending — and the 1–30 part/day, ≥2 s interval limits;
5. acceptance of the unofficial-client, platform-terms, account-restriction and ban risks, recorded by consent reference rather than secret material;
6. the pilot media scope — text-only first with inbound media scheduling disabled (the current code path), or a separately reviewed private media host policy before any media test;
7. post-pilot retention/deletion of test messages, media and private session material; the proposed engineering default is to delete them after the window and retain only sanitized evidence.

Proposed engineering defaults, not adopted until the Owner records them: observe-only first with one consenting peer; up to four peers for the four-staff acceptance; a 2-hour observe/send-test session followed by a 7-day low-volume soak; an initial cap of 10 parts/day (below the 30 hard maximum) and a ≥2 s interval; text-only. These are conservative engineering proposals, not Zalo-approved limits or ban-safety claims.

After approval, the Engineering Lead records the approved scope, provisions the private files outside the repository, verifies build/lock/integrity identity, and starts observe-only under direct Owner participation. Any change to account, peers, purposes, budget, interval, risk or window requires a new Owner decision. Never request cookies, passwords or QR images through chat.

## Stop conditions

Stop immediately on account warnings, credential leakage, repeated listener eviction, unexplained missing/duplicate sends, uncertain exclusive ownership or provider-policy changes. Disable dispatch, preserve only sanitized evidence and have the Owner revoke the test session. Never evade account/device limits or automate replacement accounts.
