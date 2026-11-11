# G5 live pilot procedure — activation pending

**Status:** `G5A_RECONCILED_AWAITING_NEW_START_AUTHORIZATION` — the 2026-11-06 single authorized bootstrap ended `FAIL (qr-expired)` after the QR's 100-second lifetime; no session was stored and the gateway allowed only `id.zalo.me`. The fenced incident was reconciled in the Owner window `23:52–00:12Z` (epoch 3→4, gap 3→4, `idle`, `reconciliation_required=false`), so the environment is ready for a new authorization only. The authoritative state is [PILOT-GATE-STATUS.md](../../PILOT-GATE-STATUS.md); the attempt and reconciliation are in [G5A-BOOTSTRAP-REPORT.md](../evidence/G5A-BOOTSTRAP-REPORT.md) §11 and [G5A-RECONCILIATION-EXECUTION-2026-11-06.md](../evidence/G5A-RECONCILIATION-EXECUTION-2026-11-06.md); the deployment evidence is [G5A-REDIRECT-DEPLOYMENT.md](../evidence/G5A-REDIRECT-DEPLOYMENT.md).
**Decision record:** [G5-SCOPE-APPROVAL.md](../evidence/G5-SCOPE-APPROVAL.md)
**Readiness report:** [G5A-ACTIVATION-READINESS.md](../evidence/G5A-ACTIVATION-READINESS.md)

No step in this document authorizes a live action by itself. The Owner must name the exact stage, UTC start and automatic expiry in a separate explicit command. Stop at the end of each stage and wait for the next authorization.

## Deployed environment (2026-11-03)

The deployment blockers recorded in [G5A-BOOTSTRAP-REPORT.md](../evidence/G5A-BOOTSTRAP-REPORT.md) are resolved on the private host:

- the pilot database is the dedicated `pilot-postgres` container reached with `sslmode=verify-full` over the internal `zalo-shared-pilot-db` network, with the private CA supplied through a read-only `NODE_EXTRA_CA_CERTS` mount ([G5A-DB-TLS-VERIFICATION.md](../evidence/G5A-DB-TLS-VERIFICATION.md));
- the reviewed internal-network and TLS-SNI gateway topology is deployed and verified in place ([G5A-DEPLOYED-NETWORK-VERIFICATION.md](../evidence/G5A-DEPLOYED-NETWORK-VERIFICATION.md));
- the enrollment template is bound to the reviewed image's build identity and the synthetic admission/denial suite passes ([G5A-ENROLLMENT-PREFLIGHT.md](../evidence/G5A-ENROLLMENT-PREFLIGHT.md));
- the deployed stack passed the full synthetic dry run ([G5A-LOCAL-END-TO-END-DRYRUN.md](../evidence/G5A-LOCAL-END-TO-END-DRYRUN.md)).

A new Owner authorization is still required; the deployment readiness above is not an authorization.

## Common preconditions for every stage

1. The Owner has confirmed the dedicated account alias, the single consenting peer alias, the private host and the exact UTC window.
2. The private consent record is complete and referenced by `consentRef`; the manifest uses aliases only in repository material.
3. The reviewed connector image is the one recorded in the readiness report; the source commit, connector lock and SDK integrity match the embedded build identity.
4. Export `PILOT_DB_NETWORK` to the network the connector will join; it must be `internal=true`. `ops/local/preflight-connector.sh IMAGE STAGE` refuses when the variable is unset, when the network does not exist, or when Docker reports `Internal=false`. When those preconditions pass it returns `"ok":true` and `"gate":"admitted"` for the exact stage manifest with no network namespace, and its purpose matches the stage. Preflight checks scope **and** that the manifest build block matches the image's embedded identity; the live command repeats the identity check.
5. The connector's private env sets `PILOT_EGRESS_HOSTS` to the exact reviewed provider hostnames and optionally `PILOT_EGRESS_PORTS` (default 443). An empty or missing list denies all provider egress. No wildcard, IP literal or proxy is permitted. **Deployed 2026-11-11:** the reviewed two-hop policy is now deployed to the private G5-A pilot as `zalo-shared-connector:g5-ci-d6f8aec` under the Owner authorization `DEPLOY TWO-HOP FIX & FINAL QR VIEWER ACCEPTANCE`. The four-host allowlist is `id.zalo.me`, `wpa.chat.zalo.me`, `jr.chat.zalo.me`, `jr.zaloapp.com`; `chat.zalo.me` is not admitted. The policy admits exactly the observed chain `id.zalo.me -> jr.zaloapp.com -> jr.chat.zalo.me`: hop 1 only from the exact `checkSession` response, hop 2 only from the authorized hop-1 response, single use and chain-bound, any third redirect refused, manual redirects only, TLS verification and the `172.16.29.10:443` gateway pin unchanged. The connector container was not launched. See [G5A-TWO-HOP-DEPLOYMENT-2026-11-11.md](../evidence/G5A-TWO-HOP-DEPLOYMENT-2026-11-11.md). An observe or send-test run additionally requires its runtime-only service and WebSocket hosts to be admitted first, so it fails closed until then.
6. The connector has exclusive ownership; no second connector process or stale container is running.
7. The official phone is available, unlocked and held by the Owner; no screenshot, screen share, chat upload or cloud sync of the QR is permitted.
8. The stage-specific grant is fresh and purpose-matching. Set `expiresAt` to the Owner's named automatic expiry, no later than the end of the authorized window: enrollment ≤1 hour; observe/send-test ≤2 hours. The grant expiry is the absolute bound even if the process restarts.
9. The emergency stop path is open: the Owner can terminate the container and revoke the session from the phone.

## Stage G5-A — bootstrap (QR enrollment only)

**Pre-authorized action:** none yet. Wait for `G5A_START_AUTHORIZED` from the Owner with the UTC start and expiry.

1. Generate the enrollment manifest from [pilot-manifest.enroll.template.json](pilot-manifest.enroll.template.json) on the private host. Use a null `expectedAccountId`, zero peers, purpose `enroll-session`, `maxPartsPerDay: 10`, `minIntervalMs: 2000` and an expiry ≤1 hour.
2. Run `preflight` for `bootstrap`; confirm admitted and the summary shows `accountBound:false`, `peerCount:0`, `maxPartsPerDay:10`, `minIntervalMs:2000`, `lifetimeMs` ≤3600000.
3. Start `bootstrap --acknowledge-pilot-risk` once. `PILOT_DIAGNOSTIC_FILE` is set by the compose file to `/run/pilot/state/diagnostic.jsonl`, inside the private state mount; keep it there so the sanitized evidence survives container exit. Also redirect the container console to a `0600` private file outside the repository. The diagnostic sink records only reviewed stages and reason codes; the console can contain the UID prompt, so neither file is ever committed, pasted or uploaded. Before the QR appears, the connector prints fixed instructions on stderr: where the file is, that the phone scan and the terminal `confirm` are separate steps, and that anything other than `confirm` cancels.
4. The connector writes `qr.png` 0600 in a 0700 local view directory and starts the Windows viewer through `ops/local/launch-qr-viewer.sh` with one attempt id (`--attempt`). One live attempt gets one window: a second launch that carries the same attempt id returns without opening anything (`already showing its QR; no second window`), and repeated file notifications or polling never open another. When the connector rewrites its QR during the same attempt, the viewer validates and decodes the new bytes before swapping them into the existing window in place (`viewer-refreshed`), so a refresh never opens a second window. A new attempt carries a new id; the launcher hands ownership over, waits for the old viewer to close (`viewer-close superseded`) before the new QR is staged, and only then shows its own window. The viewer stages its own 0600 copy in `C:\Users\Admin\pilot-private-qr` and clears the copy on every close path. The Owner scans with the official phone, then types the literal word `confirm` at the terminal prompt for the displayed account UID/name. The phone confirmation and the terminal answer are two separate steps; any answer other than `confirm` cancels.
5. The staged copy is removed on successful completion, authentication failure, redirect denial, source clearing, display timeout, a forced viewer kill and the reviewed emergency stop. A hidden termination guard (`ops/local/qr-viewer-guard.ps1`) is started before anything is staged and removes the copy after the viewer exits; the viewer refuses to stage at all (`viewer-refused guard-unavailable`, exit 5) when the guard does not report ready. The viewer and the guard share one exclusive state lock (`qr-viewer-state.lock`): the guard re-reads the run id and deletes inside it, and the viewer writes its run id inside it before staging, so the guard's delete is ordered before that claim (nothing to delete) or after it (ownership changed) and a newer run's copy is never removed. The launcher sweeps a stale `qr.png` left by a run whose viewer and guard were both killed (logoff, power loss) before starting a new one, so the Owner never has to find or delete a QR file. A failure to confirm removal is logged as `cleanup=FAILED` and exits non-zero instead of reporting a clean close. The residual limits are disclosed in the deployment evidence: a double kill (viewer and guard together) is covered only by the next-start sweep, and the owner handover relies on the old viewer's one-second tick.
6. Confirm the encrypted session file exists 0600 and no token, cookie or session value appears in output or logs.
7. Read the diagnostic file: the last stage plus the CLI `reason` field attributes a failure to a reviewed gate. `redirect-denied` means the fetch policy refused a redirect; `login-session-unconfirmed` means `checkSession` returned no session without a refused hop; `login-failed` is an unattributed provider failure. A failure keeps `connector_ownership` in `uncertain` and raises reconciliation; do not reset it and do not retry.
8. Stop after enrollment. Do not start observe in the same authorization.

**Evidence to record:** enrollment grant expiry, UTC start/end, preflight output, QR file mode/ownership and clear time, UID confirmation outcome (yes/no), session file mode, phone coexistence observation, errors and the stage token.

**PASS token:** `G5A_BOOTSTRAP_VERIFIED`. A failed or uncertain enrollment is `FAIL` or `UNPROVEN`; do not retry automatically.

## Stage G5-B — observe

**Pre-authorized action:** none. Requires a separate `G5B_START_AUTHORIZED` after G5-A PASS.

1. Generate the observe manifest from [pilot-manifest.template.json](pilot-manifest.template.json) with the exact account UID and exactly one peer UID. Expiry ≤2 hours and ≤ the Owner window.
2. Run `preflight` for `observe`; confirm `accountBound:true`, `peerCount:1`, `maxPartsPerDay:10`, `minIntervalMs:2000` and `lifetimeMs` ≤7200000.
3. Start `run-observe --acknowledge-pilot-risk` once. No dispatcher is constructed.
4. The runtime stops at grant expiry, the 2-hour runtime cap (`session-limit`), a connection fault (`connection-lost`, non-zero exit), lost ownership or an operator abort.
5. Do not send from another device or introduce a second peer. Record inbound counts and any rejected inbound events; never store message bodies in evidence.

**Evidence to record:** UTC start/end and stop reason, tick count, accepted/rejected inbound counts by category (no bodies), connection events, phone coexistence, ownership, errors and the stage token.

**PASS token:** `G5B_OBSERVE_VERIFIED`.

## Stage G5-C — send-test

**Pre-authorized action:** none. Requires a separate `G5C_START_AUTHORIZED` after G5-B PASS.

1. Generate the send-test manifest from [pilot-manifest.send-test.template.json](pilot-manifest.send-test.template.json) with the same exact account and single peer. Expiry ≤2 hours and ≤ the Owner window.
2. Run `preflight` for `send-test`; same G5 bounds as observe.
3. Start `run-send-test --acknowledge-pilot-risk` once. Only text to the allowlisted direct peer is permitted; attachments are refused before reservation and egress.
4. Respect the durable 10-part/UTC-day and 10-part/grant budget and the ≥2 s interval. Never resend an unknown result; stop the session and follow the unknown-work procedure.
5. End at 10 parts for the grant, any daily limit, grant expiry, the 2-hour runtime cap, a safety halt or the Owner stop command.

**Evidence to record:** UTC start/end and stop reason, planned versus observed parts, provider IDs (aliases/redacted), accepted/failed/unknown counts, interval observations, the single recipient check, text-only check, phone coexistence, errors and the stage token.

**PASS token:** `G5C_SEND_VERIFIED`.

## Stop and revoke

1. Send `SIGTERM` to the connector container/process once; wait for exit. Do not restart, reconnect or start a replacement connector.
2. Verify ownership is released/quarantined and the process is gone. A database lock cannot cancel an in-flight provider call; treat unverified termination as unknown.
3. Revoke the provider session from the official phone (log out the pilot device/session). The connector performs one stored-credential login per process; there is no QR/password re-enrollment, retry loop or automatic replacement login. The connector itself has no logout capability: a shutdown fences the local ownership/provider rows only and never ends a provider session.
4. Stop the application worker if it could claim pilot work. Preserve the database and sanitized logs.
5. If the pilot is ending, follow [PILOT-TEARDOWN.md](PILOT-TEARDOWN.md) for D7 deletion, inventory and backup disclosure.

## Reconciliation after a fenced bootstrap

A bootstrap that fails after acquisition leaves `connector_ownership.phase='uncertain'` and `provider_state.reconciliation_required=true`. Neither is reset automatically, and no reviewed command clears them:

- re-acquisition reserves only from `phase='idle'`, so the next preflight refuses;
- the reviewed gap acknowledgement requires `phase IN ('idle','active')` and a matching owner id/epoch, so it correctly refuses an `uncertain` row.

Reopening the connector therefore requires an Owner-approved, reviewed reconciliation operation (shape in [G5A-BOOTSTRAP-REPORT.md](../evidence/G5A-BOOTSTRAP-REPORT.md) §10.4), followed by a **new** G5-A authorization. Until then the state stays fenced; do not edit the rows by hand.

## Report requirements

Every stage report (`G5A-BOOTSTRAP-REPORT.md`, `G5B-OBSERVE-REPORT.md`, `G5C-SEND-REPORT.md`) and the final `G5-LIVE-PILOT-SUMMARY.md` must contain:

- source commit and reviewed connector image identity/digest, plus the exact image used;
- stage token and whether it is PASS, FAIL or UNPROVEN;
- UTC start/end, automatic expiry and observed stop reason;
- aliases only; no account UID, peer UID, phone number, QR, cookie, token, message body or key;
- test IDs and expected versus observed behaviour;
- phone coexistence and any session-renewal observation;
- counts and outcomes for outbound/inbound work, including refused/unknown;
- errors and safety halts with sanitized detail;
- an explicit statement separating live evidence from synthetic/offline/CI evidence;
- independent review and residual risks.

The final summary must state that technical PASS at any stage did not itself authorize the next stage, and must not claim production readiness, capacity or platform safety.

## Current stop point

**STOP — `G5A_TWO_HOP_DEPLOYED_RECONCILIATION_AWAITING_OWNER_START` (2026-11-11).**
The reviewed two-hop image `zalo-shared-connector:g5-ci-d6f8aec` is deployed to the
private pilot and the egress gateway is healthy; the connector container was not
launched and no provider contact occurred. Ownership is fenced `uncertain` at epoch
9, gap 9, `reconciliation_required=true`, with zero sessions and zero unresolved
work. The single-use epoch 9→10 / gap 9→10 reconciliation is prepared and bound but
not executed: the wrapper refuses without the Owner's matching window file. The next
live G5-A attempt requires a separately authorized reconciliation execution followed
by a new G5-A start authorization. Do not reset control state by hand and do not
retry inside a consumed window.
