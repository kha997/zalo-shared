// Disposable-database proof of the full admin reconciliation path.
//
// setup: seeds one admin and one agent through the reviewed password hashing
// and reproduces the pilot's fenced state (uncertain, epoch 1, gap 1) so the
// successful reconciliation below is exercised against synthetic rows only.
// run: drives the reviewed HTTP app — login, CSRF, role checks, one applied
// reconciliation, an idempotent replay and logout — then asserts the resulting
// state. This file refuses any database that is not explicitly disposable.
import { randomBytes, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";
import {
  ACCOUNT,
  checkPassword,
  createPool,
  hashPassword,
  seed,
} from "../../dist/server/db.js";

const fail = (message) => {
  process.stderr.write(`disposable-admin: FAIL ${message}\n`);
  process.exit(1);
};
const state = process.env.DISPOSABLE_STATE || "setup";
const url = process.env.DISPOSABLE_DATABASE_URL;
const file = process.env.DISPOSABLE_CREDENTIAL_FILE;
if (!url) fail("DISPOSABLE_DATABASE_URL is required");
if (!file) fail("DISPOSABLE_CREDENTIAL_FILE is required");
if (process.env.DISPOSABLE_ALLOW !== "1")
  fail("DISPOSABLE_ALLOW=1 is required; this harness creates and reconciles synthetic rows");
if (/pilot/i.test(url) || /pilot/i.test(String(process.env.DISPOSABLE_DB_NAME || "")))
  fail("this harness must never be pointed at the pilot database");

const pool = createPool(url, { max: 3 });
const say = (payload) => process.stdout.write(`${JSON.stringify(payload)}\n`);

if (state === "setup") {
  process.umask(0o077);
  if (existsSync(file)) fail("credential file already exists");
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const admin = { email: "admin-" + randomUUID() + "@disposable.test", password: randomBytes(32).toString("base64url") };
  const agent = { email: "agent-" + randomUUID() + "@disposable.test", password: randomBytes(32).toString("base64url") };
  const ownerId = randomUUID();
  try {
    const identity = (await pool.query("SELECT current_database() AS db")).rows[0].db;
    if (identity !== process.env.DISPOSABLE_DB_NAME)
      fail(`connected to ${identity}, expected the disposable database ${process.env.DISPOSABLE_DB_NAME}`);
    if (identity === "zalo" || identity === "zalo_test") fail(`refusing the database ${identity}`);
    const pristine = (
      await pool.query("SELECT (SELECT count(*)::int FROM users) AS users, (SELECT count(*)::int FROM audit) AS audit")
    ).rows[0];
    if (pristine.users !== 0 || pristine.audit !== 0)
      fail(`the target is not a fresh disposable database ${JSON.stringify(pristine)}`);
    await seed(pool, { adminEmail: admin.email, adminPassword: admin.password, adminName: "Disposable Admin" });
    await pool.query(
      "INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'agent')",
      ["Disposable Agent", agent.email, await hashPassword(agent.password)],
    );
    await pool.query(
      `UPDATE connector_ownership SET phase='uncertain',owner_id=$1,owner_label='pilot-enrollment',
         epoch=1,reserved_at=now(),heartbeat_at=now(),uncertain_at=now(),fault_code='shutdown'
       WHERE account_id=$2`,
      [ownerId, ACCOUNT],
    );
    await pool.query(
      "UPDATE provider_state SET status='disconnected',reconciliation_required=true,fault_code='shutdown',gap_version=1 WHERE account_id=$1",
      [ACCOUNT],
    );
    const fd = openSync(file, "wx", 0o600);
    try {
      writeSync(
        fd,
        `DISPOSABLE_ADMIN_EMAIL=${admin.email}\nDISPOSABLE_ADMIN_PASSWORD=${admin.password}\n` +
          `DISPOSABLE_AGENT_EMAIL=${agent.email}\nDISPOSABLE_AGENT_PASSWORD=${agent.password}\n` +
          `DISPOSABLE_OWNER_ID=${ownerId}\n`,
      );
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    if ((statSync(file).mode & 0o777) !== 0o600) fail("credential file mode is not 0600");
    const counts = (await pool.query("SELECT count(*)::int users, count(*) FILTER (WHERE role='admin')::int admins FROM users")).rows[0];
    if (counts.users !== 2 || counts.admins !== 1) fail(`unexpected seeded identity state ${JSON.stringify(counts)}`);
    say({ ok: true, action: "disposable-setup", users: counts.users, admins: counts.admins, ownerId, credentialMode: "600" });
  } finally {
    await pool.end();
  }
  process.exit(0);
}

if (state !== "run") fail("DISPOSABLE_STATE must be setup or run");
if (!process.env.DISPOSABLE_BASE_URL) fail("DISPOSABLE_BASE_URL is required");
process.umask(0o077);

const read = (key) => {
  const line = readFileSync(file, "utf8")
    .split("\n")
    .find((entry) => entry.startsWith(`${key}=`));
  if (!line) fail(`${key} is missing from the credential file`);
  return line.slice(key.length + 1);
};
const admin = { email: read("DISPOSABLE_ADMIN_EMAIL"), password: read("DISPOSABLE_ADMIN_PASSWORD") };
const agent = { email: read("DISPOSABLE_AGENT_EMAIL"), password: read("DISPOSABLE_AGENT_PASSWORD") };
const ownerId = read("DISPOSABLE_OWNER_ID");
const base = process.env.DISPOSABLE_BASE_URL;
let baseUrl;
try {
  baseUrl = new URL(base);
} catch {
  fail("DISPOSABLE_BASE_URL is not a URL");
}
if (!["127.0.0.1", "localhost", "[::1]"].includes(baseUrl.hostname))
  fail("DISPOSABLE_BASE_URL must be loopback; the credential is never sent elsewhere");

const checks = [];
const record = (name, pass, detail = {}) => {
  checks.push({ name, pass: Boolean(pass), ...detail });
  return Boolean(pass);
};
const call = async (path, { method = "GET", headers = {}, body, cookie } = {}) => {
  const h = { ...headers };
  if (cookie) h.cookie = cookie;
  let payload;
  if (body !== undefined) {
    h["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const response = await fetch(base + path, { method, headers: h, body: payload, redirect: "manual" });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  return { status: response.status, json, setCookie: response.headers.getSetCookie?.() ?? [] };
};
const login = async (email, password) => {
  const r = await call("/api/auth/login", { method: "POST", headers: { origin: base }, body: { email, password } });
  const raw = r.setCookie.find((entry) => entry.startsWith("zs_session="));
  return { status: r.status, body: r.json, cookie: raw?.split(";")[0], csrf: r.json?.csrfToken };
};

try {
  const invalid = await login(admin.email, admin.password + "x");
  record("invalid credentials are rejected", invalid.status === 401, { status: invalid.status });

  const adminSession = await login(admin.email, admin.password);
  record("the admin authenticates and receives a session with CSRF", adminSession.status === 200 && adminSession.body?.user?.role === "admin" && typeof adminSession.csrf === "string" && adminSession.csrf.length >= 32 && Boolean(adminSession.cookie), {
    status: adminSession.status,
    role: adminSession.body?.user?.role,
    csrfBytes: adminSession.csrf?.length ?? 0,
    cookieBytes: adminSession.cookie?.length ?? 0,
  });
  const agentSession = await login(agent.email, agent.password);
  record("the non-admin authenticates", agentSession.status === 200 && agentSession.body?.user?.role === "agent", { status: agentSession.status, role: agentSession.body?.user?.role });

  const summaryBefore = await call("/api/provider/operations", { cookie: adminSession.cookie });
  record("the admin sees the synthetic uncertain state", summaryBefore.status === 200 && summaryBefore.json?.owner?.phase === "uncertain" && summaryBefore.json?.owner?.epoch === "1" && summaryBefore.json?.gapVersion === "1" && summaryBefore.json?.reconciliationRequired === true, {
    status: summaryBefore.status,
    phase: summaryBefore.json?.owner?.phase,
    epoch: summaryBefore.json?.owner?.epoch,
    gapVersion: summaryBefore.json?.gapVersion,
    reconciliationRequired: summaryBefore.json?.reconciliationRequired,
  });

  const payload = {
    requestId: randomUUID(),
    expectedOwnerId: ownerId,
    expectedOwnerEpoch: "1",
    expectedGapVersion: "1",
    evidenceRef: "disposable-owner-approval-2026-11-04",
    confirmOwnerApproved: true,
    localState: { sessionFile: "absent", quarantine: "absent" },
  };

  const noCsrf = await call("/api/provider/operations/reconcile", { method: "POST", cookie: adminSession.cookie, headers: { origin: base }, body: payload });
  record("a state-changing request without CSRF is rejected", noCsrf.status === 403, { status: noCsrf.status });
  const wrongOrigin = await call("/api/provider/operations/reconcile", { method: "POST", cookie: adminSession.cookie, headers: { origin: "http://127.0.0.1:9999", "x-csrf-token": adminSession.csrf }, body: payload });
  record("a foreign origin is rejected", wrongOrigin.status === 403, { status: wrongOrigin.status });
  const missingConfirmation = await call("/api/provider/operations/reconcile", { method: "POST", cookie: adminSession.cookie, headers: { origin: base, "x-csrf-token": adminSession.csrf }, body: { ...payload, confirmOwnerApproved: false } });
  record("an unconfirmed body is rejected", missingConfirmation.status === 400, { status: missingConfirmation.status });
  const nonAdmin = await call("/api/provider/operations/reconcile", { method: "POST", cookie: agentSession.cookie, headers: { origin: base, "x-csrf-token": agentSession.csrf }, body: payload });
  record("a non-admin is refused the reconciliation route", nonAdmin.status === 403, { status: nonAdmin.status });
  const nonAdminRead = await call("/api/provider/operations", { cookie: agentSession.cookie });
  record("a non-admin is refused the operations summary", nonAdminRead.status === 403, { status: nonAdminRead.status });

  const applied = await call("/api/provider/operations/reconcile", { method: "POST", cookie: adminSession.cookie, headers: { origin: base, "x-csrf-token": adminSession.csrf }, body: payload });
  record("the admin applies the reviewed reconciliation", applied.status === 200 && applied.json?.ok === true && applied.json?.epoch === "2" && applied.json?.gapVersion === "2" && applied.json?.alreadyApplied === false, {
    status: applied.status,
    epoch: applied.json?.epoch,
    gapVersion: applied.json?.gapVersion,
    alreadyApplied: applied.json?.alreadyApplied,
  });

  const summaryAfter = await call("/api/provider/operations", { cookie: adminSession.cookie });
  record("the state is idle, epoch 2, gap 2, reconciliation cleared", summaryAfter.status === 200 && summaryAfter.json?.owner?.phase === "idle" && summaryAfter.json?.owner?.ownerId === null && summaryAfter.json?.owner?.epoch === "2" && summaryAfter.json?.gapVersion === "2" && summaryAfter.json?.reconciliationRequired === false, {
    status: summaryAfter.status,
    phase: summaryAfter.json?.owner?.phase,
    ownerId: summaryAfter.json?.owner?.ownerId,
    epoch: summaryAfter.json?.owner?.epoch,
    gapVersion: summaryAfter.json?.gapVersion,
    reconciliationRequired: summaryAfter.json?.reconciliationRequired,
  });

  const replay = await call("/api/provider/operations/reconcile", { method: "POST", cookie: adminSession.cookie, headers: { origin: base, "x-csrf-token": adminSession.csrf }, body: payload });
  record("the replay is idempotent", replay.status === 200 && replay.json?.alreadyApplied === true && replay.json?.epoch === "2" && replay.json?.gapVersion === "2", {
    status: replay.status,
    alreadyApplied: replay.json?.alreadyApplied,
  });

  const db = (
    await pool.query(
      `SELECT o.phase,o.owner_id,o.epoch::text,s.reconciliation_required,s.gap_version::text,
         (SELECT count(*)::int FROM audit WHERE action='connector.reconciled') AS reconciled,
         (SELECT count(*)::int FROM audit WHERE action='connector.reconciled' AND metadata->>'requestId'=$2) AS for_request,
         (SELECT count(*)::int FROM messages) AS messages,
         (SELECT count(*)::int FROM outbox) AS outbox,
         (SELECT count(*)::int FROM delivery_parts) AS delivery_parts,
         (SELECT count(*)::int FROM provider_ledger) AS provider_ledger,
         (SELECT count(*)::int FROM sessions) AS sessions,
         (SELECT count(*)::int FROM users) AS users
       FROM connector_ownership o JOIN provider_state s ON s.account_id=o.account_id WHERE o.account_id=$1`,
      [ACCOUNT, payload.requestId],
    )
  ).rows[0];
  record("exactly one reconciliation audit row exists for the request", db.reconciled === 1 && db.for_request === 1, { reconciled: db.reconciled, forRequest: db.for_request });
  record("no delivery state was created", db.messages === 0 && db.outbox === 0 && db.delivery_parts === 0 && db.provider_ledger === 0, {
    messages: db.messages,
    outbox: db.outbox,
    deliveryParts: db.delivery_parts,
    providerLedger: db.provider_ledger,
  });
  record("the control rows hold the reconciled result", db.phase === "idle" && db.owner_id === null && db.epoch === "2" && db.reconciliation_required === false && db.gap_version === "2", {
    phase: db.phase,
    epoch: db.epoch,
    gapVersion: db.gap_version,
  });

  const adminLogout = await call("/api/auth/logout", { method: "POST", cookie: adminSession.cookie, headers: { origin: base, "x-csrf-token": adminSession.csrf }, body: {} });
  const agentLogout = await call("/api/auth/logout", { method: "POST", cookie: agentSession.cookie, headers: { origin: base, "x-csrf-token": agentSession.csrf }, body: {} });
  record("both sessions log out", adminLogout.status === 200 && agentLogout.status === 200, { admin: adminLogout.status, agent: agentLogout.status });
  const afterLogout = await call("/api/auth/me", { cookie: adminSession.cookie });
  record("the logged-out session is invalid", afterLogout.status === 401, { status: afterLogout.status });
  const sessions = (await pool.query("SELECT count(*)::int AS n FROM sessions")).rows[0].n;
  record("no session survives", sessions === 0, { sessions });

  const adminRow = await pool.query("SELECT password_hash,role,active FROM users WHERE email=$1", [admin.email]);
  record("the admin credential still verifies through the reviewed hash", adminRow.rowCount === 1 && adminRow.rows[0].role === "admin" && adminRow.rows[0].active === true && (await checkPassword(admin.password, adminRow.rows[0].password_hash)));

  const ok = checks.every((entry) => entry.pass);
  say({ ok, scope: "disposable-database", requestId: payload.requestId, ownerId, checks, final: db });
  if (!ok) process.exitCode = 1;
} catch (error) {
  const reason = String(error?.message || error)
    .split(admin.password)
    .join("[redacted]")
    .split(agent.password)
    .join("[redacted]");
  say({ ok: false, reason, checks });
  process.exitCode = 1;
} finally {
  await pool.end();
}
