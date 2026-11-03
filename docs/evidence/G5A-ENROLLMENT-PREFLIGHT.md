# G5-A enrollment preflight

**Gate:** `D3_ENROLLMENT_PREFLIGHT_READY`
**Date:** 2026-11-03 (UTC)
**Scope:** enrollment-only grant readiness against the reviewed image; synthetic identities and timestamps throughout
**Branch:** `feat/shared-inbox`; reviewed source commit `2dff06e063b87d6abf5e25e4a1ca9c369ba7236e`; connector image `zalo-shared-connector:g5-local` (`sha256:9bced3eb…27998`)

## Artifact binding

[ops/local/make-enroll-fixtures.mjs](../../ops/local/make-enroll-fixtures.mjs) reads `/app/build-identity.json` from the image itself and refuses to write the template unless all three fields reconcile with the checked-out artifacts:

| Field | Value |
| --- | --- |
| `sourceCommit` | `2dff06e063b87d6abf5e25e4a1ca9c369ba7236e` |
| `lockSha256` | `17dcd254…43030c9b` (= SHA-256 of `connector/package-lock.json`) |
| `sdkIntegrity` | `sha512-pBU0T0/…Ox4pgA==` (= locked `zca-js` integrity) |

`git diff 2dff06e..HEAD -- connector` is empty, so the artifact under test is the reviewed source. The template's `build` block is copied from the image, not typed by hand.

## Template: inert, enrollment-only, no grant

`~/pilot-private/zalo-shared/g5-enroll/manifest.enroll.template.json` (mode `600`) has exactly `version`, `build`, `consent`, `grant`:

- `consent.allowedPurposes = ["enroll-session"]`; `expectedAccountId = null`; `allowedPeerIds = []`.
- `grant.purpose = "enroll-session"`; `expectedAccountId = null`; `allowedPeerIds = []`; budget 10 parts/day; 2000 ms interval.
- Consent reference, grant id, `issuedAt`, `expiresAt` and `consent.notAfter` remain `<PLACEHOLDER>` strings. The template therefore cannot be admitted as-is and carries no activation time or Owner consent reference.
- No account, peer, QR, session or provider material is present.

There is no persistent live grant. The live compose mount still points at the synthetic bootstrap fixture, not this template.

## Admission and denial matrix (reviewed image, offline)

[ops/local/verify-enrollment-readiness.sh](../../ops/local/verify-enrollment-readiness.sh) regenerates the synthetic fixtures immediately before each run (see the finding below) and ran **46 assertions PASS**:

| Check | Result |
| --- | --- |
| Template has exactly the four sections | PASS |
| Template build block equals the image's embedded identity | PASS |
| Source commit is a reviewed 40-character SHA | PASS |
| Lock hash equals `connector/package-lock.json` | PASS |
| SDK integrity equals the locked `zca-js` integrity | PASS |
| Template consent and grant are enrollment-only, with no account or peer | PASS |
| Template carries no timestamp or consent reference of its own | PASS |
| `preflight` admits the synthetic enrollment manifest | PASS |
| Admitted purpose is `enroll-session` | PASS |
| Admitted grant is not account-bound (`accountBound:false`) | PASS |
| Admitted grant has zero peers (`peerCount:0`) | PASS |
| Admitted budget is 10 parts/day | PASS |
| Admitted interval is 2000 ms | PASS |
| Admitted lifetime is at most one hour | PASS |
| Denied: build mismatch | PASS |
| Denied: consent expired | PASS |
| Denied: consent reference mismatch | PASS |
| Denied: enrollment manifest bound to an account | PASS |
| Denied: enrollment manifest with a peer | PASS |
| Denied: expired grant | PASS |
| Denied: grant issued in the future | PASS |
| Denied: lifetime over one hour | PASS |
| Denied: `observe` purpose | PASS |
| Denied: `send-test` purpose | PASS |
| Denied: two peers | PASS |
| Enrollment manifest refused by the `observe` host stage check | PASS |
| Enrollment manifest refused by the `send-test` host stage check | PASS |
| `run-observe` refuses the enrollment-only grant | PASS |
| `run-send-test` refuses the enrollment-only grant | PASS |

The admitted output is deliberately narrow:

```text
{"command":"preflight","ok":true,"gate":"admitted","purpose":"enroll-session","accountBound":false,"peerCount":0,"maxPartsPerDay":10,"minIntervalMs":2000,"lifetimeMs":2100000}
```

## Private QR view (synthetic PNG)

The reviewed image's `PrivateQrFileView` was exercised with a synthetic 33-byte PNG in a throwaway directory:

| Check | Result |
| --- | --- |
| Fixture runs as UID 65532 | PASS |
| `qr.png` is `0600`, owned by 65532, a regular file, not a symlink | PASS |
| View directory is `0700`, owned by 65532 | PASS |
| Only `qr.png` remains after display | PASS |
| `clear()` removes the file | PASS |
| `clear()` is safe when the file is absent | PASS |
| World-readable view directory refused | PASS |
| Symlinked `qr.png` refused, link target untouched | PASS |
| Non-PNG bytes refused | PASS |
| View directory owned by another UID refused | PASS |
| Every synthetic directory cleaned | PASS |

Private material modes on the host: template `600`; fixture directory `700`; `pilot/session.key` `600` owned by 65532; `pilot/state` `700` owned by 65532; no `qr.png` left anywhere under the enrollment material.

## Finding fixed during verification

The first re-run of the suite failed: `deny-future-issued.json` was **admitted**. The fixture had been generated 20 minutes earlier, so its "future" `issuedAt` had already passed and the manifest was now a valid, unexpired grant. The gate behaved correctly; the fixture was time-stale.

Fix: the generator now removes prior connector-owned fixtures before rewriting them, and the verifier regenerates all fixtures at the start of every run. The denial cases now assert the intended behaviour regardless of when the suite is executed. This changes test tooling only; the preflight gate was not modified.

## Residual risks

- Admission here is local and offline. It proves the grant will pass the same reviewed gate at activation; it does not prove provider availability or account eligibility.
- The template must be filled with a real Owner consent reference and an explicit UTC window at activation. That action is reserved to the Owner and is not performed by this gate.
- The QR view is proven with a synthetic PNG. A real QR is produced only by the provider during an authorized bootstrap; the file handling is the same code path.
- The observe/send-test stages remain functionally blocked because their runtime-only hosts are not admitted by the gateway. Their refusal is expected and required by the current authorization.
- The template's budget (10/day, 2000 ms) is the maximum; the Owner may reduce it, never raise it within this pilot.

## Status

`D3_ENROLLMENT_PREFLIGHT_READY` — PASS on the actual host. No live Zalo action was involved or implied.
