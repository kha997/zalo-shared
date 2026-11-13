# G5-A redirect diagnostic remediation

> **Superseded 2026-11-11.** The window cleanup was replaced by a tri-state
> presence check plus a termination guard, and the diagnostic hop cap was
> lowered from 8 to 2. The SHA-256 at §2.1 is the 2026-11-07 sync reference and
> no longer matches the repository script. Current state:
> [G5A-TWO-HOP-REMEDIATION-2026-11-11.md](G5A-TWO-HOP-REMEDIATION-2026-11-11.md).

**Date:** 2026-11-07
**Authorization:** `DIAGNOSTIC IMPLEMENTATION AND OFFLINE DEPLOYMENT ONLY`
**Verdict:** `G5A_DIAGNOSTIC_DEPLOYMENT_BLOCKED`
**Live action:** none. No Zalo QR, login, provider probe, session, message observation or send occurred. PR #3 remains OPEN and Draft. No control state was reset.

## 1. Scope executed

The Owner authorized a diagnostic-only remediation so the next G5-A refusal is attributable, explicitly withholding authorization for a new live bootstrap, provider probe, message observation or sending. The implementation keeps every allow/deny decision byte-for-byte identical and adds only observation.

| Item | Result |
| --- | --- |
| Diagnostic implementation | `8a71644` — `server/pilot-diagnostic.ts`, `redirect-policy.ts`, `qr-bootstrap.ts`, `private-pilot-files.ts`, `pilot-connector.ts` |
| Offline regressions | `tests/transport/sdk-redirect-diagnostics.test.ts` (16 tests) |
| Windows QR viewer | `ops/local/qr-viewer.ps1`; timer fix `3f8703b`, path hardening `1ab90bb`, cleanup fix `c2f6a05` |
| Allowlist | unchanged: `id.zalo.me`, `wpa.chat.zalo.me`, `jr.chat.zalo.me`, `chat.zalo.me` (redirect-target only) |
| TLS | unchanged; connector `DATABASE_URL` still `sslmode=verify-full` |
| Docker boundary | unchanged; no compose, gateway or guard change |
| Recorded fields | stage, reason code, request category, redirect class, source/destination hostname when safe, hop count, UTC time, correlation id |
| Forbidden fields | full URL/path/query, `Location` value, cookies/auth headers, QR bytes, UID/phone/display name, IMEI/device fingerprint/user agent, session or SDK credentials |

That no admission decision changed is established by the independent diff review of `redirect-policy.ts` — the admission condition is the old condition verbatim, and the only semantic delta is a tightening, where a throwing `headers.get` now denies instead of propagating — and corroborated by the pre-existing redirect and bootstrap suites (53 tests) plus the 16 new tests. The suites assert current behaviour; they do not compare before and after. The full local suite passed **393/393**, run twice on 2026-11-07 against a disposable PostgreSQL instance. After the post-review viewer and test-comment commits, `tsc --noEmit` is clean and the 50 redirect/diagnostic tests pass again.

### 1.1 Closed classification

`server/pilot-diagnostic.ts` accepts only these literals and rejects any extra key:

- request: `check-session`, `provider-direct`, `redirect-follow`, `other`
- redirect class: `unexpected-redirect`, `unexpected-location`, `redirect-after-hop`, `direct-redirect-host`, `stale-hop`, `malformed-redirect`, `invalid-target`, `not-admitted`
- source/destination: a grammar-bounded lowercase hostname (≤253 bytes, no trailing dot, no IP address) or the token `invalid`
- hops: integer 0–8; correlation id: UUID v4 shape

Any value that does not fit is refused rather than redacted, so a URL, path, query or `Location` string cannot reach the file. A refused detail leaves the sink untouched.

## 2. Offline verification

| Check | Result |
| --- | --- |
| Closed vocabulary and exact-key validation | PASS |
| A: unexpected `Location` destination | PASS |
| B: redirect after the admitted hop | PASS |
| C: direct request to a redirect-only host | PASS |
| Malformed/relative/downgrade/port/userinfo/IPv4/IPv6/backslash/CRLF/`file:` Location | PASS (all refused, none followed) |
| Stale, reused and mismatched hop authorization | PASS |
| Real pinned `zca-js@2.2.0` drives the policy end-to-end | PASS for A/B; C and exit durability use a stub `Zalo` class over the same installed policy |
| Sink mode 0600, append, per-process correlation id | PASS; size/line caps and symlink refusal are not directly asserted (risk 9) |
| Failure line survives process exit | PASS (child-process test) |
| Independent diff review of admission logic | PASS — admission unchanged, one tightening (section 2.2) |
| In-image preflight with a synthetic manifest bound to `8a71644` | PASS — `{"ok":true,"gate":"admitted","purpose":"enroll-session"}` |
| In-image preflight with a manifest bound to the older `6d9c0e9` | PASS (correctly refused: `{"ok":false,"gate":"denied"}`) |
| In-image sink probe (`--network none`, synthetic values) | PASS — 2 lines, mode 600, max 245 bytes, same `cid`, invalid host value rejected, no URL/path retained |

Sanitized in-image diagnostic output:

```json
{"at":"2026-11-07T01:33:55.294Z","stage":"failed","reason":"redirect-denied","cid":"70af3b98-08e2-4600-9e2c-ae78b3835adb","request":"redirect-follow","redirect":"redirect-after-hop","source":"chat.zalo.me","destination":"other.example","hops":1}
{"at":"2026-11-07T01:33:55.329Z","stage":"start","cid":"70af3b98-08e2-4600-9e2c-ae78b3835adb"}
```

This is synthetic evidence. It proves the compiled sink, schema and persistence path inside the candidate image; it does not prove any live redirect classification.

The private sink already exists at `pilot/state/diagnostic.jsonl` and is wired through the reviewed compose (`PILOT_DIAGNOSTIC_FILE=/run/pilot/state/diagnostic.jsonl`, mode 0600, owner 65532). Per the prior mission's record it holds the closed-code history of the 2026-11-07 attempts, ending with `qr-shown` → `scanned` → `failed redirect-denied` at `00:05:07.348Z`; it was not re-read here because `pilot/state` is not on this workstation (risk 4). Nothing in that file was rewritten. Once the candidate is authorized and deployed, the next `failed` line carries the closed redirect classification alongside the same stage history.

### 2.1 QR viewer rehearsal (synthetic fixture only)

`ops/local/qr-viewer.ps1` waits for `PILOT_VIEW_DIR/qr.png` in WSL, copies it through `wsl.exe -u root` into `C:\Users\Admin\pilot-private-qr`, validates a bounded PNG (signature, IHDR, dimensions, ≤1 MiB), decodes it from memory so the staged file is never locked, logs its SHA-256, and shows it in a `TopMost` foreground window (560×660, 480×480 `Zoom` panel) with the instruction `Quét mã bằng ứng dụng Zalo A trên điện thoại.` It polls the source once per second, closes when the source disappears, and removes its staged copy. It will not log or return a clean exit unless the copy is gone (exit 5 otherwise). It never prints image bytes and contains no network code.

Before any `wsl.exe` call, the distribution name must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`, the source must match `^/[A-Za-z0-9._/-]+$`, and the staged Windows path must convert to `^/mnt/[a-z]/[A-Za-z0-9._/-]+$`; otherwise the viewer logs `viewer-refused` and exits 4. `wsl.exe` re-parses its arguments inside the distribution, so this check is what keeps a path or distribution name from reaching a root command.

| Rehearsal | Result |
| --- | --- |
| Fixture mode (`-FixturePath`, `-AutoCloseSeconds 4`) | PASS — staged SHA-256 `2dab0568…` at `01:40:17Z`, window shown, auto-closed, `staged-copy-removed`, `cleanup=final`, exit 0, no `qr.png` left |
| WSL source mode (synthetic file at `/tmp/g5-viewer-rehearsal/qr.png`) | PASS — staged `01:40:33Z`, window shown, source deleted, `viewer-close source-cleared` at `01:40:42Z`, copy removed, exit 0 |
| Corrupt/truncated PNG (valid 33-byte header, no image data) | PASS — `viewer-refused undecodable-png`, copy removed, exit 4 |
| Injected source path `/tmp/x;touch /tmp/g5-viewer-pwn` | PASS — `viewer-refused invalid-source`, exit 4, no command ran, no file created |
| Injected distribution `Ubuntu-24.04;id` | PASS — `viewer-refused invalid-distribution`, exit 4, no command ran |
| Real QR emitted | **not exercised** — no authorization for live activity |

Three viewer defects were found by review and rehearsal and fixed: the rehearsal auto-close timer was reachable only from its own handler scope (`3f8703b`); a source path or distribution name carrying shell syntax could reach the root copy (`1ab90bb`); and a corrupt PNG could fail decode outside the cleanup path, leaving a scannable copy while cleanup was logged (`c2f6a05`). Automatic close after the source disappears takes about 9 s because each poll starts `wsl.exe`; that is a latency cost, not a failure.

The canonical script is the repository file. The byte-identical rehearsal copy at `C:\Users\Admin\pilot-private-qr\qr-viewer.ps1` has SHA-256 `183d00433e98e0269cf09369d10eff405ba4eac88950e5dffe3fd007b9a697d9`; it must be re-synced whenever the repository file changes. From a normal PowerShell prompt, the repository copy can be started directly:

```
powershell -NoProfile -ExecutionPolicy Bypass `
  -File "\\wsl$\Ubuntu-24.04\home\zen\Projects\zalo-shared\ops\local\qr-viewer.ps1"
```

Start the viewer before the authorized bootstrap; it opens the window automatically when the QR file appears. The interactive connector console remains the place where the operator types the literal `confirm`.

Reading that 0700, uid-65532 directory from Windows requires root, and `wsl.exe -u root` is available to any local account without a password. The viewer is therefore a single-operator convenience on a dedicated host, not an access boundary (risk 7).

### 2.2 Independent review

A fresh-context reviewer read the diagnostic commits without this session's context, re-ran the suites and probed the schema adversarially. Verdict: **PASS WITH FINDINGS** — no path was found where the new code admits a request the old code refused, and no URL, `Location` value, credential or identifier can reach the sink. The identified issues were dispositioned as follows.

| Finding | Severity | Disposition |
| --- | --- | --- |
| The viewer reads the private directory through an unauthenticated `wsl.exe -u root`; any local Windows account holds the same access | Medium | Accepted trade-off for a local single-operator viewer; recorded as risk 7, header comment corrected |
| A corrupt PNG could fail decode outside the cleanup path and survive while cleanup was logged | Medium/Low | Fixed in `c2f6a05` and re-rehearsed |
| Every local denial is attributed to the first refusal once the policy is denied | Low | Recorded as risk 8; no code change |
| The test header overstated which cases drive the real pinned SDK | Low | Corrected |
| `not-admitted`, sink caps, symlink refusal and concurrent appends are not asserted | Low | Recorded as risk 9 |
| Diagnostic stage lines are fire-and-forget beside the awaited terminal line | Low | Recorded as risk 10; connector image left unchanged so the reviewed artifact stays valid |
| `destination` carries the requested host for `not-admitted`; `invalid` is a legal hostname shape; `cid` is per process | Info | Recorded as risk 11 |
| The live procedure does not yet mention the viewer or the new fields | Info | Deferred to the blocked deployment |

## 3. Candidate image

| Item | Value |
| --- | --- |
| Tag | `zalo-shared-connector:g5-diag-8a71644` |
| Image ID / local digest | `sha256:ab20e296570a47fff84cadd25bc1511b2c5ad7f481a687e2e7aa710fd08061ba` |
| Created | `2026-11-07T01:23:44.468Z` |
| Size | 57,511,663 bytes |
| Embedded source commit | `8a7164499f25cd0d4f467719371fafcb80896732` |
| Embedded lock SHA-256 | `17dcd25426639f7112b80764bc8aa27f9be2af3acf0aaf0f2cd490c434030c9b` |
| Embedded SDK integrity | `sha512-pBU0T0/uadH3Neq7yMssUmE769VVuqKhL8YD1HqQQG8e6lkwueAopNu0vhJdqiJRHZdPIEomT2FxRzauOx4pgA==` |
| Runtime | UID/GID 65532, `zca-js@2.2.0`, `crypto-js@4.2.0`, no private files, no exposed ports |
| Entrypoint / default command | `/nodejs/bin/node --require=/app/egress-guard.cjs` / `dist/connector/tools/pilot-connector.js dry-run` |

The identity check (`ops/local/check-connector-identity.sh`) returned `sourceCommitMatches`, `lockMatches` and `sdkMatches` true.

## 4. Deployment gate: BLOCKED

`ops/pilot-scan.sh` uses Trivy 0.76.1 and fails on **any** HIGH/CRITICAL finding, not only fixable ones (hardened in review `P2.4`). Under vulnerability DB v2 (updated `2026-11-06T18:59Z`) the candidate reports two unfixed HIGH findings:

| CVE | Package | Installed | Fixed | Severity |
| --- | --- | --- | --- | --- |
| `CVE-2026-76844` | `zlib1g` | `1:1.3.dfsg+really1.3.1-1+b1` | none | HIGH |
| `CVE-2026-85091` | `zlib1g` | `1:1.3.dfsg+really1.3.1-1+b1` | none | HIGH |

`highCriticalCount=2`, `fixableHighCriticalCount=0`; the scan exits non-zero.
Retained raw summaries: [candidate](g5-diag-connector-scan-summary.json) and
[deployed baseline](g5-ready-connector-scan-summary.json).

This is not introduced by the diagnostic change:

- The currently deployed baseline `zalo-shared-connector:g5-ready-6d9c0e9` reports the same two findings with the same database.
- The pinned distroless base digest and the current `gcr.io/distroless/nodejs24-debian13:latest` (index `sha256:03980f6f…`) both ship the same `zlib1g` version, so a base refresh is not a known remedy.
- Hosted CI runs the same `ops/pilot-scan.sh`; it will fail for any build until the findings are fixed upstream or explicitly assessed.
- Confirmed on hosted run `42323762758` for commit `8a71644`: the `pilot` job failed its connector scan and the `test` job failed its app-image scan with the same two findings, `highCriticalCount=2`, `fixableHighCriticalCount=0`. The container build and the nonroot/health smoke steps completed before the scan step failed; no other CI step failed.

The project's rules require an explicit assessment of unfixed HIGH/CRITICAL findings, and the Owner alone accepts residual risk. Accordingly the candidate was **not deployed**: the private interpolation file still names `zalo-shared-connector:g5-ready-6d9c0e9`, the reviewed compose copy is unchanged, and no connector container was started. This is a fail-closed stop, not a decision to waive the gate.

To proceed, the Owner must either:

1. explicitly accept `CVE-2026-76844` and `CVE-2026-85091` for this private, non-production pilot artifact, with the reachability assessment below standing as UNPROVEN; or
2. approve a separately reviewed base-image refresh once upstream publishes a fixed `zlib1g`.

After that decision, deployment is a single reviewed step — set `PILOT_CONNECTOR_IMAGE=zalo-shared-connector:g5-diag-8a71644` in the private interpolation file, run `ops/local/deploy-pilot-topology.sh`, and repeat `check-connector-identity.sh` plus the deployed-config checks — subject to one binding prerequisite the earlier plan missed.

The image embeds `sourceCommit` `8a71644`, and both `preflight` and `bootstrap` refuse a manifest whose `build.sourceCommit` differs. The branch has since advanced with host-side viewer commits (`1ab90bb`, `c2f6a05`), so a manifest generated from the current HEAD would be denied. At deployment, either rebuild the image from the then-reviewed HEAD and re-run the identity, preflight and sink probes, or generate the manifest with `GITHUB_SHA=8a7164499f25cd0d4f467719371fafcb80896732` so it binds to the existing candidate. The existing candidate remains built and verified.

`zlib1g` reachability from the connector's request path is **UNPROVEN**. Node statically bundles its own zlib; the distroless package may not be loaded by this workload. That observation does not satisfy the presence-based gate.

## 5. Deployed state re-verified (unchanged)

| Check | Observation |
| --- | --- |
| Reviewed compose copy | byte-identical to `ops/pilot-compose.example.yml` (`79845c33…`) |
| Connector image pointer | `zalo-shared-connector:g5-ready-6d9c0e9` (unchanged) |
| Egress gateway | `zalo-shared-pilot-egress-gateway-1`, healthy, only member of the uplink |
| Gateway allowlist | `id.zalo.me,wpa.chat.zalo.me,jr.chat.zalo.me,chat.zalo.me` (exact, unchanged) |
| Database TLS | `sslmode=verify-full` |
| Ownership | `idle`, epoch 6; fenced pair `7cc878cf-…`/5 preserved |
| Connector process | none started |
| Provider contact in this mission | none |

## 6. Remaining uncertainty and findings

1. **UNPROVEN:** whether `CVE-2026-76844`/`CVE-2026-85091` are reachable in this connector; no fixed package is available.
2. **UNPROVEN:** live redirect classification A/B/C. The evidence is synthetic and offline; only an Owner-authorized bootstrap can classify the real failure.
3. **FAIL (environmental):** the image-scan gate fails for both the deployed baseline and the candidate under the current vulnerability database. CI inherits this failure.
4. **UNPROVEN:** that the private sink still holds the 2026-11-07 attempt history. `pilot/state` is not present on this workstation, so that record is carried from the prior mission rather than re-read here.
5. **UNPROVEN:** whether the real SDK reproduces the pending hop URL byte-exactly. The fixture returns the exact href, so a false `stale-hop` during a live attempt cannot be excluded; the first live failure will show whether that class appears.
6. The viewer closes about 9 s after the source disappears because every poll starts `wsl.exe`. A stale window can outlive the QR, showing a code the provider has already invalidated; the staged copy is still removed on close.
7. The viewer reads the 0700, uid-65532 view directory through an unauthenticated `wsl.exe -u root`. Any local Windows account holds the same access to `qr.png`, `diagnostic.jsonl`, the key and the session file. This is a single-operator convenience on a dedicated host, not an access boundary; whether this host has additional local accounts was not audited.
8. Once the policy is denied, the first refusal is attached to any later login failure, so the recorded denial is the first refusal of the attempt, not necessarily its proximate cause. In practice a denial stops every later request, but the distinction is not asserted by a test.
9. Coverage gaps: `not-admitted` is not asserted on its own (the only test that reaches it is masked by the first-refusal rule); the sink 1 MiB cap, 1024-byte line cap, symlink refusal in `ready()` and concurrent appends are unexercised; the live procedure was not updated to mention the viewer or the new fields.
10. Diagnostic stage lines are fire-and-forget while the terminal `failed` line is awaited, so a `failed` line can precede a still-pending stage line, and a short `write` could in theory splice a line. The terminal line itself survives exit.
11. `destination` carries the requested host for `not-admitted`, not a redirect destination; `invalid` is itself a syntactically valid hostname, so that token is ambiguous; `cid` is per process, so "one correlation id per file" holds only for a single run.
12. The Windows-side viewer copy lives outside the repository and can drift from the reviewed script; the SHA-256 above is the sync reference.
13. The first viewer rehearsal exposed a scoping bug in the rehearsal timer; it was fixed in `3f8703b` and all modes were re-rehearsed afterwards.

## 7. Terminal verdict

`G5A_DIAGNOSTIC_DEPLOYMENT_BLOCKED`

The diagnostic implementation, offline A/B/C regressions, in-image verification, independent review and QR viewer rehearsal are complete. The review returned PASS WITH FINDINGS: admission is unchanged, no secret can reach the sink, and the three real viewer defects it and the rehearsals exposed are fixed. Deployment is stopped by the project's own image-scan gate on two unfixed HIGH findings that equally affect the currently deployed baseline and have no available fix. No live Zalo activity, production deployment, PR merge or control-state reset was performed. The next step is an explicit Owner decision on the two CVEs or a reviewed base-image refresh; once that is recorded, deployment also needs the image rebuilt at the reviewed HEAD or the manifest pinned to `8a71644` (section 4).

**STOP BEFORE ANY LIVE ZALO ACTIVITY.**
