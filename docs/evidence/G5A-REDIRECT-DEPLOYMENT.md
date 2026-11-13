# G5-A redirect deployment and offline acceptance

Deployed 2026-11-06T23:10Z on the dedicated local pilot host under the Owner's
"G5-A redirect deployment authorization": reviewed redirect deployment and
offline verification **only**, with no real Zalo authentication. No QR, login,
observe, send-test, media operation, provider probe, production deployment or
PR merge occurred.

## 1. What changed on the host

| Item | Before | After |
|---|---|---|
| Reviewed allowlist (`PILOT_EGRESS_HOSTS`) | `id.zalo.me`, `wpa.chat.zalo.me`, `jr.chat.zalo.me` | the same three plus `chat.zalo.me`, classified `redirect-target` (bootstrap only, port 443, one hop) |
| Gateway `GATEWAY_ALLOW_HOSTS` | three hosts | the same four hosts |
| Connector `extra_hosts` pins | three names → `172.16.29.10` | four names → `172.16.29.10` |
| `PILOT_DIAGNOSTIC_FILE` | absent | `/run/pilot/state/diagnostic.jsonl` |
| Connector image | `zalo-shared-connector:g5-local` | `zalo-shared-connector:g5-ready-6d9c0e9` |
| Private compose copy | older three-host rendering | byte-identical to `ops/pilot-compose.example.yml` |
| Global firewall, pilot database, application stack | unchanged | unchanged |

The private compose copy (`~/pilot-private/zalo-shared/topology/pilot-compose.yml`,
mode `0600`) and the reviewed example both hash to
`79845c33b65fd669355a7bb424a156015d50a702da44682f02df596ddd956c6b`.
The previous copy and interpolation file are retained beside them as
`*.pre-g5a-redirect.20261107.*` (private, never committed).

Deployment used `ops/local/deploy-pilot-topology.sh`, which rewrote the private
compose copy and interpolation file, recreated only the egress-gateway
container, and required the gateway to become healthy before proceeding. The
connector is created on demand by `docker compose run`; none is running now.

## 2. Artifact identity

| Value | Observed |
|---|---|
| Connector tag | `zalo-shared-connector:g5-ready-6d9c0e9` |
| Connector digest | `sha256:97513c22ac749982bdda8dd44137bb3f99adaf0eb40e2924547e248715168c84` |
| Embedded `sourceCommit` | `6d9c0e9ad839bf2e26000ac0faae7ec50d1a9609` |
| Embedded `lockSha256` | `17dcd25426639f7112b80764bc8aa27f9be2af3acf0aaf0f2cd490c434030c9b` (equals `sha256sum connector/package-lock.json`) |
| Embedded `sdkIntegrity` | `sha512-pBU0T0/uadH3Neq7yMssUmE769VVuqKhL8YD1HqQQG8e6lkwueAopNu0vhJdqiJRHZdPIEomT2FxRzauOx4pgA==` (equals the lock's `zca-js` integrity) |
| Installed SDK | `zca-js@2.2.0` |
| Image user / runtime | `65532:65532`, Node `v24.22.1` |
| Gateway tag / digest | `zalo-shared-egress-gateway:g5-local` / `sha256:bfde5c7a96ca7155473ee305a96b51b05eb3d7ac680c27ba37250fdc85ad4e75` |

The gateway image carries no embedded source commit. Its three files were
compared byte-for-byte against the repository and match:

- `ops/egress-gateway.cjs` → `640b00f355c37512be7f260c760827e8eb6b209a05c70dbd329f2e639dc61b1e`
- `ops/egress-address-policy.cjs` → `dbc3fe7fd01c053ac48571ca129075fe14bb9b046c9f40b6b9c86aaa1d7c2080`
- `node_modules/ipaddr.js/package.json` → `a124e0548d4c1f9e2c694807947ef527fa7f7f3012474d54c1df3cc21a5ddb9c`

`git diff 6d9c0e9..HEAD` over `adapters/`, `connector/`, `ops/`, `server/`,
`tools/`, `tests/`, `tsconfig.connector.json` and `connector/package-lock.json`
is empty; every commit after `6d9c0e9` changes documentation only (the checked-out
`HEAD` during deployment was `da7ce82`).

## 3. Network verification on the deployed topology

| Check | Result |
|---|---|
| `ops/local/check-pilot-network.sh` | all assertions PASS: 4 admitted hosts, redirect policy names the same hop, no published ports, connector only on internal networks, gateway the only uplink member, exact pins, no pending/excluded host admitted, both workloads hardened, gateway forwarding disabled |
| `ops/local/verify-deployed-pilot.sh` (reviewed image) | **48/48 PASS**: rendered config, kernel-only boundary (no IPv4/IPv6 default route, direct IPv4/IPv6, host bridge ports 2026/5432/8080 and UDP refused, unpinned names unresolved), image guard (direct IP, IPv6, unpinned DNS, UDP refused; pinned path reaches the gateway without blind forwarding), empty policy denies all, stopped gateway closes the path, uplink-attached connector refuses to start, gateway denies an unapproved SNI and admitted no tunnel |
| `ops/local/verify-egress-allowpath.sh` | **21/21 PASS**: real TLS through the real gateway code to a synthetic provider in a loopback-only namespace, certificate fingerprint intact, denied SNI refused and logged, guard pin absent/mismatch and off-list name refused |
| `ops/local/verify-connector-db-path.sh` | PASS: `sslmode=verify-full` admitted over `TLSv1.3 / TLS_AES_256_GCM_SHA384` as `zs_app`; a non-loopback URL without `sslmode` refused before a socket |
| Deployed gateway | `healthy`, no published port, `net.ipv4.ip_forward=0`, egress `internal=true` (`172.16.29.0/24`), uplink non-internal with the gateway as its only member |
| Gateway audit after deployment | `sni_allow` = 0, `sni_deny` = 2 (the negative probes above); no admitted tunnel, therefore no provider contact |

## 4. Redirect policy acceptance inside the deployed image

The compiled policy in the reviewed image
(`/app/dist/connector/adapters/zalo/redirect-policy.js`) was exercised with a
stub transport, `--network none`, and a trap on `globalThis.fetch` that throws
if the policy ever falls back to it. **33/33 PASS**, including:

- the exact `checkSession` request → 302 to `https://chat.zalo.me/index.html` →
  200 is admitted, with every recorded request forced to `redirect: "manual"`;
- the caller's `init` object is not mutated and its headers survive;
- a 3xx from any non-`checkSession` request is refused before the hop is fetched;
- `checkSession` redirects to an unreviewed host, a sibling subdomain, a
  trailing-dot host, userinfo, a non-443 port, plain `http`, a relative
  Location, a backslash-smuggled value, a control character or an empty
  Location are all refused;
- a direct request to the redirect host is refused without reaching the
  transport, in three target forms;
- a second redirect hop is refused; a stale hop cannot be reused after a direct
  request; the hop is refused when the runtime allowlist omits the redirect host;
- direct IP literals, plain `http`, non-443 ports, off-allowlist hosts and
  non-string targets are refused;
- the refusal is `TypeError("fetch failed")` with `cause.code =
  PILOT_REDIRECT_DENIED` and no URL echo, and `denied` is non-enumerable.

## 5. Offline acceptance with the deployed configuration

A synthetic bootstrap manifest bound to the deployed image's source commit was
generated outside the repository (`0600`, uid 65532) and used only for these
runs. It contains no real account, peer, key or session material.

| Run | Observed |
|---|---|
| `dry-run` through the deployed compose file | exit 0, `{"ok":true,"gate":"admitted","purpose":"enroll-session"}` |
| `preflight` | exit 0, `{"ok":true,"gate":"admitted","accountBound":false,"peerCount":0,"maxPartsPerDay":10,"minIntervalMs":2000,"lifetimeMs":3600000}` — the embedded build identity matched the manifest, which dry-run alone does not check |
| `bootstrap` with a deliberately missing private key | exit 1, `{"ok":false,"gate":"unavailable","reason":"input-invalid"}`; it failed **after** the scope and build-identity gates but **before** ownership, QR generation, SDK import or any socket |

The preflight output reflects a synthetic 60-minute fixture and is **not** an
Owner authorization. After observation the previous (expired) synthetic
manifest was restored, so no fresh grant-shaped artifact remains.

The synthetic manifest path proves the runtime gates; the QR handoff and the
pre-QR Owner banner cannot be reached without ownership and provider contact,
so they are covered by the real-CLI tests instead (real `PrivateQrFileView` +
real terminal `promptConfirmation`, banner text written after ownership and
before `loginQR`).

### Private diagnostics

The failing bootstrap run wrote:

```
{"at":"…","stage":"start"}
{"at":"…","stage":"failed","reason":"input-invalid"}
```

The file was `0600`, owned by 65532, in the bind-mounted state directory, and
was readable **after the process exited** — closed stage/reason vocabulary only,
no provider text, URL, QR, cookie or credential. It was removed after
observation; the state directory now holds only the empty private QR view.

## 6. Control state after acceptance

Read-only SQL through the local socket, after all runs:

| Item | Value |
|---|---|
| Ownership | `idle`, epoch 2, owner null, fault null |
| Provider state | `disconnected`, `reconciliation_required=false`, gap 2, fault null |
| Audit | 10 rows, exactly one `connector.reconciled` |
| Outbox / delivery parts / part ledger / provider events | 0 / 0 / 0 / 0 |
| Sessions | 0 |
| Users | one admin, no other role |
| Advisory locks | 0 |
| Local session / QR view | no `session.enc`; empty private view |

No connector or worker is running. The negative bootstrap run did not acquire
ownership, so the reconciled epoch was not advanced. At report time the only
pilot containers up are the egress gateway (healthy) and the pilot database; the
two `Created` connector containers never started and hold no process.

## 7. Regression suite

`npm test` on Node 24.19.0 with a disposable database: **377/377 PASS**. One
earlier run reported 376/377 because the egress-guard test binds a hardcoded
`127.0.0.1:45442` and the test database connection left that local port in
`TIME_WAIT` (`EADDRINUSE`); the isolated file re-ran 23/23 and the full suite
re-ran 377/377. This is a test-fixture port collision, not a code or deployment
defect.

## 8. Independent verification

An independent read-only review re-derived the claims below from the repository,
the private configuration, the Docker metadata and the captured run output. It
held no deploy authority and returned PASS on all eight items; the observations
it raised are dispositioned after the table.

| # | Claim | Result | Re-derived evidence |
|---|---|---|---|
| 1 | Artifact identity | PASS | image digest `sha256:97513c22…168c84` matches the deployed tag's repo digest; `/app/build-identity.json` reports source commit `6d9c0e9…9609`; the in-image `package-lock.json` hash equals the reviewed lock |
| 2 | Redirect policy compiled into the image | PASS | `/app/dist/connector/adapters/zalo/redirect-policy.js` present; `REDIRECT_HOST` is `chat.zalo.me`, one hop, `redirect:"manual"` on every request; the allowlist redirect source is the same `checkSession` URL |
| 3 | Deployed allowlist | PASS | gateway `GATEWAY_ALLOW_HOSTS` and connector `PILOT_EGRESS_HOSTS` are exactly the four reviewed names; `PILOT_EGRESS_PORTS=443`, `PILOT_EGRESS_GATEWAY=172.16.29.10`, four identical `extra_hosts` pins |
| 4 | Deployed topology equals the reviewed render | PASS | private compose sha256 `79845c33…956c6b` equals `ops/pilot-compose.example.yml`; `check-pilot-network.sh` all PASS |
| 5 | Kernel-enforced network boundary | PASS | only internal networks; the gateway is the sole uplink member; no published ports; forwarding off; deployed probes 48/48 and loopback allow-path 21/21 |
| 6 | No provider contact during acceptance | PASS | gateway counters recorded `sni_allow=0`; dry-run and preflight opened no socket; the negative bootstrap stopped at `input-invalid` before ownership, QR or SDK import |
| 7 | Control state preserved | PASS | ownership `idle`/epoch 2, provider `disconnected`/`reconciliation_required=false`/gap 2, one `connector.reconciled` audit row, zero outbox, parts, ledger, provider events and sessions, no `session.enc`, empty private view |
| 8 | Private diagnostics | PASS | file `0600`, uid 65532, `O_NOFOLLOW`, closed stage/reason vocabulary only, readable after exit, removed afterwards; sink directory now holds only the empty private QR view |

Reviewer observations and dispositions:

1. **Gateway image has no embedded commit (their residual 1).** Accepted and
   recorded as risk 3: the image is unsigned and local, so its provenance is the
   three-file hash comparison against the repository in §2, not a CI attestation.
   It carries no SDK, application or credential, so the blast radius of a wrong
   gateway byte set is the SNI allowlist itself, which is read from the reviewed
   render at start.
2. **Ephemeral `172.16.29.2` at 23:09:58Z (their residual 2).** This is the
   one-off container created by the acceptance `docker compose run` issued from
   the deployed compose file about twenty seconds after it was written; `--rm`
   removed it on exit, and the daemon's event log did not retain that window, so
   the attachment cannot be replayed. The deciding control is independent of the
   container's identity: the gateway admitted zero SNI during the entire window,
   so nothing that container could reach left the host.
3. **`g5-synthetic` directory mtime 23:13Z, uid 65532 (their residual 3).**
   Explained by the acceptance run, not by an unknown actor. The directory is
   the container-owned state mount; the negative bootstrap created
   `diagnostic-acceptance.jsonl` there as uid 65532 and the harness removed it
   after reading it, which updates the directory mtime. The synthetic bootstrap
   manifest was regenerated for that run and then restored; it is now
   byte-identical to `manifest.bootstrap.pre-acceptance.json`
   (`diff` exit 0), so no fresh grant-shaped artifact remains.
4. **Container-wide, stage-blind admission (their residual 4).** The
   Owner-accepted pilot-only residual, risk 2. Unchanged by this report.
5. **`followableLocation` constrains host but not path (their residual 5).**
   Accepted for this pilot and recorded as risk 5: the policy pins scheme, host,
   port and hop count to one, but a single redirect may target any path on
   `chat.zalo.me`. The affected party is Zalo's own host, not an arbitrary one.
6. **Leftover never-started containers (their residual 6).** Two `Created`
   containers on the old tag `g5-ready-59d4dc5` and two on `g2-adf8ceca9bd6`.
   Their status is `Created`, so no process ran; they hold no credential, no
   session and no runtime network connection. They were left in place because
   container removal was outside the authorized scope; recorded as risk 6.

## 9. Residual risks

1. **The live redirect remains UNPROVEN.** No provider contact was authorized,
   so the admission is still conditional on the first authorized bootstrap
   observing the `checkSession` → `chat.zalo.me` hop.
2. **The admission is container-wide and stage-blind.** Once deployed,
   `PILOT_EGRESS_HOSTS`, the pins and the gateway admit `chat.zalo.me:443` for
   the whole connector process, not only during bootstrap; only the bootstrap
   path installs the one-hop fetch policy. This is the Owner-accepted pilot-only
   residual, not a production guarantee.
3. **Gateway provenance is local.** The unsigned local gateway image has no
   embedded commit; its bytes were compared with the repository instead of being
   attested by CI.
4. **Synthetic fixtures are not authorizations.** The preflight summary above
   describes a synthetic fixture; it cannot authorize a bootstrap.
5. **The followed hop is host-pinned, not path-pinned.** A single admitted
   redirect may target any path on `chat.zalo.me`, not only `/index.html`. The
   hop stays on Zalo's own host, but the request path is not constrained.
6. **Stale never-started containers remain.** Two `Created` containers on
   `g5-ready-59d4dc5` and two on `g2-adf8ceca9bd6`; never started, no credential
   or runtime connection, removed later as hygiene rather than during this
   authorized window.
7. **No activation exists.** PR #3 stays draft; no production deployment, merge,
   observe/send-test or media action was performed.

## 10. Gate

Deployment and offline verification are complete; the environment is ready for
a future authorized bootstrap, and nothing else.

**STOP — `G5A_REDIRECT_DEPLOYED_AWAITING_OWNER_START`.** Technical PASS neither
authorizes a bootstrap nor proves the live redirect. A new explicit UTC Owner
window is required before any QR, login or provider contact, and no control
state is reset in the meantime.
