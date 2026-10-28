# Implementation roadmap and execution ledger

Plan date 2026-10-27. Binding spec docs/DESIGN.md; API docs/API.md. User explicitly delegates architecture and subagent coordination; no design check-in gates. Worktree `/workspace/zalo-shared-dev`, branch `feat/shared-inbox`, base `787777e`.

## Tasks
1. Backend: PostgreSQL schema/migrations, auth/roles/CSRF/audit, conversations assignment/versioning, idempotent durable messages, attachments, mock provider/worker, metrics. Tests/backend test-first with actual PostgreSQL. Fail-safe unknown delivery; no real Zalo calls. Report docs/review/backend-report.md.
2. UI: accessible Vietnamese React inbox, auth, assignment, send/media state, provider status, users/audit; contract docs/API.md. Unit/browser evidence via QA. Report docs/review/ui-report.md.
3. QA: real Chromium contexts (4) plus HTTP load 4/10/25/50; security, crash/restart/restore gates; artifact files with measured metrics. No production or actual Zalo. Report docs/review/qa-report.md.
4. Ops: private Compose app/worker/PG, nonroot images, health, backup/restore, CI test/build pipeline with PG, operator and incident runbooks. No production/CD trigger. Report docs/review/ops-report.md.
5. Root integration, independent whole-branch review, remediation, rerun tests, issue/PR evidence and readiness status.

Ruling: implement isolated original control plane rather than copy unlicensed prototypes — security/durability ownership — cost: additional product development and live-adapter readiness remains open.
Ruling: disjoint ownership allows backend/UI/QA/Ops work in parallel as requested team orchestration; root owns shared configuration, contract changes announced to all — cost: integration discipline and review required.
Ruling: repository currently public and GitHub integration forbids visibility changes (403); do not upload unlicensed source snapshots or sensitive evidence. Original code and summarized research only may be pushed to feature branch under Owner's explicit GitHub authorization. No secrets/default real credentials.
Ruling: live Zalo tests blocked pending account-owner approval/resources. Build all authorized simulator/infrastructure work first, report open gate; never claim production-ready.

## Progress
- [x] Inspected remote initial README, cloned existing main, created isolated worktree.
- [x] Authored spec/API/plan, independent architecture reviewer dispatched.
- [ ] Backend implementation and review
- [ ] UI implementation and review
- [ ] QA/browser/load evidence
- [ ] Ops/CI/restore evidence
- [ ] Whole-branch review and fixes
- [ ] Push branch and open PR with measured evidence
- [ ] Approved separate-account live validation (blocked)
- [ ] Owner production authorization (not requested yet)

Integration update: dependency install succeeded with isolated /tmp npm cache. PostgreSQL17 Docker started loopback55432 with random synthetic secrets in restricted /tmp files. Separate zs_app role applied; actual metadata checks deny audit UPDATE/DELETE/TRUNCATE. npm audit rerun reports zero after removal of vulnerable @fastify/static. Root fixed startup asset-whitelist server with observed assertion red404vs200 then green1/1. Backend security remediation and full tests ongoing.

Resume 2026-10-28: recovered worktree after usage limit. No source reimplementation. Latest completed local suite20/20 (backend8 + transport12); previous browser3pass1skip; encrypted restore proved sessions0/dispatchable0/privateattachment1/runtimeCONNECTfalse. Conversation keyset test observed red5vs2 then green. Added UI pagination, original offline transport/vault12tests, security regression cases awaiting PG execution. Additional-network shell commands now stall before execution, so validation transitions to authorized GitHub CI instead of repeatedly waiting. Worker backlog regression is intentionally not yet verified; microsecond pagination regression expected to expose current Date precision defect. Default/live boundaries unchanged.

Hosted CI baseline29c9c7: raw26/28 unit passed; two red regressions confirmed. Workflow success was false-green from tee; forced bash/pipefail. Four-context browser3pass1skip, API load4/10/25/50 measured p95≈67/80/207/415ms zeroerrors, restore+image smoke executed. Review rounds found and fixed upload, precision/history, workerthroughput, stale401, restore/loadassertions; boundedhistory initialempty edge fixed in round3 with red/green helper regression. New local offline19assertions/build pending last rerun. CI rerun is authoritative for PG/process/browser/load because local additional-network execution stalls. Source branch remote29c9c7 and PR#3draft exist; main remains initial.
