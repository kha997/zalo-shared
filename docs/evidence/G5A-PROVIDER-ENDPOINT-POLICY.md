# G5-A provider endpoint policy

**Date:** 2026-11-03
**Scope:** offline reconstruction of every provider destination the pinned SDK can
reach, and the admission policy that replaces an exhaustive inventory.
**Live traffic used:** none. No DNS query, TLS connection or HTTP request was
made to any provider host in producing this document.

## 1. Result in one paragraph

The pinned SDK contains exactly nine hostnames. Three are confirmed static
request targets on the connector's path and are admitted by exact name.
Six appear only as cookie domains, header values, form fields, comments, a
disabled update check, or a regex-escaped string that is never dialled, and are
excluded. Three destination classes cannot be known from reviewed artifacts at
all: the post-login service map, the WebSocket URLs it carries, and redirect
targets chosen by the provider at runtime. The network boundary therefore does
not depend on knowing them in advance: the connector has no route to the
internet, and the egress gateway admits an exact allowlisted name and nothing
else. Any unknown destination fails closed and its name is recorded in the
gateway audit log, so a future authorized observation window can admit it by
evidence instead of guesswork.

## 2. Artifact identity

| Item | Value |
| --- | --- |
| SDK | `zca-js@2.2.0` |
| Integrity (connector lock) | `sha512-pBU0T0/uadH3Neq7yMssUmE769VVuqKhL8YD1HqQQG8e6lkwueAopNu0vhJdqiJRHZdPIEomT2FxRzauOx4pgA==` |
| Lock file | `connector/package-lock.json` |
| Artifact scanned | `node_modules/zca-js/dist` (567 files, shipped JavaScript and declarations) |
| Connector SDK surface | `getCookie`, `getOwnId`, `listener`, `login`, `loginQR`, `sendMessage` (`adapters/zalo/sdk-facade.ts`) |

The scan covered the complete `dist` tree, not only the imported files, so a
hostname reached through an internal helper is still in the inventory.

## 3. Method

```bash
grep -rhoE 'https?://[a-zA-Z0-9._-]+' node_modules/zca-js/dist | sed -E 's#https?://##' | sort | uniq -c
grep -rhoE '[a-zA-Z0-9.-]+\.(com|net|org|vn|me|io|dev|cloud|app|co)\b' node_modules/zca-js/dist | sort | uniq -c
grep -rn 'zdn\|zadn' node_modules/zca-js/dist
```

All three patterns were needed. The first finds URL literals. The second finds
hostnames written as cookie domains, header values and form fields that never
appear inside a URL literal. The third finds regex-escaped hostnames, which
contain backslashes and so match neither of the first two;
`stc-zlogin.zdn.vn` was found only this way. The scan was not restricted to
`.zalo.me`: it admits any TLD and any label count.

Every hit was then read in context and assigned to one of: confirmed static
request target on the connector path, configuration-only reference, or
runtime-provided destination. A hostname was never admitted because it looked
plausible; each admitted entry cites the call site that issues the request.

## 4. Complete hostname inventory

### 4.1 Admitted — confirmed static, exact name, port 443

| Host | Stage(s) | Call site (zca-js@2.2.0) |
| --- | --- | --- |
| `id.zalo.me` | bootstrap, all live stages | `dist/apis/loginQR.js:16` (`/account`), `:44` (`/account/logininfo`), `:70` (`/account/verify-client`), `:95` (`/account/authen/qr/generate`), `:124` (`/account/authen/qr/waiting-scan`), `:163` (`/account/authen/qr/waiting-confirm`), `:195` (`/account/checksession`) |
| `wpa.chat.zalo.me` | all live stages | `dist/apis/login.js:6` (`/api/login/getLoginInfo`), `:25` (`/api/login/getServerInfo`) — the stored-credential login performed once per process |
| `jr.chat.zalo.me` | bootstrap, all live stages | `dist/apis/loginQR.js:215` (`/jr/userinfo`), the account-identity check |

QR enrollment uses `loginQR` and `getOwnId` only
(`adapters/zalo/qr-bootstrap.ts:328,331,349`). Inside `loginQR` the SDK calls
`loadLoginPage`, `getLoginInfo`, `verifyClient`, `generate`, `waitingScan`,
`waitingConfirm` and `checkSession` on `id.zalo.me`, then `getUserInfo` on
`jr.chat.zalo.me` (`dist/apis/loginQR.js:16,44,70,95,124,163,195,215`). On
success it calls `loginCookie` (`dist/zalo.js:99`), which performs
`getLoginInfo` and `getServerInfo` on `wpa.chat.zalo.me`
(`dist/zalo.js:50-53` → `dist/apis/login.js:6,25`). So the QR path itself needs
all three admitted names; `wpa.chat.zalo.me` is also the stored-credential
login the facade performs at every live start
(`adapters/zalo/sdk-facade.ts:168`). No listener and no send is reachable on the
bootstrap path.

### 4.2 Pending — cannot be reconstructed offline

| Class | Why it cannot be known | Where it enters | Stages |
| --- | --- | --- | --- |
| `dynamic-service-map` | Base URLs for every post-login API come from `loginInfo.zpw_service_map_v3`, which is provider-controlled and exists only in the login response (`dist/zalo.js:72`). | `sendMessage.js:60,63` use `chat[0]` and `group[0]`; `:68,69` use `file[0]`. The connector path needs only the `chat`, `group` and `file` keys. | observe, send-test |
| `websocket` | The listener connects to `zpw_ws[]` from the same response. No WebSocket hostname appears anywhere in the artifacts. | `dist/zalo.js:72` → `dist/apis.js:160` (`new Listener(ctx, wsUrls)`) → `dist/apis/listen.js:27` (`urls[0]`), `:84-96` (rotation on provider close codes) | observe |
| `redirect-target` | Any response may carry `Location`, and `dist/utils.js:290-298` follows it with `request(ctx, redirectURL, ...)`. The destination is chosen by the provider at runtime. | every request path | bootstrap, observe, send-test |

Both pending classes are refused by two independent layers:

- **Network:** the connector is attached only to `internal=true` Docker networks.
  An unpinned name has no resolver and no route, so the connection never leaves
  the namespace. This is enforced by the kernel and does not depend on SDK code.
- **Gateway:** a name that reaches the gateway but is not an exact allowlisted
  SNI is refused before any upstream lookup, and the name is written to the audit
  log. A redirect to plain HTTP also fails: the gateway is not a TLS party for
  non-TLS bytes, and only port 443 is reachable.

### 4.3 Excluded — present in the artifacts, never a request target

| Host | Evidence | Disposition |
| --- | --- | --- |
| `chat.zalo.me` | Cookie domain (`dist/zalo.js:25`, `dist/apis/listen.js:40`), `Origin`/`Referer` values (`dist/utils.js:231,242,243`), and a `continue` form value (`dist/apis/loginQR.js:122,160`) | Not a request target. Not admitted. |
| `zalo.me` | `continue` form value (`dist/apis/loginQR.js:42,68,93`) and cookie-domain comparison | Not a request target. Not admitted. |
| `registry.npmjs.org` | `dist/update.js:4`, reached from `dist/zalo.js:51` `checkUpdate`; `dist/update.js:7` returns immediately when `checkUpdate` is falsy, and `adapters/zalo/sdk-facade.ts:6,166` pins `checkUpdate: false` | Disabled on this path. Not admitted; the gateway would refuse it if it were ever reached. |
| `catalog.zalo.me` | TypeScript declaration comments only | No runtime reference. Not admitted. |
| `developers.zalo.me` | JSDoc comment in `dist/models/Bank.js:3` | No runtime reference. Not admitted. |
| `stc-zlogin.zdn.vn` | Regex-escaped literal in `dist/apis/loginQR.js:36` (and the CJS build), used only to extract a version number from the `id.zalo.me` login page HTML: `html.match(regex)`. It is never passed to `request`, `fetch`, `tls.connect` or `dns` | Not a request target. Not admitted; the extracted value is used as the `v` form field sent to `id.zalo.me/account/logininfo`. |

## 5. Admission policy

`ops/pilot-egress-allowlist.json` is the single reviewed source of truth.
`ops/local/check-pilot-network.sh` fails if the connector's
`PILOT_EGRESS_HOSTS`, its `extra_hosts` pins, the gateway's
`GATEWAY_ALLOW_HOSTS` and the gateway address ever disagree with it.

Rules:

1. Admission is by exact DNS name and exact port. No wildcard, suffix or IP
   literal is admissible; the gateway rejects an IP literal at startup.
2. A host moves from `pending` to `admitted` only with a documented call site or
   an observed name from an authorized window, a re-run of the checker and a
   fresh review. The name then appears in three places through the same file.
3. An empty allowlist is valid configuration and denies everything. The gateway
   starts and logs `startup_warning`; it does not fall back to open.
4. Every decision, allow and deny, is one JSON audit line. During a future
   authorized observation window the deny lines are the discovery record: a host
   that is pinned but not admitted is refused and named, so the inventory grows
   from evidence with no traffic reaching the destination.
5. TLS is never intercepted. The gateway routes on the ClientHello SNI and
   splices opaque bytes, so the connector still validates the provider
   certificate end to end and the gateway never holds a session key, cookie or
   message body.

## 6. What this means for each stage

| Stage | Endpoint coverage | Consequence |
| --- | --- | --- |
| Bootstrap / QR enrollment | Complete for direct call sites: `id.zalo.me`, `jr.chat.zalo.me`, `wpa.chat.zalo.me` | Can proceed under a new Owner authorization without an observation window. A provider-chosen `Location` redirect is still `pending`: it is not followed unless its host is admitted, so an unexpected redirect aborts the bootstrap safely. |
| Observe | Not complete: needs the service-map and WebSocket hosts | Fails closed until those names are admitted. Requires a narrow, separately authorized observation window. |
| Send-test | Not complete: needs the `chat`/`group`/`file` service-map hosts | Same as observe. |

This is the intended fail-closed behaviour, not a defect. The pilot can enroll
and prove identity under the current policy; it deliberately cannot start a
listener or send until the runtime-only hosts have been observed and admitted.

## 7. Residual risk and Owner action

- **Unknown destinations are unreachable and unlisted.** That is the security
  property, and it is also the functional limit: observe and send-test cannot
  run before admission. Resolving it needs an Owner decision between a
  time-bounded observation window (traffic to admitted bootstrap hosts only,
  gateway audit log retained) and deferring observe/send-test indefinitely.
- **The audit log is the only discovery instrument.** Its integrity is process
  stdout captured by Docker; it is not signed. It is evidence, not enforcement.
- **The allowlist is a reviewed file, not a signed policy.** A change is visible
  in git review, and the checker fails on drift, but a party who can edit the
  file and redeploy can widen admission. That is the same trust level as the
  rest of the deployment configuration.

## 8. Invariants observed

In producing **this document** and the allowlist it describes: no live Zalo
login, QR enrollment, SDK authentication, listener, send, provider DNS query or
provider connection was performed. No hostname was invented; every line
reference above was verified against the pinned artifact during this review.

This statement does not cover the rest of the G5-A session. An earlier
unauthorised diagnostic probe contacted `id.zalo.me` and
`wss://jr.chat.zalo.me/ws` without credentials or a session. It is disclosed in
[G5A-BOUNDARY-PROBE-INCIDENT.md](G5A-BOUNDARY-PROBE-INCIDENT.md). Both names are
among the three admitted here, but the probe itself was outside this directive
and is not treated as evidence for this inventory.
