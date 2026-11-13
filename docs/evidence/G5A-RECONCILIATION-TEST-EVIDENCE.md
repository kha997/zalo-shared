# G5-A — Reconciliation and diagnostics test evidence

**Date:** 2026-11-04
**Base:** `793bda9` on `feat/shared-inbox`, plus the uncommitted implementation
this evidence covers
**Status:** offline evidence. **No test touched the pilot database, the pilot
containers or the network.**

## 1. Environment

| Item | Value |
| --- | --- |
| Host | WSL2 Ubuntu 24.04 |
| Node | v24.19.0 |
| Runner | `node --import tsx --test --test-concurrency=1` |
| Database | disposable container `zs-pg-test`, `postgresql://test:test@127.0.0.1:45339/zalo_test` |
| Isolation | every test creates a fresh schema, runs migrations, and drops the schema (`tests/backend/isolation.ts`) |
| Pilot state | `pilot-postgres` and `zalo-shared-pilot-egress-gateway-1` stayed **stopped**; no query was sent to them |

The explicit runner command above was used so the exact file set and the
single-worker setting are visible; it is equivalent to the repository's `test`
script for these paths.

## 2. Verification runs

| Command | Result |
| --- | --- |
| `npm run typecheck` | **PASS** (no output) |
| `npm run build:connector` | **PASS** (no output) |
| Full suite, run A (before the final regression test) | **353/353 PASS**, 0 fail, 89.9 s |
| Full suite, run B (final tree, 354 tests) | **353 PASS / 1 fail** — the known pre-existing load-sensitive loopback test in `pilot-egress-guard`; the same file passes **23/23** when re-run alone |
| `tests/backend/connector-reconciliation.test.ts` | **8/8 PASS** |
| `tests/backend/connector-operations-http.test.ts` | **4/4 PASS** |
| `tests/transport/sdk-redirect.test.ts` | **5/5 PASS** |
| `tests/transport/qr-bootstrap.test.ts` | **31/31 PASS** |
| `tests/backend/pilot-egress-guard.test.ts` (isolated) | **23/23 PASS** |

The full command was:

```bash
TEST_DATABASE_URL=postgresql://test:test@127.0.0.1:45339/zalo_test \
  node --import tsx --test --test-concurrency=1 \
  tests/backend/*.test.ts tests/transport/*.test.ts
```

The raw log stayed in `/tmp` and is deliberately not committed; this document is
the sanitized record.

## 3. Reconciliation tests (8)

Disposable database, real migrations, real advisory locks.

| Test | Proves |
| --- | --- |
| rejects malformed input before any database access | 13 malformed bodies (extra/missing keys, bad uuid/epoch/gap/evidence, `confirmOwnerApproved:false`, non-`absent` local state) return 400 with **zero** queries |
| requires an explicit transaction and a fresh administrator | outside a transaction the operation refuses (409); a valid transaction with a non-admin actor is 403; the admin role is re-read in the transaction |
| re-arms ownership and provider state in one transaction | from the fenced state, epoch `1→2`, gap `1→2`, phase `idle`, `owner_id NULL`, `last_fenced_*` set, `reconciliation_required=false`, `status='disconnected'`; the audit row's metadata is exact; a sent outbox/message is byte-for-byte unchanged; no provider ledger row; a later gap acknowledgement is 409 because the gap moved |
| a replayed request returns the original result without a second write | same `requestId` and evidence → `alreadyApplied:true`, still one audit row; different evidence → 409; the same id against a new incident → 409 |
| epoch, owner, gap, phase and provider-status mismatches all fail closed | each single-field mismatch is 409 and writes nothing |
| unresolved provider, media, outbox and part work blocks recovery | each of held/overflow/missing/conflict events, held/pending/processing media, pending/processing/unknown outbox, and pending/processing/unknown parts independently blocks with 409 |
| a live connector or worker lock prevents recovery | a held session lock `73002` and a held worker lock `73001` each block; both succeed after releasing/gaining the locks |
| recovery refuses to run at the terminal version | `expectedGapVersion = MAX_GAP_VERSION` → 400; `MAX-1` against an actual `MAX` → 409 |

## 4. HTTP route test (1 of 4)

"the reconciliation route requires admin, CSRF and the exact fenced epoch":

- no CSRF token → **403**;
- `confirmOwnerApproved:false` → **400**;
- wrong expected epoch → **409**;
- valid body → `{ ok:true, epoch:"2", gapVersion:"2", alreadyApplied:false }`;
- the operations summary then reports `reconciliationRequired:false`,
  `gapVersion:"2"`, `owner.phase:"idle"`, `owner.ownerId:null`.

The route inherits the existing admin + CSRF + fresh-session transaction from
`server/app.ts`; the test exercises the real Fastify app, not the function in
isolation.

## 5. Redirect tests (5)

`tests/transport/sdk-redirect.test.ts` loads the **real** pinned
`zca-js@2.2.0` module through `pathToFileURL` and replaces only the SDK's
documented `polyfill` fetch hook.

| Test | Result |
| --- | --- |
| pinned SDK follows a checkSession Location to chat.zalo.me | follows the `302`; guard-shaped refusal yields exactly `Cannot get session, login failed`; no `wpa`/`jr` call, no event type 4, no host text in the error |
| the SDK follows any Location, so an unlisted redirect is refused too | a foreign host is also followed and refused — the follow is unconditional |
| without a redirect the SDK reaches userinfo and resolves | positive control: the fixture models a successful login |
| the connector guard refuses chat.zalo.me before any socket | child process with `-r ops/pilot-egress-guard.cjs` and the three-host allowlist throws `PILOT_EGRESS_DENIED` for `chat.zalo.me:443` and a foreign host before any connection |
| the installed SDK is the reviewed pin and still uses the observed URL | pin is `2.2.0`; the exact `checksession` URL is present; no `logout`; `utils.js` reads `location` |

## 6. Diagnostics tests (4 of 31 bootstrap tests)

| Test | Result |
| --- | --- |
| SDK login rejections map to the exact failing call and never echo provider text | six fixed messages and one unknown map to the expected codes; error text is always `SDK facade unavailable`; no message text appears |
| each supported offline failure stops at a named stage with a closed reason | the nine-row matrix in `G5A-PRIVATE-DIAGNOSTICS-ACCEPTANCE.md` §3 |
| the private diagnostic survives process exit with stages only and no secrets | a separate process writes the real diagnostic file, exits, and the parent reads only the expected stages with no UID/cookie/imei/user-agent/provider text; mode `0600` |
| an abort during an in-flight QR display never reports it as shown | abort while `showPng` is pending yields `aborted` with no `qr-shown` or `scanned` stage (independent-review finding 2) |

## 7. What the evidence does and does not establish

- **Establishes:** the operation is fail-closed against the ten safeguards on a
  disposable database, is idempotent, leaves delivery state untouched, and is
  reachable only through an authenticated admin + CSRF route; the redirect path
  is understood at the SDK and guard level; the diagnostic vocabulary attributes
  the required failure modes.
- **Does not establish:** any real-database or live outcome. The pilot rows were
  not read or written; no host was admitted; no provider was contacted; no
  container was rebuilt or started.
- **Independence:** these runs were executed by the implementation author. A
  separate review and reproduction is recorded in
  `G5A-INDEPENDENT-RECOVERY-REVIEW.md`; its independence limitation is stated
  there.

**STOP — `G5A_RECONCILIATION_IMPLEMENTED_AWAITING_OWNER_EXECUTION`.**