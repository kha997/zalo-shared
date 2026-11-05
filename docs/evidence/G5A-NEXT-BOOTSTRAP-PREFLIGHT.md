# G5-A — Next-bootstrap preflight (read-only)

**Date:** 2026-11-05, observed 05:37Z–05:43Z
**Scope:** local, read-only database checks, offline image checks
**Status:** preflight PASS. **No deployment, no provider contact, no QR, no login.**

This preflight verifies the state a next authorized bootstrap would start from
and the identity of the image that would run it. The pilot database was started
only to read it and was stopped again; nothing else on the stack ran.

## 1. Control and provider state

Read in a `BEGIN TRANSACTION READ ONLY` block over the local socket, then
rolled back.

| Field | Value |
| --- | --- |
| account | `00000000-0000-4000-8000-000000000001` (the single pilot account) |
| `connector_ownership.phase` | `idle` |
| `connector_ownership.owner_id` | `null` |
| `connector_ownership.epoch` | `2` |
| `connector_ownership.fault_code` | `null` |
| `provider_state.status` | `disconnected` |
| `provider_state.reconciliation_required` | `false` |
| `provider_state.gap_version` | `2` |
| `provider_state.fault_code` | `null` |

The fenced incident stays reconciled; no owner is held and no reconciliation is
pending.

## 2. Unresolved work and concurrency

| Check | Value |
| --- | --- |
| unresolved provider events | `0` |
| unresolved media jobs | `0` |
| dispatchable outbox/message rows | `0` |
| pending/unknown delivery parts | `0` |
| advisory locks | `0` |
| other active sessions | `0` |
| `users` / active admins / sessions | `1` / `1` / `0` |
| messages, outbox, delivery parts, provider events/variants/media/ledger, send budget, part ledger, attachments, conversations | all `0` |
| `connector.reconciled` audit rows | `1` |

## 3. Local session and workload state

- `/home/zen/pilot-private/zalo-shared/pilot/state` contains only an empty
  `view/`; there is **no** `session.enc`, no temporary session file and no
  quarantine record. `session.key` exists with mode 0600.
- No connector, worker, application or gateway container is running. The pilot
  database network and the egress network have no running members; the database
  was returned to its prior `Exited (0)` state.
- No host process matches `pilot-connector`, `server/worker` or `server/main`.

## 4. Database TLS and network boundary

- `zalo-shared-pilot-db` reports `internal=true`.
- PostgreSQL reports `ssl=on`.
- The new connector image, attached only to that internal network, ran the
  reviewed `ops/local/harness/db-connect.mjs` gate:
  `{"gate":"admitted","role":"zs_app","ssl":"true","version":"TLSv1.3","cipher":"TLS_AES_256_GCM_SHA384"}`.
  The URL was supplied through a temporary 0600 env file and never printed.

## 5. Image identity

| Field | Value |
| --- | --- |
| Tag | `zalo-shared-connector:g5-ready-6d9c0e9` |
| Image id | `sha256:97513c22ac749982bdda8dd44137bb3f99adaf0eb40e2924547e248715168c84` |
| `sourceCommit` | `6d9c0e9ad839bf2e26000ac0faae7ec50d1a9609` |
| `lockSha256` | `17dcd25426639f7112b80764bc8aa27f9be2af3acf0aaf0f2cd490c434030c9b` |
| `sdkIntegrity` | `sha512-pBU0T0/uadH3Neq7yMssUmE769VVuqKhL8YD1HqQQG8e6lkwueAopNu0vhJdqiJRHZdPIEomT2FxRzauOx4pgA==` |

`sourceCommit` equals the code commit `6d9c0e9`, which is the parent of the
commit that adds this document; later commits in the tree are documentation
only. The synthetic bootstrap manifest generated from the same tree carries the
same build block and was admitted (`"ok":true,"purpose":"enroll-session"`).
Without a manifest the same image returns
`{"command":"dry-run","ok":false,"gate":"denied"}`.

The identity layer is now bound to the build argument: `SOURCE_COMMIT` is
referenced in the `RUN` command, so Docker cannot reuse a `build-identity.json`
cached from another commit. A probe build with a different commit produced the
probe commit, confirming the binding.

## 6. What is not ready by design

- The **deployed** gateway, connector image and env file still hold the
  three-host policy. `chat.zalo.me` is not reachable by the running stack.
- `ops/local/verify-deployed-pilot.sh` has not been re-run because it renders and
  probes the deployment that was intentionally left unchanged; it must run after
  the Owner accepts the admission and the stack is redeployed.
- The provider redirect and the post-redirect session remain UNPROVEN.

## 7. Verdict

The state is a clean starting point: `idle`, epoch 2, gap 2,
`reconciliation_required=false`, zero unresolved work, no session, no running
connector or worker, TLS 1.3 with `verify-full`, and an image whose embedded
identity matches `HEAD`.

**STOP — `G5A_NEXT_BOOTSTRAP_READY_AWAITING_OWNER_START`.** Deployment of the
prepared redirect admission and a new UTC bootstrap authorization remain Owner
decisions.
