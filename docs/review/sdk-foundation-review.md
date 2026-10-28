# SDK foundation review

2026-10-28. Scope: current package/lock changes, Docker/CI, artifact pin test, offline probe, artifact/dependency evidence and supplied notices. Read-only implementation review; only this report was written. Facade behavior is reviewed separately and is excluded here.

**Findings: no P0/P1/P2 identified within this scope.** Hosted CI remains pending. This review does not claim advisory/signature, container build, or production runtime checks have passed.

## Specification checks

- `package.json:47` pins zca-js exactly 2.2.0 in devDependencies; production dependencies exclude it. `package-lock.json` pins the same version, development flag, npm URL and SHA-512 integrity `sha512-pBU0T0/uadH3Neq7yMssUmE769VVuqKhL8YD1HqQQG8e6lkwueAopNu0vhJdqiJRHZdPIEomT2FxRzauOx4pgA==`. The new `tests/transport/sdk-artifact.test.ts` asserts these boundaries. Existing lock package entries remain unchanged except root devDependencies; 31 entries are added, including a nested semver 7.8.5 distinct from existing root semver 6.3.1.
- `ops/Dockerfile:9,13` installs with ignore-scripts, builds explicitly and prunes dev dependencies with ignore-scripts before runtime copy. CI checks `/app/node_modules/zca-js` is absent in the built image. No SDK import was added to production server/client by these changes. Actual Docker/prune success requires execution evidence.
- `.github/workflows/ci.yml:51-62` disables install lifecycle scripts, retains high-severity npm audit, adds npm audit signatures and runs the offline probe. Bash run steps use the explicit bash shell, so failed commands piped to tee fail under GitHub's pipefail behavior. The signature gate uses public registry metadata and does not perform provider login. Missing/unsupported attestation is not established provenance; metadata signatures are not equivalent to a completed verification result.
- `package.json:24` launches the probe with Node permissions and a narrow filesystem read allowlist. `tests/fixtures/sdk-offline-probe.mjs:15-46` asserts writes/children denied, replaces fetch/HTTP/HTTPS/TCP/TLS/datagram entrypoints, synchronizes builtin ESM bindings and checks the guards themselves. SDK ESM import and CJS require occur only afterward (`54-56`). Its new Zalo and Message constructor calls use synthetic data and never invoke login/QR (`59-67`). Normalized direct peer/self/group results, malformed numeric inbound rejection and ESM/CJS parity are checked (`68-88`). This covers actual imports/models without claiming authentication, listener or send execution. Root reports two probe tests passed locally; this static review did not rerun SDK code.

## Evidence and notices

`docs/evidence/sdk-artifact.json` records exact integrity/hash/registry gitHead and explicitly says source equivalence is not established. Signature/advisory statuses are pending hosted CI; local attempts did not start while awaiting approval. No pass is inferred. CryptoJS 4.2.0 discontinued-development risk is explicit both in lock deprecation and artifact evidence, and is accepted only for isolated development pending promotion review.

The reviewed inventory lists **31 packages and 32 supplied license files**. Read-only checks resolved each package by matching name/version/integrity in lockfile, verified all listed SHA-256 file hashes, and verified each supplied text appears in THIRD_PARTY_NOTICES.md after CRLF normalization. Pako includes MIT LICENSE plus `lib/zlib/README` containing Zlib terms. This is supplied-notice preservation, not legal clearance of every embedded component.

Spark-md5 3.0.2's installed package supplies WTFPL LICENSE; its README links an alternative MIT LICENSE2, but LICENSE2 is absent from the installed package and current inventory/notices. Accordingly this review does not claim LICENSE2 was preserved. The documented `(WTFPL OR MIT)` declaration plus supplied WTFPL text does not itself invent missing MIT text.

Final regenerated inventory carries the exact resolved `path` on every row. Rechecked all 31 rows against matching lock version/integrity and all 32 license file hashes/texts successfully. SDK semver is correctly recorded at `node_modules/zca-js/node_modules/semver` (7.8.5), distinct from root semver (6.3.1). Package/lock pin is unchanged.

## Limits

No new installs, SDK execution, login/account calls, network/audit/signature checks or production actions were performed by this reviewer. Pending hosted audit/signature gates and build/prune checks must supply their own evidence before completion claims. Known facade limitations remain in its separate review.
