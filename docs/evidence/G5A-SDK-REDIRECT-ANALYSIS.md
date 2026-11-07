# G5-A — SDK redirect analysis

**Date:** 2026-11-04
**Scope:** offline static inspection and synthetic fixtures only
**Status:** analysis and conditional proposal. **No hostname was added to
`ops/pilot-egress-allowlist.json`, the deployed gateway or any runtime
configuration. No live provider contact was made.** Admission of
`chat.zalo.me` is gated on observed evidence and a separate Owner decision.

## 1. Question

The single authorized bootstrap on 2026-11-04 emitted a QR, the Owner scanned
and confirmed it on the official phone, and the connector then exited 1 without
a session. The provider recorded a login and immediate logout in the same
minute. One gateway `sni_allow` (`id.zalo.me:443`) and **zero denials** were
logged. The post-window hypothesis is:

> after the phone confirmation the SDK calls `checkSession`, the provider
> replies with a redirect to `chat.zalo.me`, the SDK follows that `Location`,
> and the local default-deny boundary refuses it *before* the gateway — so the
> refusal is silent in gateway audit and the login aborts.

This document answers two questions:

1. Does the reviewed egress policy reject a legitimate authentication redirect?
2. If the evidence supports admitting the redirect target, what exactly would
   have to be admitted, validated, tested and reviewed — still without adding it
   to the live allowlist?

## 2. Artifact identity

| Item | Value |
| --- | --- |
| SDK | `zca-js@2.2.0` (exact pin in `package.json`, `connector/package-lock.json`) |
| Integrity (connector lock) | `sha512-pBU0T0/uadH3Neq7yMssUmE769VVuqKhL8YD1HqQQG8e6lkwueAopNu0vhJdqiJRHZdPIEomT2FxRzauOx4pgA==` |
| Module loaded by the test | `node_modules/zca-js/dist/apis/loginQR.js`, via `pathToFileURL` |
| Extra host inventory | `node_modules/zca-js/dist` (complete shipped tree) |

The suite asserts the installed pin and the exact `checkSession` URL
(`tests/transport/sdk-redirect.test.ts`, test 5), so this analysis cannot drift
from the artifact it describes.

## 3. Static path reconstruction

All line numbers are in the shipped `zca-js@2.2.0` JavaScript that the connector
image installs.

1. **Login completes at the provider.** After the QR scan and the terminal
   confirmation, the SDK calls `checkSession(ctx)`
   (`dist/apis/loginQR.js:346`). This is the first step that expects an
   authenticated session.
2. **The session probe is a browser-style navigation.**
   `checkSession` issues
   `GET https://id.zalo.me/account/checksession?continue=https%3A%2F%2Fchat.zalo.me%2Findex.html`
   with browser navigation headers and `redirect: "manual"`
   (`dist/apis/loginQR.js:194-211`). The `continue` value is the default chat
   origin, not a request target by itself.
3. **The SDK follows redirects itself.** `request()` parses `Set-Cookie` and
   then, if the response carries a `Location` header, recursively calls
   `request(ctx, redirectURL, ...)` — for **any** absolute or relative target,
   with no host allowlist and no hop limit
   (`dist/utils.js:286-298`). `redirect: "manual"` therefore does not stop the
   follow; it only hands the 3xx response to this code.
4. **The local guard refuses the target.** In the pilot image the connector is
   preloaded with `ops/pilot-egress-guard.cjs`. It patches
   `net.Socket.prototype.connect`; a target that is not exactly
   `database`/`provider` (exact host **and** exact port) throws synchronously
   (`ops/pilot-egress-guard.cjs`, `classifyTarget` and the `connect` wrapper),
   and `dns.lookup` refuses the name as well. Nothing is written to the
   gateway, because no connection is attempted and no SNI is sent. The three
   admitted names are `id.zalo.me`, `wpa.chat.zalo.me`, `jr.chat.zalo.me`
   (`ops/pilot-egress-allowlist.json`); `chat.zalo.me` is classified
   `excluded`, and any provider-chosen redirect is the `pending` class
   `redirect-target`.
5. **The SDK converts the refusal into a generic login failure.**
   `checkSession` ends with `.catch(logger(ctx).error)` (`dist/apis/loginQR.js:212`),
   so the rejection becomes `undefined`; the caller then throws exactly
   `"Cannot get session, login failed"` (`dist/apis/loginQR.js:346-348`).
6. **The bootstrap adapter attributes it.** `adapters/zalo/qr-bootstrap.ts`
   races `loginQR` against abort/deadline and maps the fixed SDK message to
   `login-session-unconfirmed` without echoing it; no stage past
   `login-requested` is reported (`tests/transport/qr-bootstrap.test.ts`,
   "SDK login rejections map to the exact failing call…").
7. **Event type 4 is never emitted on this path.** The wrapper emits
   `GotLoginInfo` only after the inner `loginQR` resolves
   (`dist/zalo.js:76-92`). Because it rejected at step 5, no `imei`/`userAgent`
   event exists, which is consistent with the adapter stop at
   `login-requested` and with the absence of any local session.

The chain also explains the live observations without contradiction: one
`id.zalo.me` tunnel, no gateway denial (the refusal is local), an early exit
(27 s before the deadline), and a provider-side login that ends immediately
(the SDK never received a usable session).

## 4. Synthetic fixtures and results

`tests/transport/sdk-redirect.test.ts` loads the **real pinned module** and
supplies a synthetic `polyfill` (the SDK's documented fetch hook) that serves
`id.zalo.me` responses. No socket is opened.

| # | Fixture | Observed result |
| --- | --- | --- |
| 1 | `waiting-confirm` succeeds, `checksession` answers `302 Location: https://chat.zalo.me/index.html`; `chat.zalo.me` fetch throws `TypeError("fetch failed")` with `cause.code = PILOT_EGRESS_DENIED`, matching the guard's failure shape | `loginQR` rejects with exactly `Cannot get session, login failed`; **no** `wpa`/`jr` call; **no** event type 4; error text contains no host or provider text |
| 2 | `checksession` answers `302 Location: https://redirect.example.test/next` | The SDK follows the foreign host too and the same login failure is produced — the follow is unconditional, not provider-host-aware |
| 3 | `checksession` answers `200` with cookies and `jr.chat.zalo.me` answers userinfo | `loginQR` resolves with the cookie jar and `userInfo.uid`; proves the fixture models the success path, not a blanket failure |
| 4 | Child process with `-r ops/pilot-egress-guard.cjs` and the three-host allowlist attempts `chat.zalo.me:443` and `redirect.example.test:443` | Both throw `PILOT_EGRESS_DENIED` synchronously, before any socket; the gateway sees nothing |
| 5 | Artifact check | Installed package is `zca-js@2.2.0`; `loginQR.js` contains the exact `checksession` URL; the module exposes no `logout`; `utils.js` reads `response.headers.get("location")` |

Result: **5/5 PASS** on Node v24.19.0 (offline), together with 30/30 in the bootstrap
suite. Evidence status:

- **PASS (synthetic):** the SDK follows any `Location`; the guard refuses
  `chat.zalo.me` and foreign targets synchronously; the resulting SDK error is
  the observed stable string; the flow cannot reach userinfo, the listener,
  event 4 or a session write.
- **UNPROVEN (live):** that the provider actually returned this redirect on
  2026-11-04. The refusal leaves no local or gateway trace by construction, and
  the console output was not retained. The hypothesis remains the best
  explanation consistent with every recorded fact, but it is not proof.

## 5. Conditional proposal — `chat.zalo.me:443` for the redirect only

**This section is a proposal. Nothing here is deployed.**

If (and only if) a future authorized attempt observes the redirect — or the
Owner accepts the synthetic evidence — admission would be scoped as follows.

### 5.1 Exact host and port

| Field | Value |
| --- | --- |
| Host | `chat.zalo.me` |
| Port | `443/tcp` only |
| Classification | `redirect-target` (moved from `pending`, not merged into `provider`) |
| Stage | `bootstrap` only |
| Purpose | the `Location` target of `id.zalo.me/account/checksession` after the phone confirmation. Not a general API host; not admitted for observe, send-test or media |

### 5.2 Redirect validation policy

Admission of the host is not permission to follow arbitrary redirects. The
follow would have to be constrained by the connector's fetch layer (the SDK's
`polyfill` option) before the guard ever sees a socket:

1. Only a `3xx` response to the exact origin and path
   `https://id.zalo.me/account/checksession` may be followed. Every request is
   force-set to `redirect: "manual"` so undici cannot follow a redirect inside
   `fetch` where the policy would not see it.
2. The `Location` must parse as an **absolute `https:` URL** with host exactly
   `chat.zalo.me` and port empty or `443`. No userinfo, no IP literal, no
   trailing dot, no other scheme, no relative target.
3. Exactly one redirect hop is followed. A redirect from `chat.zalo.me` to any
   other host — including back to `id.zalo.me` — ends the request as a failure.
4. The admitted set for this request is a single origin. Wildcards, suffix
   matching, `*.zalo.me` and "any host seen in a 3xx" are prohibited.
5. Any deviation fails closed with the non-secret `redirect-denied` reason and
   never echoes the `Location`.

The network layers stay independent: even with the host admitted, the internal
Docker topology and the SNI gateway still decide whether the connection is
possible. The fetch check narrows the SDK; it is not the enforcement boundary.

### 5.3 TLS verification requirements

- Exact SNI `chat.zalo.me`; the gateway tunnels raw TLS and never terminates it.
- Certificate validated by Node's default trust store on the connector side;
  `NODE_TLS_REJECT_UNAUTHORIZED=0` and `--use-env-proxy` already abort at guard
  load (`ops/pilot-egress-guard.cjs`, `loadConfig`).
- No custom CA, no pinning bypass, no downgrade to HTTP, no alternate port.
- Keep-alive and all other socket hardening unchanged.

### 5.4 Negative security tests required before admission

1. `https://chat.zalo.me.evil.test/` — suffix lookalike refused.
2. `https://evil.chat.zalo.me.test/` — prefix lookalike refused.
3. `http://chat.zalo.me/` — scheme refused (gateway cannot carry plaintext).
4. `https://user@chat.zalo.me/` — userinfo refused.
5. `https://chat.zalo.me:8443/` — non-443 port refused.
6. `https://chat.zalo.me/` as the **first** request (no preceding
   `checksession`) — refused by the fetch layer and by the per-request origin
   set, even though the host is admitted.
7. Two-hop chain `chat.zalo.me -> other.example` — second hop refused.
8. Redirect to an IP literal (`https://<address>/`) — refused.
9. Relative `Location: /index.html` — refused by the absolute-URL rule.
10. Guard-level: `chat.zalo.me:443` still denied when the allowlist does not
    contain it (the current deployed state), proving the runtime config, not
    the SDK, decides.

Tests 1–3 and 9 must fail **before** a socket; the guard test proves the
synchronous, no-gateway-event property already observed.

### 5.5 Expected gateway audit behaviour

With the host admitted and the redirect observed:

- one `sni_allow` for `id.zalo.me:443` (login page / QR endpoints),
- one `sni_allow` for `id.zalo.me:443` (`checksession`) — same tunnel family,
- one `sni_allow` for `chat.zalo.me:443`, emitted **after** the `checksession`
  request and never before the QR confirmation,
- zero `sni_deny` lines for `host-not-allowlisted`; any `sni_deny` for
  `chat.zalo.me` means the allowlist and the connector disagreed and the
  attempt must abort,
- no tunnel to any name outside the four admitted hosts, and no tunnel to
  `chat.zalo.me` on a port other than 443.

The gateway audit is the evidence source that would confirm or refute the
hypothesis on the next authorized attempt, because an admitted target now
produces a tunnel instead of a silent local refusal.

### 5.6 Required independent review

Before any live admission: a reviewer who did not write the change reproduces
the negative tests in 5.4 on a disposable host, confirms the fetch layer cannot
be bypassed by another SDK code path (the follow lives in the shared
`request()` helper), confirms the allowlist checker still ties `PILOT_EGRESS_HOSTS`,
`extra_hosts`, `GATEWAY_ALLOW_HOSTS` and the JSON to one source, and confirms
the change does not enable observe/send hosts.

### 5.7 Least-privilege alternative (no new host)

Instead of admitting the host, the connector can supply a `polyfill` that
**does not follow** a redirect to an unadmitted origin: it returns the `3xx`
to the SDK. `checkSession` only tests truthiness of the result
(`dist/apis/loginQR.js:346-348`), and `Set-Cookie` from the `302` is already
parsed before the follow (`dist/utils.js:278-285`), so the login may proceed to
userinfo with the cookies the provider set on the `checksession` response.

This alternative adds **no** network reachability and keeps the allowlist at
three hosts. It is not implemented because:

- it depends on provider behaviour that is not observed (whether the `302`
  alone carries a usable session), so it could silently produce a session that
  fails on the first real API call;
- it changes SDK semantics relative to the pin, which requires its own review.

If the Owner prefers minimum reachability, this is the option to evaluate
first, under a new authorized attempt with console capture. If the session is
unusable, the alternative fails closed at `login-session-unconfirmed` or a
later gate and admission of `chat.zalo.me:443` becomes the evidence-based
fallback.

## 6. What was changed, and what is deployed

| Item | State |
| --- | --- |
| `ops/pilot-egress-allowlist.json` | **modified in the repository, not deployed.** `chat.zalo.me` is `admitted` as `redirect-target`, port 443, stage `bootstrap`; see [G5A-REDIRECT-READINESS.md](G5A-REDIRECT-READINESS.md) |
| `ops/pilot-compose.example.yml`, deployed gateway, `PILOT_EGRESS_HOSTS` | **modified in the repository, not deployed.** The running stack still has the three-host policy |
| SDK pin, `adapters/zalo/sdk-facade.ts`, guard logic | unchanged; the bootstrap path gains a fetch policy in `adapters/zalo/redirect-policy.ts` |
| Provider contact | **none** |
| Live allowlist | **not modified** |

The proposal in §5 is implemented offline; the admission becomes reachable only
when the Owner decides and the stack is rebuilt. Until then the deployed
behaviour is exactly the 2026-11-04 behaviour: `chat.zalo.me` is refused before
any socket.

## 7. Verdict

**Supported (synthetic):** the reviewed policy rejects a legitimate
authentication redirect. The pinned SDK follows it unconditionally; the local
guard refuses it silently before the gateway; the SDK reports exactly
`"Cannot get session, login failed"`; the bootstrap stops before event 4 and
writes no session. This is consistent with every recorded fact of the
2026-11-04 attempt.

**Unproven (live):** the actual provider `302` was not observed. No conclusion
about the provider's redirect target is recorded as fact.

**Not deployed:** admitting `chat.zalo.me:443` is prepared in the repository and
reviewed, but the running stack and the live allowlist are unchanged. The
no-follow polyfill and any live retry also require a separate Owner decision.

**STOP — `G5A_NEXT_BOOTSTRAP_READY_AWAITING_OWNER_START` pending the Owner's
allowlist decision and a new UTC authorization; no G5-A live authorization is
current.**