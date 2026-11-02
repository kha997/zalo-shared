# G5 live pilot procedure — activation pending

**Status:** `G5A_AWAITING_OWNER_START`
**Decision record:** [G5-SCOPE-APPROVAL.md](../evidence/G5-SCOPE-APPROVAL.md)
**Readiness report:** [G5A-ACTIVATION-READINESS.md](../evidence/G5A-ACTIVATION-READINESS.md)

No step in this document authorizes a live action by itself. The Owner must name the exact stage, UTC start and automatic expiry in a separate explicit command. Stop at the end of each stage and wait for the next authorization.

## Common preconditions for every stage

1. The Owner has confirmed the dedicated account alias, the single consenting peer alias, the private host and the exact UTC window.
2. The private consent record is complete and referenced by `consentRef`; the manifest uses aliases only in repository material.
3. The reviewed connector image is the one recorded in the readiness report; the source commit, connector lock and SDK integrity match the embedded build identity.
4. `ops/local/preflight-connector.sh IMAGE STAGE` returns `"ok":true` and `"gate":"admitted"` for the exact stage manifest with no network namespace. Preflight checks scope only; the live command separately verifies the embedded image identity.
5. The connector has exclusive ownership; no second connector process or stale container is running.
6. The official phone is available, unlocked and held by the Owner; no screenshot, screen share, chat upload or cloud sync of the QR is permitted.
7. The stage-specific grant is fresh, purpose-matching and expires no later than the Owner window. Enrollment ≤1 hour; observe/send-test ≤2 hours.
8. The emergency stop path is open: the Owner can terminate the container and revoke the session from the phone.

## Stage G5-A — bootstrap (QR enrollment only)

**Pre-authorized action:** none yet. Wait for `G5A_START_AUTHORIZED` from the Owner with the UTC start and expiry.

1. Generate the enrollment manifest from [pilot-manifest.enroll.template.json](pilot-manifest.enroll.template.json) on the private host. Use a null `expectedAccountId`, zero peers, purpose `enroll-session`, `maxPartsPerDay: 10`, `minIntervalMs: 2000` and an expiry ≤1 hour.
2. Run `preflight` for `bootstrap`; confirm admitted and the summary shows `accountBound:false`, `peerCount:0`, `maxPartsPerDay:10`, `minIntervalMs:2000`, `lifetimeMs` ≤3600000.
3. Start `bootstrap --acknowledge-pilot-risk` once.
4. The connector writes `qr.png` 0600 in a 0700 local view directory. The Owner opens it locally, scans with the official phone, confirms the displayed account UID/name in the terminal prompt, and the connector clears the QR.
5. Confirm the encrypted session file exists 0600 and no token, cookie or session value appears in output or logs.
6. Stop after enrollment. Do not start observe in the same authorization.

**Evidence to record:** enrollment grant expiry, UTC start/end, preflight output, QR file mode/ownership and clear time, UID confirmation outcome (yes/no), session file mode, phone coexistence observation, errors and the stage token.

**PASS token:** `G5A_BOOTSTRAP_VERIFIED`. A failed or uncertain enrollment is `FAIL` or `UNPROVEN`; do not retry automatically.

## Stage G5-B — observe

**Pre-authorized action:** none. Requires a separate `G5B_START_AUTHORIZED` after G5-A PASS.

1. Generate the observe manifest from [pilot-manifest.template.json](pilot-manifest.template.json) with the exact account UID and exactly one peer UID. Expiry ≤2 hours and ≤ the Owner window.
2. Run `preflight` for `observe`; confirm `accountBound:true`, `peerCount:1`, `maxPartsPerDay:10`, `minIntervalMs:2000` and `lifetimeMs` ≤7200000.
3. Start `run-observe --acknowledge-pilot-risk` once. No dispatcher is constructed.
4. The runtime stops at grant expiry, the 2-hour wall-clock cap (`session-limit`), a connection fault, lost ownership or an operator abort.
5. Do not send from another device or introduce a second peer. Record inbound counts and any rejected inbound events; never store message bodies in evidence.

**Evidence to record:** UTC start/end and stop reason, tick count, accepted/rejected inbound counts by category (no bodies), connection events, phone coexistence, ownership, errors and the stage token.

**PASS token:** `G5B_OBSERVE_VERIFIED`.

## Stage G5-C — send-test

**Pre-authorized action:** none. Requires a separate `G5C_START_AUTHORIZED` after G5-B PASS.

1. Generate the send-test manifest from [pilot-manifest.send-test.template.json](pilot-manifest.send-test.template.json) with the same exact account and single peer. Expiry ≤2 hours and ≤ the Owner window.
2. Run `preflight` for `send-test`; same G5 bounds as observe.
3. Start `run-send-test --acknowledge-pilot-risk` once. Only text to the allowlisted direct peer is permitted; attachments are refused before reservation and egress.
4. Respect the durable 10-part/day budget and ≥2 s interval. Never resend an unknown result; stop the session and follow the unknown-work procedure.
5. End at 10 parts, grant expiry, the 2-hour cap, a safety halt or the Owner stop command.

**Evidence to record:** UTC start/end and stop reason, planned versus observed parts, provider IDs (aliases/redacted), accepted/failed/unknown counts, interval observations, the single recipient check, text-only check, phone coexistence, errors and the stage token.

**PASS token:** `G5C_SEND_VERIFIED`.

## Stop and revoke

1. Send `SIGTERM` to the connector container/process once; wait for exit. Do not restart, reconnect or start a replacement connector.
2. Verify ownership is released/quarantined and the process is gone. A database lock cannot cancel an in-flight provider call; treat unverified termination as unknown.
3. Revoke the provider session from the official phone (log out the pilot device/session). There is no automatic reauthentication or QR retry in this build.
4. Stop the application worker if it could claim pilot work. Preserve the database and sanitized logs.
5. If the pilot is ending, follow [PILOT-TEARDOWN.md](PILOT-TEARDOWN.md) for D7 deletion, inventory and backup disclosure.

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

**STOP — `G5A_AWAITING_OWNER_START`.** No live login, QR scan, session write, observation or send may occur until the Owner issues the G5-A start authorization.
