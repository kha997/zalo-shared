# G5-A R4 — private enrollment manifest and offline preflight

**Date:** 2026-11-03
**Gate:** `R4_MANIFEST_PREFLIGHT_PASS`
**Live Zalo action:** none
**Live grant created:** none

## 1. Artifact identity

The final remediation commit is `8d40c0f934aef10f8470cf7cc5bcd7402710f6bd`. It
supersedes the pre-remediation artifact `6d199162`, which lacks the egress
guard and the preflight identity check and must not be used. It also supersedes
the earlier remediation artifacts `2963e1a`, `244ef7f`, `6f28836` and
`fdb0704`, which predate the whole-surface raw-binding denial or the removal of
the exported native handle factories.

| Item | Value |
| --- | --- |
| Connector source commit | `8d40c0f934aef10f8470cf7cc5bcd7402710f6bd` |
| Image | `zalo-shared-connector:g5-8d40c0f9` |
| Local image digest | `sha256:2dec14e3d732b6f4a2686bb3220fe9f3e39678997d054a9cf51a5e5758ffd2a1` |
| Embedded `sourceCommit` | `8d40c0f934aef10f8470cf7cc5bcd7402710f6bd` |
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
  `68dfa80f1e311e91559e5e67dcdcfc0eb7c94142d06e54ab8a66380ee09dfc63`.
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
manifests were synthetic fixtures generated from the final commit. They were
deleted immediately after the matrix. Their SHA-256 values before deletion were:
bootstrap `ce0e9ca7a57235a4b5f2e078334054442dd605f5c2c3750dd6df3bf255fe1f36`,
observe `485ab571b9275e14a3f8c99a6c029b32b7081f05c6888df1c74ba46ab50a9b53`,
send-test `c0a343a9b7d9bff2934a82dcd6f1c2e39d862937d60198841aed6c77c710981b`,
invalid `cbaeb46aeecef5870611512b7eded2b29bf5011335dc13fc984367e929128ffd`,
expired `a2e9f8ccaf6bcf093d95c272a0f8f0eaf1c583c9004afd23369e418618fd3b51`,
wrong-commit `3b994a7735443d82c3933ed43de2b097a9adabe424fbbc911f362aa73d123735`,
extra-field `d1160457d1fe4c49fd3f5a49da2976f5ce224bb6823ab7ba3ac96f05c780724b`,
missing-build `cdff6af6502b4e7a53f46aaa335bd7d96e7435414df06f300daaa4ed5e30606d`,
malformed `92072df399cb74703f8e86f450d552bc0bb01eeeb98a90985a1b7772c8fd0016`.
No synthetic or live grant remains in the private directory; only the
placeholder template remains.

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
- `pilot-egress-guard.test.ts` — 16/16 egress boundary tests.
- `private-pilot-flow.test.ts` — 29/29 PASS with the live disposable test
  database; covers private file modes, QR view, runtime identity and scope.
- Full local suite: **304/304 PASS** on Node `v24.19.0`; `npm run typecheck`
  and `npm run build:connector` PASS.

The only observed `private-pilot-flow` failure is reproducible when a second
process holds advisory lock `73001` on the same test database: the worker
correctly declines ownership and returns `processed:false` before quarantine.
`npm test` runs one process with `--test-concurrency=1`, and concurrent suite
runs against the same database are unsupported. This is a harness constraint,
not a product defect; it is recorded in the R5 review evidence.

In-image guard checks on the reviewed artifact, all with `--network none` and
UID 65532: direct-IP TCP, UDP, `dns.resolve4`, module-level and prototype
`child_process` spawn, `tcp_wrap`/`udp_wrap`/`pipe_wrap` bindings, bare Unix
socket paths and `fd`/`Resolver` paths were denied even with `NODE_OPTIONS`
cleared, because the entrypoint carries the preload; proxy environment
variables failed closed at startup; `::7f00:1` was classified as non-public; a
loopback listener on the exact `DATABASE_URL` host/port was reachable while the
same host on another port was denied; and an entrypoint override that removed
the guard made `preflight` return `{"ok":false,"gate":"denied"}` because the
guard marker was absent.

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
