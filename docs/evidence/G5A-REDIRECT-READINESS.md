# G5-A — Redirect-readiness evidence (prepared, not deployed)

**Date:** 2026-11-05
**Scope:** offline implementation, synthetic regression and independent review
**Status:** prepared in the repository. **The deployed allowlist, gateway and
connector image are unchanged.** No provider contact, no QR generation, no login.

This document records the work that followed
[G5A-SDK-REDIRECT-ANALYSIS.md](G5A-SDK-REDIRECT-ANALYSIS.md). That analysis
proposed a conditional admission of `chat.zalo.me:443` for the single
`checkSession` redirect and a no-new-host alternative. This change implements
the first option **offline** so that the decision is a configuration change,
not an engineering task, if the Owner accepts it.

## 1. What changed

| Item | Change | Deployed? |
| --- | --- | --- |
| `adapters/zalo/redirect-policy.ts` | new fetch policy installed as the SDK `polyfill` on the bootstrap path | with the image only |
| `adapters/zalo/qr-bootstrap.ts` | installs the policy; maps a refusal to `redirect-denied` | with the image only |
| `ops/pilot-egress-allowlist.json` | `chat.zalo.me` moved from `excluded` to `admitted` as `redirect-target`, port 443, stage `bootstrap` | **no** |
| `ops/pilot-compose.example.yml` | `PILOT_EGRESS_HOSTS`, `GATEWAY_ALLOW_HOSTS`, `extra_hosts` pin, `PILOT_DIAGNOSTIC_FILE` | **no** |
| `ops/local/check-pilot-network.sh` | ties the redirect class and the policy constants to the reviewed allowlist | yes (static) |
| `ops/local/verify-deployed-pilot.sh` | derives the expected host list from the allowlist instead of a literal | yes (static) |
| `ops/Dockerfile.connector` | `SOURCE_COMMIT` is referenced in the identity `RUN`, so a cached layer cannot stamp another commit | with the image only |
| `server/pilot-reasons.ts` | adds `redirect-denied` (31st code) | with the image only |

Nothing was applied to the running stack: the gateway container, the connector
image and the deployed env file still contain the three-host policy from the
2026-11-04 attempt.

## 2. Enforcement shape

The admission is not general reachability. Five conditions hold at the SDK fetch
layer, before any socket:

1. every request is force-set to `redirect: "manual"`, so undici cannot follow a
   provider redirect inside `fetch` where the policy would not see it;
2. only absolute `https:` targets on reviewed hosts, port empty or 443, no
   userinfo, no IP literal, no trailing dot, no backslash, no control characters;
3. a `Location` is followed only when it answers the exact `checkSession`
   request, is exactly `https://chat.zalo.me/...`, and is used exactly once;
4. the redirect host is never a direct request target, so a bootstrap that does
   not redirect never reaches it;
5. any other `3xx`, including a `checkSession` `3xx` whose `Location` cannot be
   validated, is refused with `PILOT_REDIRECT_DENIED` and attributed as
   `redirect-denied`.

The hop is bootstrap-scoped in code only. `PILOT_EGRESS_HOSTS` is container
wide, so once the admission is deployed the process guard and the SNI gateway
admit `chat.zalo.me:443` for the whole connector process. This is recorded as a
residual risk in §5; it is a closing condition for the independent review, not a
property the network layer provides.

## 3. Independent review and dispositions

An independent reviewer who did not write the change examined the policy against
the pinned `zca-js@2.2.0` artifacts. Findings are reproduced by severity with the
disposition applied in this tree.

| # | Finding | Disposition |
| --- | --- | --- |
| H1 | Only `checkSession` sets `redirect: "manual"`. Every other SDK request let undici follow a provider redirect inside `fetch`, unseen by the policy, and reach the redirect host without the validated hop | **Fixed.** The wrapper forces `redirect: "manual"` on every request and refuses any `3xx` that is not the validated `checkSession` hop. Regression tests assert every real SDK call carries `manual` and that a non-`checkSession` `3xx` is refused (`tests/transport/sdk-redirect-policy.test.ts`). |
| M1 | Network admission is stage-blind and container-wide; the JSON `stages: ["bootstrap"]` is documentation, enforced only in code | **Documented residual (§5).** A guard-level bootstrap-scoped permit is a separate change and a separate decision; the Owner decides whether the code-level restriction is sufficient. |
| M2 | The checker only regexed two constants; changing `isCheckSession`'s separate constants could drift while staying green | **Partly fixed.** `isCheckSession` now derives origin, path and `continue` from the exported `CHECK_SESSION_URL`, so the JSON and the matcher cannot diverge. The checker additionally asserts an exact match between `REDIRECT_HOST`, `CHECK_SESSION_URL` and the allowlist entry. Behavioural coverage is the test suite, not the checker. |
| L1 | The two scripts lost the executable bit | **Fixed.** Both restored to `100755`. |
| L2 | A malformed target threw before setting the refusal flag, so it attributed as a generic login failure | **Fixed.** Every refusal path now sets the flag; `redirect-denied` is asserted for a malformed `Location`, an unvalidatable `3xx` and a direct redirect-host request. |
| L3 | The guard lowercases config hosts while the policy rejects uppercase, so a mixed-case environment is guard-admitted but policy-refused | **Accepted.** The result is fail-closed during configuration review; the compose file and checker use lowercase literals. |
| L4 | The header and docs overstated enforcement | **Fixed.** The module header now states the manual-follow rule and the bootstrap-only scope. |

The reviewer also noted that `tests/transport/sdk-redirect.test.ts` supplies its
own polyfill and therefore does not exercise the policy. That file is retained as
pinned-SDK behaviour evidence; the policy itself is exercised by
`tests/transport/sdk-redirect-policy.test.ts`, which drives the real `loginQR`
through the real policy and fails if the policy is removed.

## 4. Test evidence (offline)

| Suite | Result |
| --- | --- |
| `tests/transport/sdk-redirect-policy.test.ts` | 19/19 PASS — one-hop shape, malformed host sets, empty set, direct-target refusal, non-`checkSession` `3xx` refusal, stale-hop clearing, single use, invalid Locations, refusal without URL echo, forced-manual for every real SDK call, positive end-to-end resolve, 3-host fail-closed, lookalike/downgrade, second hop, no-redirect control, guard classification |
| `tests/transport/qr-bootstrap.test.ts` | 34/34 PASS — policy installed on the SDK, refusal attributed as `redirect-denied`, QR handoff through the real file view and the real terminal prompt, diagnostic survives process exit |
| `tests/transport/sdk-redirect.test.ts` | 5/5 PASS — pinned-SDK redirect behaviour |
| `tests/backend/pilot-cli.test.ts` | 16/16 PASS — closed reason vocabulary, non-secret operator output, pre-QR instructions |
| `ops/local/check-pilot-network.sh` | all assertions PASS — 4 admitted, 3 pending classes, 4 excluded; one redirect target tied to the policy constants |
| `npx tsc --noEmit`, `npm run build:connector` | PASS |

The full suite is reported in [PILOT-GATE-STATUS.md](../../PILOT-GATE-STATUS.md).

## 5. Residual risks and unknowns

1. **Provider behaviour is UNPROVEN.** The `302` on `checkSession` was never
   observed live. The synthetic fixtures, the pinned SDK source and the
   2026-11-04 failure shape support the hypothesis; they do not prove it.
2. **A session after the hop is UNPROVEN.** Even with the hop followed, whether
   the provider then issues a usable session is unknown until an authorized
   attempt.
3. **The admission is container-wide.** `PILOT_EGRESS_HOSTS` cannot be scoped to
   a command. Code restricts the follow to bootstrap; the guard and gateway admit
   the host for the process. During a live attempt the gateway audit must show
   exactly one `sni_allow chat.zalo.me:443` after the confirmation and none
   before; any earlier or repeated tunnel aborts the attempt.
4. **The alternative remains open.** The no-follow polyfill in
   [G5A-SDK-REDIRECT-ANALYSIS.md](G5A-SDK-REDIRECT-ANALYSIS.md) §5.7 adds no
   reachability but depends on unobserved provider behaviour. It is not
   implemented.
5. **Deployment is not done.** Shipping the change requires rebuilding the
   connector image from the final commit, re-rendering the gateway with the
   fourth host, and re-running `check-pilot-network.sh` and
   `verify-deployed-pilot.sh` on the host. The image built from `HEAD` is
   `zalo-shared-connector:g5-ready-6d9c0e9`
   (`sha256:97513c22ac749982bdda8dd44137bb3f99adaf0eb40e2924547e248715168c84`);
   the offline checks and the post-reconciliation state are recorded in
   [G5A-NEXT-BOOTSTRAP-PREFLIGHT.md](G5A-NEXT-BOOTSTRAP-PREFLIGHT.md).

## 6. Decision still required (Owner)

1. Accept the prepared `chat.zalo.me:443` admission for bootstrap, or require the
   no-new-host alternative first.
2. If accepted: authorize the redeploy of the gateway and connector image under a
   new UTC window.

**STOP — `G5A_NEXT_BOOTSTRAP_READY_AWAITING_OWNER_START` (pending the decision
above). No live allowlist change, provider contact, QR generation or login was
performed to produce this document.**
