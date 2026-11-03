# G5-A R4 — private enrollment manifest and offline preflight

**Date:** 2026-11-03
**Gate:** `R4_MANIFEST_PREFLIGHT_PASS`
**Live Zalo action:** none
**Live grant created:** none

## 1. Artifact identity

| Item | Value |
| --- | --- |
| Connector source commit | `6d199162e8b00d7b4968b6b1fd82450b4387f4df` |
| Image | `zalo-shared-connector:g5-6d199162` |
| Local image digest | `sha256:6b1f0100017d067f24d18eee53ffbfcffe7562ac3f79fd98283097ef1938d781` |
| Embedded `sourceCommit` | `6d199162e8b00d7b4968b6b1fd82450b4387f4df` |
| Embedded `lockSha256` | `17dcd25426639f7112b80764bc8aa27f9be2af3acf0aaf0f2cd490c434030c9b` |
| Embedded `sdkIntegrity` | `sha512-pBU0T0/uadH3Neq7yMssUmE769VVuqKhL8YD1HqQQG8e6lkwueAopNu0vhJdqiJRHZdPIEomT2FxRzauOx4pgA==` |
| `zca-js` / `crypto-js` | `2.2.0` / `4.2.0` |
| Runtime UID | `65532` |

The image's `/app/build-identity.json` matches the manifest build block, the
connector lock hash and the locked SDK integrity. The image was read with
`--network none`; this was not a live command.

## 2. Private enrollment configuration

The private directory `/home/zen/pilot-private/zalo-shared/g5-enroll` is `0700`
and owned by UID 65532. It contains:

- `manifest.enroll.private.json` — `0600`, UID 65532, SHA-256
  `e31ddfb1f2c2f368dd27e85204e68884a00891a2e3e08639d78ce693707abf7b`.
  It is a **template with placeholders**, not a valid grant.
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
| Expired enrollment | prior synthetic bootstrap manifest | **denied** (exit 1) |
| Out-of-scope | `maxPartsPerDay: 11`, two peers | **denied** |
| Extra field | valid manifest plus an unexpected key | **denied** |
| Placeholder template | `g5-enroll/manifest.enroll.private.json` | **denied** |
| Stage mismatch | observe manifest requested as bootstrap stage | **rejected by host wrapper** |
| Wrong build identity | manifest bound to another source commit | **denied by hardened preflight** (unit test); the old image admitted it, closing a preflight gap |

The fresh synthetic rehearsal manifest (SHA-256
`a6bb9edc6fae4232ab8aa7e9325a7c215a3dcf4c0a02c5fca0b4787ccfc2d227`) was
deleted immediately after the test. It was synthetic, expired within 30
minutes, and contained no real account or peer. No live grant remains.

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
- Full local suite: **300/300 PASS**; `npm run typecheck` and
  `npm run build:connector` PASS.

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
