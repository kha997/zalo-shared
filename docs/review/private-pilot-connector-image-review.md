# Separate pilot connector image review

Reviewed 2026-11-02. Scope: `connector/`, `tsconfig.connector.json`, `ops/Dockerfile.connector`, `ops/pilot-compose.example.yml`, `ops/pilot-scan.sh`, `ops/ci-pilot-manifest.ts`, and the hosted `pilot` CI job.

## Design under review

- The application image (`ops/Dockerfile`) stays SDK-free and keeps its `zca-js`-absent assertion.
- The pilot connector is a separate image whose runtime dependencies come only from `connector/package-lock.json`; the root development tree is never copied or pruned into it.
- `zca-js@2.2.0`, `pg@8.23.1` and `ipaddr.js@2.5.0` are exact; the lock records the reviewed `sha512-` SDK integrity.
- The image publishes no ports, runs as UID 65532, has no restart policy and defaults to `dry-run`.
- The hosted `pilot` job compiles the connector, builds the image from a pinned builder digest, runs the default dry-run with a synthetic owner-only manifest, then scans and asserts runtime identity.

## Local evidence

| Check | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm run build:connector` | PASS |
| Connector image build (`ops/Dockerfile.connector`) | PASS locally; requires `--build-arg SOURCE_COMMIT=<40 hex>` |
| In-container inventory | `uid=65532`, `zca-js=2.2.0`, `crypto-js=4.2.0`, resolved `/app/node_modules/zca-js/dist/cjs/index.cjs`, embedded build identity, no manifest/key/session/QR files |
| Default dry-run with a synthetic manifest mounted read-only | PASS locally and hosted (`gate:"admitted"`, purpose `observe`) |
| Connector scan assertions | PASS locally and hosted: UID 65532, no exposed ports, Trivy 0 HIGH/CRITICAL, 0 fixable |

## Findings addressed in review

| Finding | Disposition |
| --- | --- |
| The example Compose network was `internal: true`, which blocks outbound provider TLS and would make every live command fail. | **Fixed.** The example keeps a private bridge with no published ports and documents that host-level egress policy is an Owner decision. |
| The scan inventory container ran with default capabilities and network access even though it only reads package metadata. | **Fixed.** It now runs with `--network none`, `--read-only`, `--cap-drop ALL` and `no-new-privileges`. |
| The CI bind mount would be rejected by `readPrivateTextFile` because the runner-owned manifest did not match UID 65532. | **Fixed.** CI chowns the synthetic manifest to 65532 and sets mode 0600 before the dry-run. |
| The grant's build identity was self-asserted by the manifest, so a copied manifest could rebind a grant to another artifact. | **Fixed.** The build stage requires `SOURCE_COMMIT`, derives the lock hash and SDK integrity from the connector lock, and embeds `/app/build-identity.json`. The runtime requires an exact match before any key, database or SDK work; CI asserts the identity equals `GITHUB_SHA`; the scanner validates its shape and rejects private pilot filenames in the image. |

## Residual risks

- The image intentionally contains the unofficial SDK and its deprecated `crypto-js` transitive dependency. This is a deliberate live-promotion risk gate, not a clean application image.
- The scan summary is a dated advisory snapshot. Trivy findings, base-image digests and SDK behavior must be re-checked before any live use.
- No live login, provider call, QR scan or phone interaction is performed by CI. The dry-run proves manifest validation and image hygiene only.
- Hosted evidence: [CI 41377272040](https://github.com/kha997/zalo-shared/actions/runs/41377272040) on `105f2d7` passed both jobs. The first run (`f9ac8e5`) passed every substantive pilot step but failed evidence upload because the owner-only manifest was inside `docs/evidence/`; the manifest is now generated in `$RUNNER_TEMP`, outside the artifact, and the rerun is green.
