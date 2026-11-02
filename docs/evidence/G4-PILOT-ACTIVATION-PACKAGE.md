# G4 — Live pilot activation package

> **SUPERSEDED IN SCOPE (2026-11-02):** the Owner approved D1–D7 in scope under [G5-SCOPE-APPROVAL.md](G5-SCOPE-APPROVAL.md). Live activation is still withheld; current status is `G5A_AWAITING_OWNER_START` ([readiness](G5A-ACTIVATION-READINESS.md)). This G4 package remains as historical evidence.

**Status:** OFFLINE READY — **NO LIVE ACTION PERFORMED**.
**Baseline:** connector artifact source `ea66d8b94dde26e67bcb438e114fdd2454401a2d`; G3 functional evidence was collected at `adf8ceca9bd615004486b14ebc07da8475b71a3a`. Later commits are docs/ops-only and do not change the artifact.
**Gate:** `G4_AWAITING_OWNER_LIVE_APPROVAL`. G5 is not authorized. PR #3 remains Draft.
**Companion:** [PRIVATE-PILOT.md](../operations/PRIVATE-PILOT.md), [RUNBOOK.md](../operations/RUNBOOK.md), [OWNER-CONSENT-TEMPLATE.md](../operations/OWNER-CONSENT-TEMPLATE.md), [pilot-manifest.template.json](../operations/pilot-manifest.template.json), [pilot-manifest.enroll.template.json](../operations/pilot-manifest.enroll.template.json), [G3 acceptance](G3-OFFLINE-ACCEPTANCE.md).

No Zalo login, QR enrollment, account identifier, session, cookie, real peer or external send was used to produce this package. All checks are synthetic and network-disabled.

## 1. Exact validated environment and source identity

| Item | Verified value |
| --- | --- |
| Source | Connector artifact source `ea66d8b94dde26e67bcb438e114fdd2454401a2d`; G3 functional baseline `adf8ceca9bd615004486b14ebc07da8475b71a3a`; later commits are docs/ops-only |
| Host | Windows 11 10.0.26100 + WSL2 Ubuntu-24.04; Node 24.19.0 / npm 11.17.0 for tooling |
| Connector image | `zalo-shared-connector:g4-ea66d8b`, image ID `sha256:e8a002abbd5ac4e39b8cf6c24fa2ab07eee18fe28c746bc16f4e11a7d867b72c` |
| Connector runtime | UID 65532, Node v24.22.1 inside the image, read-only root, cap-drop ALL, no ports |
| SDK | `zca-js@2.2.0`; transitive `crypto-js@4.2.0` |
| Build identity | `sourceCommit` = `ea66d8b94dde26e67bcb438e114fdd2454401a2d` (matches HEAD); `lockSha256` = `17dcd25426639f7112b80764bc8aa27f9be2af3acf0aaf0f2cd490c434030c9b`; `sdkIntegrity` = `sha512-pBU0T0/uadH3Neq7yMssUmE769VVuqKhL8YD1HqQQG8e6lkwueAopNu0vhJdqiJRHZdPIEomT2FxRzauOx4pgA==` |
| Application image | `zalo-shared:g2-adf8ceca9bd6`, ID `sha256:9d3454015db1d8c6558c2d461fde86a2f71de0a26193d997432352115a890d65`, SDK-free; byte-identical because app sources did not change after `adf8cec` |
| Database | PostgreSQL 17 `postgres:17-bookworm@sha256:858bb5e98eed02eb8cafbcdc007f9a65d1b613972028944a8ec2133ccaf80d27`, internal network only |
| App exposure | `127.0.0.1:3100` only (G2 compose); G3 mock stack additionally on loopback `3101` for tests |
| Private state | `pilot/` 0700 UID 65532; `manifest.synthetic.json` 0600 1357 bytes; `session.key` 0600 32 bytes; `state/view/` 0700 UID 65532 |
| Pilot deploy config | [ops/pilot-compose.example.yml](../../ops/pilot-compose.example.yml) — copy outside the repository; no published ports, UID 65532, read-only root, default `dry-run` |

Evidence: [connector identity and offline checks](g4-offline-checks.txt), [connector scan](connector-image-scan-summary.json), [app scan](container-scan-summary.json), [pilot compose](g4-pilot-compose-check.txt), [G3 app topology](g3-topology-check.txt).

**Provenance.** The published commits after `adf8cec` touch only docs and ops; application and connector TypeScript sources are unchanged. The connector was rebuilt at `ea66d8b` with the same lock and SDK integrity, and the app image ID is unchanged. G3 runtime results therefore still describe the same application code, while the G4 identity below is the artifact to deploy.

**Artifact-digest caveat.** The image ID above is a local build identity, not a registry digest and not a signed attestation. A live pilot must deploy the immutable digest recorded by the CI pipeline for the reviewed commit; the runtime cannot verify its own provenance. `dry-run` validates manifest shape only; it does not read `/app/build-identity.json`.

## 2. Network and security assessment

- The connector publishes no ports, exposes no HTTP health/QR/session endpoint and does not appear in the default application stack. [Pilot compose check](g4-pilot-compose-check.txt) renders [ops/pilot-compose.example.yml](../../ops/pilot-compose.example.yml) and confirms UID 65532, read-only root, `cap_drop: ALL`, `no-new-privileges`, read-only manifest/key mounts and default `dry-run`.
- The connector joins two networks: `pilot-db`, an external reference to the application's internal database network (for example `zalo-shared_private`), and `pilot-egress`, a non-internal network used only for provider TLS. PostgreSQL remains attached to the internal network alone and is never published. The connector therefore gets database reachability without exposing the database.
- Offline dry-run executes with `--network none`, no vault/SDK/DB read and a read-only filesystem; command gating denies before any live runner is constructed.
- The application remains loopback-only; PostgreSQL stays on the `private` internal network with no host port. The app's `edge` network is required for Docker port publishing and grants outbound egress; host egress policy must restrict the pilot host, not the container alone.
- Live connector operation needs outbound TLS to the provider. There is no inbound path and no public ingress. A remote `DATABASE_URL` requires `sslmode=require`, `verify-ca` or `verify-full`.
- Local HTTP has no TLS and is a loopback-only exception. Docker socket/host access bypasses container boundaries: only the Owner-operated private host may run the connector.
- Session material, QR images, manifests and keys remain outside the repository. POSIX enforcement rejects symlinks, wrong owners/modes and escaping paths; the QR view is 0700/0600 and cleared after use.
- Single-owner fencing, durable ownership, unknown-send quarantine and never-auto-resend behaviour were exercised offline (real PostgreSQL and SIGKILL cases in [G3](G3-OFFLINE-ACCEPTANCE.md)). A live outage cannot be cancelled inside an already-entered provider call; takeover requires confirmed termination and egress revocation.
- Residual exposure: local host compromise, stolen session key, provider-side session revocation, unofficial-client detection and the Docker socket remain live risks.

## 3. Evidence of successful no-network dry-run

| Check | Result |
| --- | --- |
| Synthetic manifest, `--network none`, read-only, cap-drop | `{"ok":true,"gate":"admitted","purpose":"observe"}` (exit 0) |
| Parameterized dry-run helper | `ops/local/dry-run-connector.sh IMAGE [MANIFEST]` defaults to the synthetic manifest; an explicit private manifest path was also admitted |
| Enrollment manifest shape | synthetic null-account, `enroll-session`-only manifest admitted; the same null-bound consent listing `observe` denied |
| Malformed JSON / extra field / expired / wrong commit / wrong lock | all `gate":"denied"`, exit 1 |
| `run-observe` without `--acknowledge-pilot-risk` | denied, exit 1 |
| `bootstrap` and `run-send-test` with an observe-only grant | purpose denied, exit 1 |
| Unknown command | exit 2 with the bounded usage message |
| Connector identity | UID 65532, `zca-js` 2.2.0, commit/lock/SDK integrity all match |
| Private permissions | 0700 directories, 0600 manifest/key, UID/GID 65532 |
| Synthetic QR view | 1×1 PNG written 0600 UID 65532, non-PNG rejected, `qr.png` cleared |
| Host loopback | `{"ok":true}` on 3100 and 3101 |
| Pilot compose | no published ports, nonroot, read-only, dry-run default |

Full output: [g4-offline-checks.txt](g4-offline-checks.txt), [g4-pilot-compose-check.txt](g4-pilot-compose-check.txt).

**Not proven here:** SDK login, QR service behaviour, account eligibility, phone coexistence, provider acceptance, media download or any external send.

## 4. Owner-facing activation procedure

**Preconditions — all must be true before step 1**

- The Owner has recorded the consent fields and the seven decisions in section 8, including the exact UTC window.
- The CI-built connector digest for the reviewed commit is recorded; the local image ID above is not sufficient.
- The private host is Owner-controlled, has no public ports, can display the QR locally, and its Docker/egress access is restricted.
- Private manifest/key/session paths exist with 0700/0600 ownership; production database credentials use the restricted runtime role; a tested encrypted backup exists.
- Four staff application accounts exist; no provider credentials are shared with staff.
- The dedicated account A and consenting peer B are agreed; no real identifier is written into the repository, chat or evidence.
- Monitoring, incident owner and retention/deletion decision are recorded.

**Step 1 — stage the private deployment and re-verify (no login)**

The private interpolation env file (mode 0600) must provide:

| Variable | Value |
| --- | --- |
| `PILOT_CONNECTOR_IMAGE` | CI-built connector image reference or immutable digest |
| `PILOT_ENV_FILE` | Private connector env file (mode 0600) containing `DATABASE_URL` and any required runtime settings |
| `PILOT_MANIFEST_FILE` | Active stage manifest: `manifest.enroll.json`, then `manifest.observe.json`, then `manifest.send-test.json` |
| `PILOT_KEY_FILE` | Private session key (mode 0600) |
| `PILOT_STATE_DIR` | Private state directory for `session.enc` and the local QR view (0700) |
| `PILOT_DB_NETWORK` | The application's internal database network name (for example `zalo-shared_private`) |

1. Copy [ops/pilot-compose.example.yml](../../ops/pilot-compose.example.yml) outside the repository (for example `/home/zen/pilot-private/zalo-shared/pilot-compose.yml`), mode 0600. Never commit the copy, an env file or a filled manifest.
2. Create the private interpolation env file with the variables above; never write it into the repository.
3. Copy [pilot-manifest.enroll.template.json](../operations/pilot-manifest.enroll.template.json) outside the repository for the enrollment stage. Keep `consent.expectedAccountId` null, `consent.allowedPurposes` exactly `["enroll-session"]` and `consent.allowedPeerIds` empty; set the grant purpose to `enroll-session` and its expiry at most 1 hour after issue, never after `consent.notAfter`. Do not pre-bind the UID you expect to discover.
4. After bootstrap confirms the account, create separate observe and send-test manifests from [pilot-manifest.template.json](../operations/pilot-manifest.template.json), bound to that UID and peer B. The enrollment manifest must never be reused for observe or send.
5. Fill all timestamps with millisecond precision (`YYYY-MM-DDTHH:MM:SS.sssZ`); the validator rejects second-only timestamps. Set each file `chmod 600`, owner 65532; keep `consentRef` nonsecret.
6. Verify the image identity, lock and SDK integrity against the CI artifact.
7. Run the default `dry-run` with networking disabled using the active manifest, for example `bash ops/local/dry-run-connector.sh "$PILOT_CONNECTOR_IMAGE" /home/zen/pilot-private/zalo-shared/pilot/manifest.observe.json`. The helper defaults to the synthetic manifest when the second argument is omitted. Require `gate":"admitted"` and the expected purpose.
8. Run [check-connector-identity.sh](../../ops/local/check-connector-identity.sh) against the reviewed artifact commit, for example `bash ops/local/check-connector-identity.sh "$PILOT_CONNECTOR_IMAGE" ea66d8b94dde26e67bcb438e114fdd2454401a2d`, and confirm the embedded source commit, lock hash and SDK integrity. The helper defaults to HEAD; pass the artifact commit because later docs commits are not part of the image.
9. Confirm `session.enc` is absent or quarantined and that no previous unknown work exists.

**Step 2 — one-time bootstrap (Owner-controlled phone, separate ≤1 h enrollment grant)**

```bash
docker compose --env-file /home/zen/pilot-private/zalo-shared/pilot-interpolation.env \
  -f /home/zen/pilot-private/zalo-shared/pilot-compose.yml run --rm pilot-connector \
  dist/connector/tools/pilot-connector.js bootstrap --acknowledge-pilot-risk
```

- `PILOT_MANIFEST_FILE` must point to `manifest.enroll.json`: null expected account, `allowedPurposes: ["enroll-session"]`, no peers. A null-bound consent that also lists `observe` or `send-test` is denied by policy.
- The QR is shown only in the local private view. Never screenshot, paste, log or upload it.
- The Owner scans with the dedicated phone; confirm the discovered UID in the local TTY/identity prompt before the encrypted session is accepted.
- Mismatch, timeout, decline or an unexpected account stops the flow with no persistence and no send.
- After success: verify `session.enc` 0600, `qr.png` cleared, and stop the connector. Do not start a listener from a partial/unknown checkpoint.

**Step 3 — observe only (no dispatcher)**

```bash
docker compose --env-file /home/zen/pilot-private/zalo-shared/pilot-interpolation.env \
  -f /home/zen/pilot-private/zalo-shared/pilot-compose.yml run --rm pilot-connector \
  dist/connector/tools/pilot-connector.js run-observe --acknowledge-pilot-risk
```

- Point `PILOT_MANIFEST_FILE` at `manifest.observe.json` (account-bound, peer B, grant purpose `observe`, ≤8 h and inside the consent window).
- Have peer B send agreed text from B to A. Verify only B's direct messages enter the app; unexpected peers/groups are quarantined with a fixed reason.
- Four staff log in, claim the conversation and read it. No staff action may send.
- Check provider state/last-event freshness and queue counts. Stop at the agreed window or on any warning.
- Do not enable the application dispatch worker for this phase.

**Step 4 — controlled text send-test (separate send-test grant)**

```bash
docker compose --env-file /home/zen/pilot-private/zalo-shared/pilot-interpolation.env \
  -f /home/zen/pilot-private/zalo-shared/pilot-compose.yml run --rm pilot-connector \
  dist/connector/tools/pilot-connector.js run-send-test --acknowledge-pilot-risk
```

- Point `PILOT_MANIFEST_FILE` at `manifest.send-test.json` (account-bound, peer B, grant purpose `send-test`).
- One agreed plain-text message to B only, within 10 parts/day and ≥2 s between parts.
- Verify B receives it exactly once and that the provider acceptance ID/status is recorded.
- Never retry an unknown/timeout automatically; classify and reconcile with external evidence.
- Stop after the agreed message(s); do not expand volume or content.

**Step 5 — close the pilot**

Stop the connector and application worker, preserve DB/redacted logs, record UTC window and affected message IDs, reconcile pending/processing/unknown, then follow section 6. Re-enable nothing without the Owner's reconciliation decision.

## 5. Proposed test account roles and approved-scope fields

| Role | Proposed value |
| --- | --- |
| Connector account A | One dedicated, legitimate, blank test account `<ACCOUNT_A_ALIAS>`; official phone available; exact provider UID stored only in the private manifest |
| Consenting peer B | `<PEER_B_ALIAS>`, either the second dedicated test account or a consenting human; exact direct-message ID only in the private manifest |
| Staff seats | Four named application accounts (one admin, three agents proposed); staff never receive provider credentials |
| Owner | Records consent, window, risk acceptance, limits and the post-pilot decision |

| Approved-scope field | Proposed value | Validator constraint |
| --- | --- | --- |
| `consentRef` | `<CONSENT_REF>` (nonsecret) | must match the grant |
| `notAfter` | enrollment: ≤1 h; observe/send: start + 2 hours, UTC | grant expiry must not exceed it; timestamps require milliseconds |
| `expectedAccountId` (enrollment) | `null` | a null account permits only `enroll-session` |
| `expectedAccountId` (observe/send) | account A UID discovered at bootstrap | required non-null; exact ASCII `[A-Za-z0-9_-]{1,200}` |
| `allowedPurposes` (enrollment) | exactly `["enroll-session"]` | a null-bound consent may not list `observe` or `send-test` |
| `allowedPurposes` (observe/send) | `observe`, `send-test` | each grant must match its command |
| `allowedPeerIds` (enrollment) | `[]` (0–4 allowed) | a null-bound consent needs no peer; observe/send require 1–4 |
| `allowedPeerIds` (observe/send) | exactly peer B | 1–4 unique exact direct-message IDs |
| `maxPartsPerDay` | 10 | 1–30 |
| `minIntervalMs` | 2000 | 2000–60000 |
| Content | text only; no media, links or bulk | operating constraint, not schema-enforced |
| Media | excluded | separate Owner decision required |

Enrollment uses its own manifest scope: the account UID is not known before QR discovery, so a null-bound consent cannot also authorize observe or send. After the discovered UID is confirmed and written only to the private observe/send manifests, those manifests carry a separate account-bound consent scope. A single Owner consent record may cover all three purposes, but the machine scopes stay split and are never widened retroactively. Enrollment grants last at most 1 hour; observe/send-test grants at most 8 hours and never beyond the consent window. Unknown or accepted attempts consume the durable budget and are never auto-resent. Four staff seats do not raise the account send rate.

**Pilot evidence protocol**

1. **Phone coexistence.** During observe and send-test, operate A's official phone normally (send and receive with B). Record UTC times, whether the connector stayed connected, and whether the phone was logged out or restricted. Do not screenshot QR/session screens. Stop on forced logout or warning.
2. **Text delivery.** Use pre-agreed synthetic text. Record message ID locally, provider acceptance ID/status and B's receipt. Compare app state across staff; confirm exactly one send and the expected body. Evidence uses aliases and timestamps, not phone numbers or real message bodies.
3. **Idempotency and uncertainty.** Re-submit the same client action with the same idempotency key; require one provider send. Do not deliberately induce a provider timeout in the live pilot; offline crash/SIGKILL evidence covers unknown quarantine. If an unknown occurs, stop, preserve the row and follow section 6; never resend automatically.
4. **Four-staff acceptance.** Four independent browsers log in, claim/assign, read the same conversation and verify role restrictions and audit entries. Capture sanitized screenshots of the app only (never QR/session), plus audit IDs.
5. **Evidence handling.** Store raw evidence on the private host; commit only sanitized summaries with aliases, counts, timestamps and SHA-256 hashes. No credentials, cookies, QR images, phone numbers, provider UIDs or customer content in GitHub. Retention/deletion follows the Owner's decision.

## 6. Rollback, stop and revoke checklist

1. **Stop ingress/work first:** stop the connector and the application worker. Preserve the database and redacted logs; do not delete unknown rows.
2. **Record:** UTC stop time, affected message IDs, provider IDs/status, queue counts and the last successful boundary.
3. **Account/staff compromise:** admin disables the affected staff user and revokes sessions; verify the disabled session fails. Revoke external credentials/keys separately.
4. **Provider session:** log out the A device/session from the official phone if a live adapter exists. This build has no provider reconnect API; do not attempt automatic re-login or QR retry.
5. **Fencing:** a database lock cannot cancel an in-flight provider call. Confirm the old connector process is terminated and its egress revoked before any replacement. Treat unverified ownership as unknown.
6. **Unknown work:** classify pending/processing/unknown, compare authoritative provider evidence and require an explicit operator decision before any new send. Never resend unknown work.
7. **Secrets:** rotate the metrics token, database passwords and any exposed key material; restart only the API after privileges/CSRF/origin checks. Quarantine `session.enc`; keep the old session key until its envelopes are resolved, then retire it through a reviewed change.
8. **Restore:** only on an isolated database with no app/worker access, using the encrypted drill procedure. Restore quarantines sessions and pending media; verify hashes, roles and audit before any reconnect.
9. **Re-enable criteria:** cause repaired, evidence reconciled, Owner explicit approval, fresh grant/manifest, identity re-verified, and a single confirmed owner. Otherwise remain stopped.

## 7. Risks and unresolved limitations

| Risk / limitation | Status | Mitigation / gate |
| --- | --- | --- |
| Unofficial client, platform terms, account restriction or ban | UNPROVEN | Owner risk acceptance; low volume; stop on warning |
| Phone coexistence and session renewal | UNPROVEN | Observe phase; explicit evidence protocol |
| QR interception or session theft | UNPROVEN | Local-only QR, 0700/0600, no screenshots, no logs |
| Media / CDN / host allowlist behaviour | UNPROVEN, excluded | Separate Owner decision and reviewed policy |
| Provider acceptance crash window | Offline only | SIGKILL/quarantine tests; live unknown never auto-resent |
| Capacity | G3 local 4/10/25/50 clients passed (p95 68.75/95.24/238.96/394.96 ms); earlier hosted run: 100 clients 945.74 ms PASS; 200 clients 2102.12 ms FAIL; 500 clients 3371.99 ms FAIL | Do not claim capacity; the pilot itself stays at one account, one peer and 10 parts/day |
| Skipped browser case | `tests/e2e/security.spec.ts:186` (last-active-admin protection and mock-disabled behaviour) requires an isolated server configuration and was skipped | Run it against an isolated server before live, or record it as UNPROVEN and accept explicitly |
| Monitoring collector/alerts | Not deployed | Wire exported metrics before live; alert thresholds pending |
| Local host/Docker socket compromise | Accepted local risk | Owner-only host, no public ports, restricted egress |
| No TLS for local HTTP | Accepted loopback exception | Never expose publicly; future TLS gate |
| Image provenance | Local image ID only | Deploy CI-recorded immutable digest; no claims of signing |
| Deprecated `crypto-js` transitive dependency | Recorded residual | Pinned lock; review before live |
| Locator/session key escrow | Drill uses generated key | Independent key escrow test before live |
| Retention / secure erasure | Owner decision open | Private retention policy; backups may retain ciphertext |

## 8. Precise Owner decisions required

All seven are **OPEN**. This package records no acceptance.

| # | Decision | Options / proposed default |
| --- | --- | --- |
| D1 | Dedicated account and phone | Name `<ACCOUNT_A_ALIAS>`; confirm blank/legitimate test account and official phone available |
| D2 | Consenting peer(s) and exact window | Exactly `<PEER_B_ALIAS>`; UTC start/end (proposed 2 hours); no groups/contact discovery |
| D3 | Private host and QR display | Name the Owner-controlled host; confirm local QR view, no published PostgreSQL, restricted Docker/egress |
| D4 | Staged order and limits | Accept bootstrap → observe → send-test; enrollment manifest with null account and `enroll-session` only; 10 parts/day, ≥2 s, text-only, 2 hours |
| D5 | Platform and account risk | Explicitly accept unofficial-client/terms/ban risk by consent reference |
| D6 | Media scope | Exclude media from the initial pilot (recommended) or specify a separate approved scope |
| D7 | Retention and deletion | Days/location for raw evidence; deletion date after the pilot |

Additionally, the Owner must confirm the exact CI image digest and the private key/session paths before step 1. No decision above authorizes G5; G5 requires a separate explicit Owner approval after this gate.

**STOP.** `G4_AWAITING_OWNER_LIVE_APPROVAL`. No live login, QR scan, session or send may occur under this document.
