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

The container runs as UID 65532, so bind-mounted files must be owned by that UID (or a host user with the same numeric UID). The connector rejects symlinks, non-regular files, wrong owners/modes and escaping directories on POSIX.

The session key and any media locator encryption key are separate capabilities with separate files. Select the envelope key identifier explicitly with `PILOT_KEY_ID` (default `v1`); it is bound into both the ciphertext envelope and the AES-GCM associated data, so a record written under one id cannot be read under another. Rotate by installing a new key file, selecting a new id, verifying decryption of a new session write, and only then retiring the old file after the agreed transition. There is no silent migration and no automatic key deletion.

## Binding the grant

A manifest contains exactly `version`, `build`, `consent` and `grant`. The grant is valid only when:

- `sourceCommit`, `lockSha256` and `sdkIntegrity` match the reviewed artifact recorded in `build`;
- `issuedAt <= now + 30s` and `expiresAt > now`; enrollment grants last at most 1 hour, observe/send-test at most 8 hours;
- `ownerConsentRef` matches the separate consent scope, and the purpose is allowed by that scope;
- observe/send-test carry a non-null exact `expectedAccountId` and 1–4 unique exact direct-peer IDs;
- `maxPartsPerDay` is 1–30 and `minIntervalMs` is 2000–60000, within the consent limits;
- expiration never exceeds `consent.notAfter`.

A routine reviewed rebuild may receive a refreshed technical grant under the same consent reference. Broadened account, peers, purposes, budget, interval or risk requires a new Owner decision.

## Commands

Run inside the connector image (the Compose example mounts the private material):

```bash
# Default: offline gate only.
docker compose -f pilot-compose.yml run --rm pilot-connector

# Explicit one-time enrollment under an Owner-controlled phone interaction.
docker compose -f pilot-compose.yml run --rm pilot-connector \
  dist/connector/tools/pilot-connector.js bootstrap --acknowledge-pilot-risk

# Observe only: no dispatcher is constructed.
docker compose -f pilot-compose.yml run --rm pilot-connector \
  dist/connector/tools/pilot-connector.js run-observe --acknowledge-pilot-risk

# Send-test: allowlisted direct peers only, reserved budget per part.
docker compose -f pilot-compose.yml run --rm pilot-connector \
  dist/connector/tools/pilot-connector.js run-send-test --acknowledge-pilot-risk
```

`--manifest` (or `PILOT_MANIFEST`) must be an absolute path. Credentials, tokens, cookies, keys and URLs are never accepted as arguments. CLI output contains only the command, safe gate outcome, purpose and expiry.

Bootstrap writes the QR PNG only to the private view directory for the Owner to view on the local host; it never prints QR/token material, fetches avatars, starts a viewer or retries after expiry/decline. Enrollment requires a private local UID confirmation after final SDK resolution. Ordinary startup can never use the enrollment exception.

## Dispatch and inbound rules

- Send-test reserves a durable per-account/day budget row before every external part. Accepted, failed and unknown attempts consume the reservation; refunds never occur. An `already-reserved` outcome is reported as a halt and is never resent.
- Only exact allowlisted direct peers (`threadType 0`) are dispatchable; groups and unlisted peers are refused before reservation.
- Inbound persistence is limited to the bound account and the same allowlist. Unexpected direct peers, group events, a non-self sender that is not the peer, and a self sender that is not the bound account are dropped before persistence, without storing body, locator, identity or raw SDK error; the runtime reports only a count.
- The 1–4 peer allowlist is a pilot safety scope, not a product seat limit. The application itself has no seat cap.
- An expired grant, quota stop, lost ownership or uncertain result stops the loop. Local ownership gap state stays closed; do not add a permissive resume shortcut. Ownership recovery requires the reviewed admin reconciliation and externally verified old-owner termination.

## Scanning and CI

```bash
docker build -f ops/Dockerfile.connector -t zalo-shared-connector:pilot .
bash ops/pilot-scan.sh zalo-shared-connector:pilot
```

The scanner records vulnerabilities, licenses, the resolved `zca-js` version and runtime UID. It fails on fixable high/critical findings, any exposed port, non-root execution or an unexpected SDK version. Hosted CI runs the image default `dry-run` with a synthetic manifest and fake-only evidence; it never imports the real SDK for a login.

## Backup and restore

Back up the encrypted session file, the separate key, the binding/budget database state and the current manifest/grant. A database backup without the key is not a session recovery proof. Restored ownership and grants remain quarantined: an expired grant cannot start work, and an uncertain old owner requires external fence attestation before replacement. Ciphertext deletion on a healthy host does not erase offline or retained backups; retention policy remains an Owner decision.

## Stop conditions

Stop immediately on account warnings, credential leakage, repeated listener eviction, unexplained missing/duplicate sends, uncertain exclusive ownership or provider-policy changes. Disable dispatch, preserve only sanitized evidence and have the Owner revoke the test session. Never evade account/device limits or automate replacement accounts.
