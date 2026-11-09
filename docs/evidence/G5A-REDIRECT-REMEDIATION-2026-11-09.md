# G5-A redirect remediation and reconciliation readiness — 2026-11-09

Repository `kha997/zalo-shared`, branch `feat/shared-inbox`, PR #3 (open, draft).
Directive: *"G5-A redirect remediation & reconciliation preparation"*. This record
covers Mission A (redirect remediation), Mission B (reconciliation readiness) and
Mission C (next-attempt readiness). No QR was generated, no provider was contacted
or authenticated, no live allowlist was modified, no reconciliation was executed,
no observe/send/media action ran, no bypass was added, nothing was deployed or
merged, and the consumed 2026-11-09 grant was neither retried nor reused.

Inputs: [G5A-BOOTSTRAP-ATTEMPT-2026-11-09](G5A-BOOTSTRAP-ATTEMPT-2026-11-09.md)
(the failed attempt), the deployed four-host inventory, and the pinned
`zca-js@2.2.0` sources. The attempt's sanitized diagnostic detail is the only
record of the refused destination.

## 1. Independent verdict on `jr.zaloapp.com`

**Verdict: legitimate and necessary as the destination the provider itself directs
the pinned SDK to; admitted at host level only; CERTAIN as the observed hop,
PROBABLE as Zalo-controlled, UNPROVEN as a complete post-scan chain.**

Evidence, in decreasing strength:

1. **The provider named it.** On 2026-11-09 the authorized attempt's
   `checkSession` response carried a `Location` for `jr.zaloapp.com`; the fetch
   policy refused it and recorded
   `{request:"check-session", redirect:"unexpected-location",
   source:"id.zalo.me", destination:"jr.zaloapp.com", hops:0}`. This is not
   inference from a fixture: the pinned SDK's own request produced the hop. The
   exact detail string is preserved byte-for-byte in the attempt record §6.
2. **The SDK is built to follow it.** `zca-js@2.2.0` `dist/apis/loginQR.js:194-211`
   requests the exact `checkSession` URL with
   `continue=https://chat.zalo.me/index.html`, and `dist/utils.js:289-298`
   follows any `Location` it receives with a second `request()`. A redirect at
   this point is the designed handshake, not an anomaly.
3. **Domain attribution (offline, third-party).** Certificate Transparency
   (`crt.sh`, query `%.zaloapp.com`, JSON output, fetched 2026-11-09) returns 693
   certificates and 380 distinct names, including a current DigiCert
   `*.zaloapp.com` wildcard valid `2026-01-05`–`2027-01-07` and hundreds of Zalo
   service names such as `accounts.chat.zaloapp.com`,
   `accounts.page.zaloapp.com` and `accounts.toolkit.zaloapp.com`. There is no
   explicit `jr.zaloapp.com` leaf because the wildcard covers it. The same query
   was sanity-checked against `id.zalo.me` (45 CT entries, DigiCert
   `*.id.zalo.me`), so the method is known to surface names for this provider.
4. **Limits.** No DNS query, A-record lookup, domain-registration query or live
   TLS probe was made for this record; the earlier draft's "/24 A record"
   sentence was not reproducible and has been removed from
   `ops/pilot-egress-allowlist.json`. CT proves the namespace, not the operator.
   The `Location` path and query were never recorded, so the admission cannot be
   narrowed below the host. Whether `jr.zaloapp.com` itself returns a further
   redirect is unknown; the policy refuses it and reports `redirect-after-hop`,
   which would make the one-hop design insufficient for this provider and require
   a separate decision.

## 2. Exact policy change

The change replaces one host and adds no grammar:

| Artifact | Before | After |
| --- | --- | --- |
| `adapters/zalo/redirect-policy.ts` `REDIRECT_HOST` | `chat.zalo.me` | `jr.zaloapp.com` |
| `ops/pilot-egress-allowlist.json` admitted redirect-target | `chat.zalo.me` | `jr.zaloapp.com` (`port: 443`, `maxHops: 1`, same rule text) |
| `ops/pilot-egress-allowlist.json` excluded | — | `chat.zalo.me` documented as `continue` parameter / cookie domain only, never a request target or followable hop |
| `ops/pilot-compose.example.yml` `PILOT_EGRESS_HOSTS`, `GATEWAY_ALLOW_HOSTS`, `extra_hosts` | `...,chat.zalo.me` | `id.zalo.me,wpa.chat.zalo.me,jr.chat.zalo.me,jr.zaloapp.com`, pinned to `172.16.29.10:443` |

Unchanged and re-asserted: exactly one hop, only from the exact `checkSession`
URL; absolute `https:`; exact host; port empty or `443`; no userinfo, IP literal,
trailing dot, backslash, whitespace or control character; `redirect:"manual"`
forced on every request; the hop is single-use and bound to the exact `href`; the
redirect host is never a direct target; any non-`checkSession` 3xx is
`unexpected-redirect`; any 3xx after the hop is `redirect-after-hop`; the
allowlist remains four hosts and `ops/local/check-pilot-network.sh` proves the
policy constant, JSON, compose values and pins agree.

**Deployment status: staged, not deployed.** The running gateway still has
`GATEWAY_ALLOW_HOSTS=id.zalo.me,wpa.chat.zalo.me,jr.chat.zalo.me,chat.zalo.me`;
the private interpolation, image pointer and compose copy were not touched. Until
an Owner-authorized deployment, the next bootstrap attempt would fail closed
identically.

## 3. Regression results

Environment: WSL Ubuntu 24.04, Node `v22.22.2` local (CI uses Node 24), disposable
PostgreSQL `zs-pg-test`.

| Check | Result |
| --- | --- |
| `npm run typecheck` (`tsc --noEmit`) | **PASS** |
| Four redirect/QR transport suites (`sdk-redirect-policy`, `sdk-redirect`, `sdk-redirect-diagnostics`, `qr-bootstrap`) | **PASS 78/78** |
| Full backend + transport suite | **PASS 407/407** |
| `ops/local/check-pilot-network.sh` | **PASS**, all assertion groups (redirect policy `jr.zaloapp.com:443`; pins exactly `id.zalo.me`, `jr.chat.zalo.me`, `jr.zaloapp.com`, `wpa.chat.zalo.me`; no pending/excluded host admitted) |

Honest note on a transient failure: one interleaved local run showed 3 failures
(operator HTTP 409, two recovery-state checks) because an orphaned background
test process was still attached to the same disposable database. After
confirming no test process remained, two clean isolated runs passed 407/407 and
the four suites passed 78/78. The failure was local harness contention, not a
product regression; it is recorded rather than hidden.

New or strengthened offline cases:

- the real pinned SDK resolves the observed 2026-11-09 hop to `jr.zaloapp.com`;
- the previously assumed `chat.zalo.me` target is refused as
  `unexpected-location`;
- a second hop back to the old hypothesis host is refused;
- a `checkSession`-shaped 3xx with a different/missing `continue` or an extra path
  segment grants no hop (new);
- uppercase `Location` normalizes to the same admitted hop while uppercase
  runtime host entries are still refused at construction (now asserted on both
  sides);
- all prior adversarial shapes remain refused: suffix/prefix/subdomain lookalikes,
  userinfo, IP literals, `http:`, non-443 ports, trailing dot, backslash, CRLF
  injection, relative URLs, direct requests to the redirect host, missing/other
  `Location`, and reuse of a consumed hop.

## 4. Independent security review

A fresh independent review (separate agent, read-only, no network call of its
own) returned **APPROVE WITH CONDITIONS**: one host substitution, no policy
grammar change, fail-closed on every probed bypass axis
(`JR.ZALOAPP.COM`, `:0443`, `#@evil.test`, `%2e`, `\@evil.test` all refused except
same-host normalization). Findings and disposition:

| Severity | Finding | Disposition |
| --- | --- | --- |
| Medium | allowlist cited a non-existent evidence document and an unverifiable A-record/registration attribution | **Closed**: this document exists and the attribution is restated from reproducible CT data only |
| Medium-low | `G5-LIVE-PILOT-PROCEDURE.md` still described the deployed inventory as `chat.zalo.me` as redirect-target | **Closed**: it now records the deployed three-plus-`chat.zalo.me` inventory and the staged `jr.zaloapp.com` replacement separately |
| Low | "three-host allowlist" test commentary was stale | **Closed**: commentary now describes the four-host allowlist with the redirect host deliberately withheld in guard tests |
| Low | uppercase `Location` vs uppercase config asymmetry untested | **Closed**: both directions asserted |
| Low | no test for a `checkSession`-shaped 3xx with a different `continue` | **Closed**: new test covers different/missing `continue` and an extra path segment |

Residual risks carried: a further redirect from `jr.zaloapp.com` would fail closed
and consume the attempt; TLS trust for the host is untested live (verification is
end-to-end, so a bad chain is a hard failure); the admission is host-level because
the path/query were not recorded; admission is container-wide, so a future
post-login service map naming `jr.zaloapp.com` would also be reachable during
observe/send-test (same shape as the retired `chat.zalo.me`, not worse).

## 5. CI artifact and deployment readiness

- Run [42635857403](https://github.com/kha997/zalo-shared/actions/runs/42635857403),
  event `pull_request`, attempt 1, `2026-11-09T14:33:33Z`, **success**; jobs
  `test` and `pilot` both success.
- Head `8d9e39d671202b9588748ef6122b3d2992b1185f` at workflow
  `ci.yml@refs/pull/3/merge`.
- Artifact `pilot-connector-image`: archive 166,075,392 B, local
  `sha256 d416e76f703abe9cc0b022a765d9aab24e2798aeb31f6cd194cb5d983d1f73b7`,
  equal to the run's `connector-image-sha256.txt`; run image id (config digest)
  `sha256:1c643dd95de62e782c90661aa746f240e217e660b164f1fcf9c4542a729555a6`.
- Embedded build identity read back inside the loaded image: `version 1`,
  `sourceCommit 8d9e39d…`, `lockSha256 17dcd254…030c9b`, `sdkIntegrity
  sha512-pBU0T0/…Ox4pgA==` — equal to the run manifest and the connector lock.
- Loaded locally and staged as `zalo-shared-connector:g5-ci-8d9e39d`; local
  manifest digest `sha256:220982a796d3a34196c6b209cf660a85fc4e9091b3b9f705cfe6314a2d065fd1`
  (containerd store naming; see the digest-semantics note in
  [G5A-CI-PROVENANCE-2026-11-09](G5A-CI-PROVENANCE-2026-11-09.md) §6).
- Compiled policy verified inside the image:
  `REDIRECT_HOST = "jr.zaloapp.com"` present, `REDIRECT_HOST = "chat.zalo.me"`
  absent, forced manual redirect present.
- Not deployed: no connector container exists, the deployed gateway allowlist is
  unchanged, and the private interpolation points at the previous artifact. A
  bootstrap grant for the staged image must name `sourceCommit 8d9e39d…` because
  `server/pilot-policy.ts` compares the grant's build block with the image
  identity.
- Artifact retention is 14 days; the staged local tag is the durable copy.

## 6. Mission B — reconciliation readiness (read-only)

Read-only preflight (`ops/local/preflight-pilot-reconciliation.mjs`, run in a
`--read-only`, `--cap-drop=ALL`, `no-new-privileges`, `--network
zalo-shared-pilot-db` container with the private CA mounted and `verify-full`
URL): **`ok:true`, all checks pass**, TLS `TLSv1.3` /
`TLS_AES_256_GCM_SHA384`, database `zalo`.

| Item | Observed |
| --- | --- |
| Ownership | `uncertain`, owner `af5048a8-41c7-46b3-920c-310855d6c911`, label `pilot-enrollment`, epoch **7**, fault `shutdown`, uncertainAt `2026-11-09T13:25:18.446420Z` |
| Preserved fence | last fenced `7cc878cf-cdb1-4b4a-9905-2d107aa21482` / epoch `5` / `2026-11-07T00:54:51.642226Z` |
| Provider | `disconnected`, `reconciliation_required=true`, gap **7**, fault `shutdown`, `last_event_at` null |
| Identities | 1 user, 1 admin, 0 sessions |
| Unresolved work | provider events, media jobs, outbox/messages, delivery parts all **0** |
| Data tables | messages, outbox, delivery parts, events, variants, media jobs, ledger, budgets, attachments, conversations all **0** |
| Audit | 28 rows; prefix `connector.reserved`, `connector.uncertain`; `connector.reconciled` ×3; max id 28 |
| Concurrency | advisory locks **0**, other sessions **0** |

Private-state read-only checks: `session.enc` absent, `qr.png` absent,
quarantine absent, `session.key` present, private view directory empty, no host
connector/bootstrap process, and the pilot database network contains only
`zalo-shared-pilot-app-1` and `pilot-postgres`.

Operational note: an earlier preflight in the same window returned
`ok:false` solely on `other_sessions=1`, attributed to an idle pooled connection
from the deployed application container (`zs_app@172.16.30.3`). The later run
returned 0. The execution procedure must therefore re-run the preflight
immediately before the single request and require `other_sessions=0`; if the
deployed app reconnects, it must be quiesced for the window (stopped, or its pool
confirmed idle) rather than ignoring the predicate.

Prepared transition (not executed):

```json
{
  "requestId": "<uuid v4 generated inside the authorized window>",
  "expectedOwnerId": "af5048a8-41c7-46b3-920c-310855d6c911",
  "expectedOwnerEpoch": "7",
  "expectedGapVersion": "7",
  "evidenceRef": "<Owner authorization reference for this reconciliation>",
  "confirmOwnerApproved": true,
  "localState": { "sessionFile": "absent", "quarantine": "absent" }
}
```

`POST /api/provider/operations/reconcile` with admin session + CSRF; exactly one
request; expected response `{"ok":true,"epoch":"8","gapVersion":"8",
"alreadyApplied":false}`; the operation writes audit id 29 `connector.reconciled`
with before/after epoch and gap. Post-checks: ownership `idle`, owner null, epoch
8, `uncertain_at`/`fault_code` null, provider `disconnected`,
`reconciliation_required=false`, gap 8, zero unresolved work, no further provider
contact.

Explicitly not done: no POST, no SQL mutation, no state reset, no retry, no
reconciliation. A new Owner authorization naming a UTC window is required first.

## 7. Mission C — next G5-A readiness

- The automatic Windows QR viewer path is unchanged and still rehearsed with a
  synthetic fixture (no real QR): the Owner opens
  `C:\Users\Admin\pilot-private-qr\g5a-qr.png`, scans within the 100-second
  lifetime, and confirms the displayed identity by typing `confirm`.
- For the next attempt, only two gaps remain after deployment and reconciliation:
  scan the QR and confirm the identity. The staged connector, the hardened
  preflight and the per-stage manifest generator are unchanged.

## 8. Invariants honored

No real QR; no provider contact or authentication; no live allowlist
modification; no reconciliation execution; no observe/send/media; no security
bypass; no production deploy or PR merge; no retry or reuse of the consumed
grant. The only network calls made for this directive were to `crt.sh` (public
Certificate Transparency data) and GitHub (repository and CI); neither contacted
a Zalo endpoint.

## 9. Remaining Owner approvals

1. **Deploy the staged redirect fix** (image `g5-ci-8d9e39d`, compose values,
   gateway recreated) — separate explicit authorization; not started.
2. **Reconciliation** — explicit authorization with a UTC window and the
   `evidenceRef`; the reviewed transition is `uncertain → idle`, epoch `7 → 8`,
   gap `7 → 8`, `reconciliation_required → false`.
3. **Next G5-A bootstrap** — fresh grant bound to `sourceCommit 8d9e39d…`, with a
   new UTC window; one attempt, no retry.
4. **Acknowledge the residual risk** that `jr.zaloapp.com` may itself redirect;
   if it does, the attempt fails closed with `redirect-after-hop` and a second
   host decision is required.

**Verdict: `G5A_REDIRECT_FIX_REVIEWED_AND_RECONCILIATION_READY`.**
Portions of this record are UNPROVEN live: the redirect chain beyond one hop and
the TLS chain for the new host. No live action was taken.
