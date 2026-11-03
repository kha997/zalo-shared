# G5-A bootstrap report — blocked before live authentication

**Verdict:** `G5A_BLOCKED`
**Report date:** 2026-11-03
**Owner authorization:** G5-A only, `2026-11-03T02:00:00.000Z` – `2026-11-03T02:30:00.000Z` (09:00–09:30 Vietnam time)
**Verified baseline:** `f726a780283a3108cbde6b196c32b3fee423bbc1`
**Connector artifact source:** `6d199162e8b00d7b4968b6b1fd82450b4387f4df`
**Connector image:** `zalo-shared-connector:g5-6d199162`, local digest `sha256:6b1f0100017d067f24d18eee53ffbfcffe7562ac3f79fd98283097ef1938d781`

## 1. Outcome

No live action occurred. The connector was not started, no SDK was imported for
authentication, no QR was generated or displayed, no session was written, and no
message was observed or sent.

Mandatory preflight found two blocking conditions before the authorized window
opened:

1. **Host-level controlled egress could not be established or verified.** Windows
   Firewall is enabled on all profiles and default inbound is closed, but the
   WSL2 host has no `iptables`, `nft`, `ufw` or equivalent egress-filtering
   tooling. Default outbound is unrestricted. There is no reviewed, scoped
   allowlist that limits the connector to DNS and provider TLS. Proceeding would
   leave unrestricted outbound access, contrary to the mandatory preflight and
   the G4 isolation assumption.
2. **A local application credential entered the private session transcript.**
   During read-only environment inspection, the G2 application container's
   `DATABASE_URL` (a local `zs_app` database role) was printed unmasked. It is
   not a Zalo credential, UID, QR or session value, and it was not written to the
   repository, GitHub or CI, but it violates the "no live credentials in logs or
   transcripts" preflight requirement. The credential must be rotated before any
   live authentication.

The authorized window was therefore not entered for authentication. This report
is the terminal G5-A outcome for this authorization.

## 2. Preflight results

Checked at `2026-11-03T01:45:01.582Z`, before the authorized start.

| Check | Result | Evidence |
| --- | --- | --- |
| UTC time inside approved window | PASS (preflight only, before start) | `date -u` returned `2026-11-03T01:45:01.582Z`; no live command was run before `02:00:00Z` |
| Source, lockfile and image identity | PASS | Baseline `f726a78`; embedded source `6d19916…`; local lock SHA-256 `17dcd254…` and SDK integrity match the image build identity |
| Approved Windows/WSL host | PASS | Windows 11 Pro build 26100; WSL2 Ubuntu 24.04.4 LTS; kernel `6.6.87.2-microsoft-standard-WSL2` |
| Firewall and localhost-only inbound | PARTIAL | Windows Firewall enabled on Domain/Private/Public; default inbound not configured (block); no inbound allow rules for 5432, 2026, 3100 or 46245. Mirrored WSL networking means the Windows profile applies. LAN isolation was not tested from a second host |
| Controlled egress | **FAIL** | Default outbound not configured (allow); no host firewall tooling in WSL to add a scoped allowlist; unrestricted outbound would remain |
| Private files, key and UID 65532 | PASS | `session.key` 32 bytes, mode 0600, owner 65532; state directories 0700 owner 65532; image runtime UID 65532 |
| Account-specific manifest and consent binding | NOT EXECUTED | Only synthetic G5 manifests exist; a live enrollment manifest was not created because blocking conditions were found first |
| Owner and dedicated phone present | OWNER DECLARED | Owner authorization and direct participation declared; phone presence not independently verified and no QR was produced |
| Exclusive connector ownership | PASS | No connector container; `connector_ownership.phase='idle'`, epoch 0; `provider_state.status='disconnected'` |
| Emergency stop and session revocation ready | READY | Procedure documented; no session exists to revoke |
| Observe/send workers and media disabled | PASS | G2 application runs `PROVIDER_MODE=disabled`, `MOCK_ENABLED=false`; bootstrap constructs no dispatcher; G5 policy refuses media before egress |
| No live credentials/UID/QR/session in logs or artifacts | **FAIL** | Local G2 `DATABASE_URL` app-role credential was printed into this private session transcript; no Zalo credential, UID, QR or session value was involved |

Unrelated host services were observed listening on `0.0.0.0:5432` and `*:2026`.
Windows Firewall default inbound blocking is the only control shown; LAN
reachability from a second host was not verified. This is recorded as a
host-hardening residual, not as pilot-specific exposure: the pilot connector was
never started and publishes no ports.

## 3. Required G5-A outcomes

| Required outcome | Result |
| --- | --- |
| Correct QR enrollment for Zalo A | NOT ATTEMPTED — blocked |
| Exact account UID binding | NOT ATTEMPTED — blocked (no UID exposed) |
| Encrypted session persistence | NOT ATTEMPTED — no session written |
| Official phone remains usable | NOT TESTED — no enrollment occurred |
| Safe connector shutdown | NOT APPLICABLE — connector never started |
| Sanitized evidence and definitive verdict | COMPLETE — this report, `G5A_BLOCKED` |

## 4. Evidence boundary

This report contains **synthetic/offline and host-preflight evidence only**. It
contains no live provider evidence. No Zalo account was authenticated, no phone
coexistence was observed, and no delivery, session renewal or platform behaviour
was exercised. The account alias `Zalo A` is the only account reference; no UID,
phone number, QR, cookie, token, message body or key appears here.

## 5. Residual risks

- The G2 application database role credential exposed in the private transcript
  remains valid until rotated. Risk is limited to a local, unpublished database,
  but the credential must be treated as compromised.
- Host outbound traffic remains unrestricted by default. A future live stage
  must not start until a reviewed egress allowlist is enforced and verified.
- LAN inbound isolation for the unrelated `0.0.0.0` listeners was not
  independently tested from a second host.
- No live Zalo behaviour has been proven; provider authentication, QR
  interoperability, phone coexistence, delivery and account risk remain
  **UNPROVEN**.

## 6. Remediation required before a new G5-A authorization

1. Rotate the local `zs_app` database role password, update the private
   environment and the G2 application, and confirm the old credential no longer
   works. Treat any transcript or log containing it as compromised private data.
2. Establish and verify a scoped host egress policy for the pilot: only DNS and
   the provider's required TLS endpoints, with all other outbound traffic
   dropped. Use reviewed tooling and record the exact rules; do not rely on an
   undocumented host condition.
3. Verify LAN inbound isolation from a second host, not only from localhost, for
   any listening service on the pilot host.
4. Create the live enrollment manifest and consent binding for the exact
   authorized window and run the offline `preflight` for the `bootstrap` stage.
5. Request a new explicit G5-A authorization with a fresh UTC window. This
   authorization cannot be reused.

## 7. Next-stage recommendation

Do not proceed to G5-B. The requested state after this report is
`G5B_AWAITING_SEPARATE_OWNER_AUTHORIZATION`, but G5-B is **not authorized** and
must not start from a blocked G5-A. A new G5-A authorization is required after
the remediation above.

**STOP — `G5A_BLOCKED`. No live authentication, observation, sending, media,
production deployment or PR merge is authorized.**
