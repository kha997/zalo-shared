# G5-A R4 — private enrollment manifest and offline preflight

**Date:** 2026-11-03
**Gate:** `R4_MANIFEST_PREFLIGHT_PASS`
**Live Zalo action:** none
**Live grant created:** none

## 1. Artifact identity

The remediation commit is `2963e1ad73151059b0c92af9a9a5ddb2e582c799`. It
supersedes the pre-remediation artifact `6d199162`, which lacks the egress
guard and the preflight identity check and must not be used.

| Item | Value |
| --- | --- |
| Connector source commit | `2963e1ad73151059b0c92af9a9a5ddb2e582c799` |
| Image | `zalo-shared-connector:g5-2963e1ad` |
| Local image digest | `sha256:a1d6f79a26309494878958d6e9272cc1de1b7f67af4804afb2efffcd29707197` |
| Embedded `sourceCommit` | `2963e1ad73151059b0c92af9a9a5ddb2e582c799` |
| Embedded `lockSha256` | `17dcd25426639f7112b80764bc8aa27f9be2af3acf0aaf0f2cd490c434030c9b` |
| Embedded `sdkIntegrity` | `sha512-pBU0T0/uadH3Neq7yMssUmE769VVuqKhL8YD1HqQQG8e6lkwueAopNu0vhJdqiJRHZdPIEomT2FxRzauOx4pgA==` |
| `zca-js` / `crypto-js` | `2.2.0` / `4.2.0` |
| Runtime UID / Node | `65532` / `v24.22.1` |
| Exposed ports | none |
| Preloaded guard | entrypoint `--require=/app/egress-guard.cjs` and `NODE_OPTIONS` |

The image's `/app/build-identity.json` matches the manifest build block, the
connector lock hash and the locked SDK integrity. The image was read with
`--network none`; this was not a live command.

## 2. Private enrollment configuration

The private directory `/home/zen/pilot-private/zalo-shared/g5-enroll` is `0700`
and owned by UID 65532. It contains:

- `manifest.enroll.private.json` — `0600`, UID 65532, SHA-256
  `5b77d4f9fffd42f8dc91fe017a24690425e2495e4d54c8bcafb62bb4601c8fb0`.
  It is a **template with placeholders**, not a valid grant, rebound to the
  reviewed commit above.
- `README.private.txt` — `0600`, UID 65532, fill-in instructions.

The template fixes the reviewed build identity, purpose `enroll-session`,
text-only scope bounds, `maxPartsPerDay: 10` and `minIntervalMs: 2000`. It
leaves the consent reference, grant ID and timestamps as placeholders until the
Owner issues a new UTC window. No session key, session record, QR image, real
account identifier or real peer identifier is present.

Bootstrap is intentionally account- and peer-unbound: `assertG5Scope` requires
`expectedAccountId === null` and zero peers for `enroll-session`, and the QR
bootstrap confirms the human-visible account identity before writing the
session. Zalo A and Zalo B are bound in the later `observe` / `send-test`
grants, which require a non-null account and exactly one peer.

## 3. Offline preflight matrix

All runs used `ops/local/preflight-connector.sh`, `--network none`, read-only
container, all capabilities dropped, `no-new-privileges`, UID 65532.

| Case | Manifest | Result |
| --- | --- | --- |
| Valid synthetic enrollment | fresh synthetic grant, null account, zero peers | **admitted** |
| Valid synthetic observe | fresh synthetic grant, one peer | **admitted** |
| Valid synthetic send-test | fresh synthetic grant, one peer | **admitted** |
| Expired enrollment | bootstrap manifest with past `expiresAt`/`notAfter` | **denied** |
| Out-of-scope | `maxPartsPerDay: 11`, two peers | **denied** |
| Extra field | valid manifest plus an unexpected key | **denied** |
| Missing build block | valid manifest without `build` | **denied** |
| Placeholder template | `g5-enroll/manifest.enroll.private.json` | **denied** |
| Stage mismatch | observe manifest requested as bootstrap stage | **rejected by host wrapper** |
| Wrong build identity | manifest bound to another source commit | **denied in-image by hardened preflight** |

The valid, invalid, expired, extra-field, missing-build and wrong-identity
manifests were synthetic fixtures generated from the reviewed commit. They were
deleted immediately after the matrix. Their SHA-256 values before deletion were:
bootstrap `2d6fcd88b3e6a25d4c1fd861f42e2e644f87a95116c40ebc9edcaa2858b321df`,
observe `f3601dcf866a8896131f89a3838d1cf2b77eac359c8111dc7d6518ab40d9bbc6`,
send-test `9c196c7bd85266704c66ad4eac9f5f1c83db3c7034ee3c5728a775fc5526e6a3`,
invalid `ae1d06a400840bbf295e4ba08eebeb805cd4498845ae21a4777383631b6a0df0`.
No synthetic or live grant remains in the private directory.

## 4. Preflight hardening

Previously, `preflight` validated only grant shape and scope; only the live
command checked `/app/build-identity.json`. A manifest bound to a different
commit could therefore pass preflight. The preflight path now calls
`assertBuildIdentity` before scope validation, and a new unit test asserts that a
manifest bound to another image identity is denied. The live command still
repeats the identity check before any key, session, database or SDK action.

## 5. Consent and stage binding

Focused offline suites passed:

- `pilot-policy.test.ts` — consent scope, purpose, account and peer binding,
  budget and interval bounds.
- `pilot-cli.test.ts` — preflight admission/denial, including wrong image
  identity; live commands still require the operator flag and matching purpose.
- `private-env-keys.test.ts` — redaction helper never prints values.
- `pilot-egress-guard.test.ts` — 14/14 egress boundary tests.
- `private-pilot-flow.test.ts` — 29/29 PASS with the live disposable test
  database; covers private file modes, QR view, runtime identity and scope.
- Full local suite: **302/302 PASS**; `npm run typecheck` and
  `npm run build:connector` PASS.

In-image guard checks on the reviewed artifact, all with `--network none` and
UID 65532: direct-IP TCP, UDP, `dns.resolve4`, child process, `fd`-based socket
and `dns.Resolver` were denied even with `NODE_OPTIONS` cleared, because the
entrypoint carries the preload; proxy environment variables failed closed at
startup; a loopback listener on the exact `DATABASE_URL` host/port was
reachable while the same host on another port was denied.

## 6. Limitations

- The real Zalo A and Zalo B UIDs were not supplied to this remediation. The
  enrollment manifest must not contain them; they belong to the later-stage
  grants and are bound after the Owner confirms the enrolled account.
- The template is not a usable live grant. The Owner must issue a new window and
  consent reference, then re-run preflight.
- The local image digest is not a registry digest or a signed attestation; CI
  does not push the image.
- No live login, QR, SDK authentication or provider traffic was performed.

## 7. Evidence boundary

This record contains no credential, cookie, key, session, QR, real account
identifier or raw connection string. It is synthetic/offline evidence, not live
provider evidence.
