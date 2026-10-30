# Private test-account activation implementation plan

> Planning and local source audit only. Execute with TDD and independent review after the current inbound receipt/worker/UI/recovery gates. This file authorizes no actual account, QR interaction, network login, deployment or production operation. Owner delegated offline engineering; real resources and residual-risk consent remain explicit Owner gates.

**Goal:** Produce a reviewable, deny-by-default private test harness that admits one dedicated account and a small consenting-peer allowlist without promoting the main application to a live provider.

**Architecture:** Keep `server/config.ts` limited to disabled/mock and keep the existing application image SDK-free. A separate pilot CLI/image acquires durable connector ownership before any SDK/vault work. An expiring, privately supplied technical manifest binds the reviewed source/lock and test identity to a persistent Owner consent reference; QR bootstrap and ordinary session startup have distinct purposes. SDK raw credentials remain private to narrow bootstrap/facade boundaries. Staff continue using their separate application accounts.

**Spec:** Owner invariants; `docs/operations/LIVE-PILOT.md`, `SDK-RISKS.md`, `CONNECTOR-FENCING.md`, `CONNECTOR-OPERATIONS.md`; current inbound and ownership plans. The older live-pilot handoff contains historical implementation-pending statements: use the newest `docs/READINESS.md` evidence for completed offline phases.

## Source evidence and limitations

Inspected installed exact `zca-js@2.2.0`, not a source-to-binary equivalence claim:

- `dist/zalo.d.ts:35` / `dist/zalo.js:74–104`: `loginQR(options,callback)` eventually returns an API; its GotLoginInfo callback exposes cookie/IMEI/userAgent **before** final `loginCookie` establishes the API/session identity. Never persist that callback directly.
- `dist/apis/loginQR.d.ts`: generated events contain image, code, token and actions; scanned events contain display_name/avatar; expiry/decline expose abort/retry. None is suitable for logs or public evidence.
- `dist/apis/loginQR.js:269–288`: passing a callback suppresses the default `qr.png` write. The supplied saveToFile action uses ordinary `writeFile`; do not use it for private-file permission enforcement.
- `dist/apis/loginQR.js:290–341`: without a callback expiry automatically retries. With a callback decline can return without resolving/rejecting its enclosing promise unless the callback aborts. Callback return values are not awaited. The wrapper must observe its own async work and explicitly abort expiry/decline, with an outer deadline and late-result disposal.
- `dist/apis/getOwnId.js`: `raw.getOwnId()` returns `ctx.uid` synchronously. This is the primary exact account binding, not a display name or phone number.
- The actual method is `fetchAccountInfo()`, not getAccountInfo: its declaration returns `{profile:User}` and its implementation performs a GET. The profile type contains phoneNumber/avatar and other personal fields. It is optional corroboration only, never required for identity binding or automatically logged; avatar URLs must not be fetched for a preview.
- `sdk-facade.ts:116–145` already denies before vault/import, uses logging:false/selfListen:true/checkUpdate:false and bounds login. It currently persists refreshed credentials at lines195–196 without checking expected UID. That guard must precede the first refreshed write and API exposure.
- The runtime admits one lifetime owner before factories, checks owner gates around factory/dispatch/session operations and conservatively keeps a fault gap closed. A database lock or SDK stop cannot cancel already-entered external work. Existing takeover/fencing requirements remain mandatory.

These declarations do not prove current QR service behavior, account eligibility, phone coexistence, session renewal, no-gap history, CDN hosts, cookie-free media or ban safety. Actual payload observations remain UNPROVEN until the explicitly approved dedicated-account pilot.

## Global constraints and review focus

- No HANU production, real customers, passwords/cookies/QR screenshots in chat/issues/artifacts, public listener, active-active connector, automatic re-login or production deployment.
- Main app provider modes stay disabled/mock; pilot entrypoint is separate, defaults to dry-run and never starts from ordinary app startup or CI.
- Missing/invalid/expired/source-mismatched manifest denies **before vault read, SDK import or factory invocation**. This is a technical admission check, not a requirement to ask Owner again after every commit. Owner authorization persists within the agreed account, peers, purposes, limits, risk and time window. Engineering Lead may refresh manifests for reviewed routine fixes/builds and local checkpoints against that same consent reference; broadened accounts, peers, rates, risks, time window or production require an Owner decision. The manifest records attestation, not cryptographic proof of human consent.
- One dedicated account; exact 1..4 consenting direct-message peer IDs, no groups or contact discovery. Initial send budget defaults to30 parts/day and at least2 seconds between externally entered parts, globally durable across processes/restarts. These conservative pilot limits are engineering choices, not Zalo-approved limits or ban-safety claims.
- An unknown or accepted attempt consumes its reserved budget and is never automatically resent. Four staff seats do not imply four provider sessions or a higher account send rate.
- Keys/session/approval/identity binding are private files outside the repository, regular owned files, no symlinks, parent0700 and file0600. No secrets in argv or environment logs. Session key and locator encryption/fingerprint keys remain separate.
- Stop/revocation during QR, cookie login, persistence or sending must fence late results. An outer timeout does not prove provider cancellation; lost/uncertain ownership blocks replacement until independently verified external fencing.
- No actual host is approved for media downloads by this plan. A pilot must first confirm captured candidate schema, exact host and cookie-free behavior locally, then deliberately amend a reviewed private policy. Never expand to wildcards automatically.

## Task1 — approval, identity and destination policy

Create `server/pilot-policy.ts`, `server/pilot-budget.ts`, `tests/backend/pilot-policy.test.ts`, `tests/backend/pilot-budget.test.ts`; extend provider schema/counts/fingerprints only for the durable budget ledger.

```ts
type PilotPurpose = 'enroll-session'|'observe'|'send-test';
type PilotConsentScope = Readonly<{
  consentRef:string; notAfter:string; expectedAccountId:string|null;
  allowedPurposes:readonly PilotPurpose[]; allowedPeerIds:readonly string[];
  maxPartsPerDay:number; minIntervalMs:number;
}>;
type PilotGrant = Readonly<{
  version:1; grantId:string; purpose:PilotPurpose;
  sourceCommit:string; lockSha256:string; sdkIntegrity:string;
  issuedAt:string; expiresAt:string; ownerConsentRef:string;
  dedicatedAccountAttested:true; unofficialClientRiskAccepted:true;
  expectedAccountId:string|null; allowedPeerIds:readonly string[];
  maxPartsPerDay:number; minIntervalMs:number;
}>;
function validatePilotGrant(value:unknown, build:{sourceCommit:string;lockSha256:string;sdkIntegrity:string}, consent:PilotConsentScope, now:Date):PilotGrant;
async function reservePilotPart(db:pg.PoolClient, grant:PilotGrant, input:{messageId:string;part:number;peerId:string;threadType:0}):Promise<void>;
```

- [ ] RED tests for absent/extra fields, malformed dates/IDs, clock reversal, expiry, wrong source/lock/integrity, missing attestations, groups/nonallowlisted peers and unbounded budgets. Observe/send require nonempty expectedAccountId. Enroll alone may lack it under the separately explicit human-enrollment flow below; never silently fall back to enrollment.
- [ ] Default technical grant lifetime maxima: enrollment1hour; observe/send8hours. Engineering Lead may renew these after local/daily checks while the existing Owner consent scope remains valid; grant expiry never extends the Owner-approved window. No repeated Owner confirmation is needed for routine reviewed source/lock/build refreshes within that scope. Validate finite UTC timestamps, at most30seconds of future clock skew and immutable copies; maxPartsPerDay is1..30 and minIntervalMs is2000..60000. Account/peer IDs are exact nonempty ASCII `[A-Za-z0-9_-]{1,200}` strings, never numeric coercions; unsupported identifiers fail closed. Keep real UID/peer IDs in private manifest; public evidence uses local aliases and nonsecret consent reference.
- [ ] Add refresh tests: a routine reviewed build/hash change can receive a new technical grant under the same ownerConsentRef without an Owner prompt; an unrefreshed mismatched artifact still fails closed. Refuse refresh beyond consent.notAfter, a different bound account, new peers/purposes, a higher part budget, shorter interval or broadened risk. Keep the consent record separate from artifact-specific grants so a new commit cannot silently replace the authorized scope.
- [ ] Durable budget reservation is transactional and unique(message_id,part), account/grant scoped with a global account/day counter/serialization lock. Reserve before external dispatch, never refund accepted/unknown work and never reset on process restart or a new grant for the same account/day. Proven non-dispatch may conservatively consume budget. Refuse oversized/malformed jobs before reservation.
- [ ] Gate inbound persistence as well: only the bound account and approved direct peer threads. Unexpected peers/groups stop/quarantine with a fixed reason and count, without persisting body, locator, identity or raw SDK error. A dedicated blank account is an Owner attestation; filtering is additional protection, not proof no real contact can arrive.
- [ ] Test simultaneous four staff reservations, repeated request keys, restart/day/grant boundaries, exhausted quotas and post-reservation uncertainty. CI contains only synthetic grants/IDs and injected clocks.

## Task2 — exact UID before credential refresh or API exposure

Modify `adapters/zalo/sdk-facade.ts`; test `tests/transport/sdk-facade.test.ts` and add `tests/transport/pilot-identity.test.ts`.

- [ ] Add `expectedAccountId?:string` to the offline facade interface for backward-compatible existing fakes. The pilot host **requires** it for ordinary session start and always supplies it. Validate before store access/import. Narrow UID to bounded canonical nonempty string (the actual declaration returns string); reject numeric coercion, missing getOwnId, thrown/raw errors or mismatch.
- [ ] After raw login resolves, check UID before active assignment, refreshed-cookie persistence and any returned listener/send API. Recheck on every fresh generation and explicit session persistence. Raw getOwnId/profile/cookie/context must never escape the facade.
- [ ] RED tests prove wrong/missing/changed UID causes zero vault writes and zero exposed/start/send methods, consumes no message intent, safely disposes listener/error events, suppresses late completion after timeout and never logs the sentinel UID/cookie/error cause.
- [ ] Initial QR enrollment is a separate explicit grant: acquire ownership, complete an Owner-controlled dedicated-phone interaction, obtain UID locally, ask for a private local identity confirmation, then bind it before vault write. The first login necessarily precedes UID discovery when the Owner has no prior UID. Document that limitation; rejection/mismatch closes without persistence or sends. Ordinary startup can never use this exception.

## Task3 — narrow QR bootstrap and private file I/O

Create `adapters/zalo/qr-bootstrap.ts`, `tools/pilot-connector.ts`, `server/private-pilot-files.ts`, and focused `tests/transport/qr-bootstrap.test.ts`, `tests/backend/pilot-cli.test.ts`.

```ts
type TrustedSdkLoader = () => unknown | Promise<unknown>;
interface PrivateSessionStore { read():Promise<unknown>; write(value:unknown):Promise<void>; }
interface PrivateQrView {
  showPng(bytes:Uint8Array):Promise<void>; // owned0700 directory, wx0600 file, local view only
  clear():Promise<void>;
  confirmIdentity(value:{uid:string;displayLabel:string|null}):Promise<boolean>;
}
async function bootstrapPilotSession(options:{grant:PilotGrant;owner:OwnershipHandle;view:PrivateQrView;sessionStore:PrivateSessionStore;loader:TrustedSdkLoader;signal:AbortSignal}):Promise<{boundAccountId:string}>;
```

- [ ] CLI default command is dry-run; validates private config/source/manifest and reports only safe gate outcomes. It performs no vault read, SDK import, QR write, database change or network action. A separately named `bootstrap`/`run-observe`/`run-send-test` command requires the matching unexpired grant and explicit operator flag. No `--cookie`, token, key or URL arguments.
- [ ] Acquire durable ownership before view/SDK/store factories. Always pass a loginQR callback and safe SDK flags. Bound canonical base64 PNG bytes to1MiB; create own0700 private view directory and0600 file via exclusive no-symlink I/O. Do not call SDK saveToFile, render QR/token in stdout/stderr, fetch avatar URLs, start a web viewer or put images in evidence directories. Owner views it directly in the private host desktop; the exact environment/view mechanism is a resource decision before live use.
- [ ] Callback does not await async handlers: enqueue/observe private view work and explicitly abort on view failure, expiry, decline, SIGINT, lost owner or deadline. Never call retry. Use one120second bootstrap deadline; a late API receives an error sink and is stopped/discarded. GotLoginInfo is memory-only, not an accepted credential checkpoint.
- [ ] Validate final raw UID and latest serialized cookie jar only after final API resolution. On allowed enrollment confirmation, write the binding and encrypted session through a failure-safe staged transition; any partial/unknown checkpoint remains quarantined, never automatically starts a listener. Return only bound UID privately, not raw API/session.
- [ ] Private identity confirmation uses a directly controlled nonrecorded UI/TTY; labels are escaped/bounded, no terminal control injection. UID may be shown only there, not ordinary logs or artifacts. No phone number/profile fetch is necessary.
- [ ] Fake-loader tests cover all callback variants, callback rejection, no-callback/default-file prevention, declined promise hang, late credentials/API, interrupted writes, unexpected account and zero listener/send calls. Test file modes/symlink/oversize/path traversal and console redaction with synthetic material only.

## Task4 — private runtime integration and bounded teardown

Create `tools/pilot-runtime.ts`; extend adapter provider policy injection and test `tests/backend/private-pilot-flow.test.ts`.

- [ ] Inject reviewed facade, ownership, encrypted receipt/worker/private policy and dispatch budget; no direct SDK bypass. Observe mode has no dispatcher. Send-test mode dispatches only approved mapped direct peers and exact reserved parts. Listener reconnect always uses fresh generation and revalidates UID/grant/owner; manifest expiry blocks work synchronously until Engineering Lead refreshes the technical grant under the still-valid consent scope, not until a repeated Owner approval. Owner consent expiry or scope expansion requires an Owner decision. Technical refresh never authorizes automatic QR/re-authentication or an uncertain takeover.
- [ ] Current runtime's local gap gate stays closed after a fault. Do not add a permissive resume shortcut here. Use the reviewed admin reconciliation plus externally fenced/admitted replacement, or a separately specified/reviewed supervised-resume change before claiming automatic recovery. Unknown remains unknown and no QR retry occurs on disconnect.
- [ ] Stop/quota/risk warning disables new work, disposes pending QR/view/facade/transport, drains accepted bounded persistence and records safe uncertainty. Timeout does not cancel underlying SDK work; verify process termination/provider egress isolation before takeover. Do not expose a public health/QR/session HTTP endpoint.
- [ ] Four synthetic staff clients, two competing runtimes, owner loss during login/send/download, grant expiration, recipient races, key loss and external-fence attestation tests must pass without importing an actual authenticated SDK or using external network.

## Task5 — separate reproducible pilot image and key operations

Create `connector/package.json`, `connector/package-lock.json`, `tsconfig.connector.json`, `ops/Dockerfile.connector`, `ops/pilot-compose.example.yml`, `ops/pilot-scan.sh`; document `docs/operations/PRIVATE-PILOT.md`.

- [ ] Pin zca-js2.2.0 exactly as an explicit pilot runtime dependency with the already reviewed integrity/notices. Main package retains it development-only and main image assertion remains SDK-absent. Pilot lock has only actual compiled connector dependencies; no unchecked copying/pruning of a development node_modules tree.
- [ ] Compile into a distinct output root with tested entrypoint paths; use pinned builder/runtime digests, ignore install scripts, nonroot/read-only/cap-drop and private secret mounts. No published ports or default live command. Dry-run is image default; CI runs only dry-run/fake adapters and scans the intentional SDK-bearing image separately, recording deprecated crypto-js and license residual risks.
- [ ] Session and locator keys are separate owner-managed secret files with version IDs, not image/compose/env values. Validate ownership/permissions/no-symlink opens. Extend credential vault with account-bound versioned AAD/key ID and parent-directory durability; no silent legacy migration. Test offline rotate-to-new-file/decrypt verification and an explicit manifest/key selection transition before old material is retired. No automatic destructive key deletion.
- [ ] Backup/restore drills include budget/binding state and encrypted locators/session recovery requirements. Recovered ownership/grants remain quarantined; expired grants cannot start anything. Database backup without key recovery is not a session recovery proof. Ciphertext purging on a healthy worker is not absolute erasure from offline/retained backups; production retention/cryptographic-erasure policy remains an Owner decision.

## Task6 — offline acceptance, then Owner resource gate

- [ ] Fresh independent security/whole-flow review; compile/main SDK-free and pilot SDK-bearing image checks; no-approval zero-vault/import/network tests; QR/UID/key/cap/owner/unknown tests; full private HTTP/browser/fourstaff/durability CI. Retain tested SHA/lock/image digest and honest PASS/FAIL/UNPROVEN results.
- [ ] Only after those gates request a dedicated legitimate blank test account/official phone, consenting test peer, four physical workstations, a private test host able to show QR locally, and explicit unofficial-client/terms/account-restriction risk consent. Never ask for cookies/passwords/QR images in chat. Record approval by reference and adopted limits/window, not secret material.
- [ ] Start observe-only under direct Owner participation. Confirm exact UID, primary-phone operation, frames/CDN/cookie-free media and stop behavior before enabling a send-test grant already covered by the Owner-approved staged scope. Ask Owner again only if that scope did not include sending or the proposed account/peers/limits/risk/window changes. Observe real output privately; retain only manually normalized safe fixtures/host policy after token/identifier removal and review. Do not automatically archive raw SDK payloads or URLs.
- [ ] Execute the existing live protocol: four physical clients, phone-origin attribution, text/media both ways, owner-controlled invalidation/competing test session, reconnect/gaps/fenced recovery, encrypted restore and7–14day low-volume soak. Stop on warnings, restrictions, unexplained loss/duplicates or uncertain exclusivity; no detection evasion or replacement-account automation.

Offline completion demonstrates enforceable local boundaries only. Actual login compatibility, phone coexistence, real message/media delivery, current platform authorization, account-ban safety and production readiness remain UNPROVEN until performed/accepted. Even a passing pilot cannot guarantee ban safety. Production remains a separate explicit Owner decision; no approval is implied here.
