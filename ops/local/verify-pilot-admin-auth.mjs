// Non-reconciling authentication, authorization and CSRF proof against the
// pilot.
//
// Runs inside the no-published-port application container. It exercises only
// the reviewed HTTP surface: login, session, CSRF, role checks and route
// reachability. The single reconciliation POST carries an empty body, which the
// route's strict schema rejects before the operation runs; no control-state row
// is written. The harness snapshots the control rows itself and compares them
// before and after, so any unexpected mutation fails the run. Login and logout
// necessarily append their normal auth audit and session rows.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { checkPassword, createPool } from "../../dist/server/db.js";

const fail = (message) => {
  process.stderr.write(`pilot-admin-auth: FAIL ${message}\n`);
  process.exit(1);
};

const credentialFile = process.env.PILOT_ADMIN_CREDENTIAL_FILE;
const base = process.env.PILOT_ADMIN_BASE_URL || "http://127.0.0.1:3100";
if (!credentialFile) fail("PILOT_ADMIN_CREDENTIAL_FILE is required");
if (!process.env.DATABASE_URL) fail("DATABASE_URL is required");
let baseUrl;
try {
  baseUrl = new URL(base);
} catch {
  fail("PILOT_ADMIN_BASE_URL is not a URL");
}
if (!["127.0.0.1", "localhost", "[::1]"].includes(baseUrl.hostname))
  fail("PILOT_ADMIN_BASE_URL must be loopback; the credential is never sent elsewhere");

const read = (path, key) => {
  const line = readFileSync(path, "utf8")
    .split("\n")
    .find((entry) => entry.startsWith(`${key}=`));
  if (!line) fail(`${key} is missing from the credential file`);
  return line.slice(key.length + 1);
};
const email = read(credentialFile, "PILOT_ADMIN_EMAIL");
const credential = read(credentialFile, "PILOT_ADMIN_PASSWORD");
const wrong = credential + "x";

const checks = [];
const record = (name, pass, detail = {}) => {
  checks.push({ name, pass: Boolean(pass), ...detail });
  return Boolean(pass);
};
const sanitize = (value) => String(value ?? "").replace(/[\r\n]/g, " ").slice(0, 120);

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
  return { status: response.status, json, text, setCookie: response.headers.getSetCookie?.() ?? [] };
};

const pool = createPool(process.env.DATABASE_URL, { max: 2 });
const snapshot = async () => {
  const ownership = (
    await pool.query(
      `SELECT phase,epoch::text,owner_id::text,owner_label,fault_code,
         to_char(uncertain_at,'YYYY-MM-DD"T"HH24:MI:SS.USOF') AS uncertain_at,
         last_fenced_owner_id::text,last_fenced_epoch::text,
         to_char(last_fenced_at,'YYYY-MM-DD"T"HH24:MI:SS.USOF') AS last_fenced_at
       FROM connector_ownership`,
    )
  ).rows[0];
  const provider = (
    await pool.query(
      `SELECT status,reconciliation_required,gap_version::text,fault_code,
         to_char(last_event_at,'YYYY-MM-DD"T"HH24:MI:SS.USOF') AS last_event_at
       FROM provider_state`,
    )
  ).rows[0];
  const counts = (
    await pool.query(
      `SELECT (SELECT count(*)::int FROM users) AS users,
              (SELECT count(*)::int FROM users WHERE role='admin' AND active) AS admins,
              (SELECT count(*)::int FROM users WHERE role<>'admin') AS other_roles,
              (SELECT count(*)::int FROM sessions) AS sessions,
              (SELECT count(*)::int FROM messages) AS messages,
              (SELECT count(*)::int FROM outbox) AS outbox,
              (SELECT count(*)::int FROM delivery_parts) AS delivery_parts,
              (SELECT count(*)::int FROM provider_ledger) AS provider_ledger,
              (SELECT count(*)::int FROM audit) AS audit,
              (SELECT count(*)::int FROM audit WHERE action='connector.reconciled') AS reconciled,
              (SELECT json_agg(action ORDER BY id) FROM audit) AS actions`,
    )
  ).rows[0];
  return { ownership, provider, counts };
};

let cookie = null;
let csrf = null;
try {
  const before = await snapshot();
  record("baseline is uncertain with one admin", before.ownership.phase === "uncertain" && before.ownership.epoch === "1" && before.provider.reconciliation_required === true && before.counts.users === 1 && before.counts.admins === 1, {
    phase: before.ownership.phase,
    epoch: before.ownership.epoch,
    reconciliationRequired: before.provider.reconciliation_required,
    users: before.counts.users,
    admins: before.counts.admins,
  });

  const health = await call("/health/live");
  record("health endpoint responds", health.status === 200 && health.json?.ok === true, { status: health.status });

  const noSession = await call("/api/provider/operations");
  record("operations require a session", noSession.status === 401, { status: noSession.status });
  const forged = await call("/api/provider/operations", { cookie: "zs_session=" + "A".repeat(43) });
  record("a forged session is rejected", forged.status === 401, { status: forged.status });

  const wrongPassword = await call("/api/auth/login", { method: "POST", body: { email, password: wrong } });
  record("an invalid password is rejected", wrongPassword.status === 401, { status: wrongPassword.status });
  const unknownEmail = await call("/api/auth/login", {
    method: "POST",
    body: { email: `nobody-${Date.now()}@zalo-shared.invalid`, password: credential },
  });
  record("an unknown identity is rejected", unknownEmail.status === 401, { status: unknownEmail.status });

  const login = await call("/api/auth/login", { method: "POST", headers: { origin: base }, body: { email, password: credential } });
  const rawCookie = login.setCookie.find((entry) => entry.startsWith("zs_session="));
  if (!record("the admin authenticates", login.status === 200 && login.json?.user?.role === "admin", { status: login.status, role: login.json?.user?.role }))
    throw new Error("authentication failed");
  record("a session cookie is issued with strict flags", Boolean(rawCookie) && /HttpOnly/i.test(rawCookie) && /SameSite=Strict/i.test(rawCookie) && !/;\s*Secure/i.test(rawCookie), {
    cookieBytes: rawCookie ? rawCookie.split(";")[0].length : 0,
    httpOnly: Boolean(rawCookie && /HttpOnly/i.test(rawCookie)),
    sameSiteStrict: Boolean(rawCookie && /SameSite=Strict/i.test(rawCookie)),
    secureFlag: Boolean(rawCookie && /;\s*Secure/i.test(rawCookie)),
  });
  cookie = rawCookie.split(";")[0];
  csrf = login.json?.csrfToken;
  record("a CSRF token is issued", typeof csrf === "string" && csrf.length >= 32, { csrfBytes: csrf?.length ?? 0 });

  const me = await call("/api/auth/me", { cookie });
  record("the session resolves to the admin", me.status === 200 && me.json?.user?.role === "admin" && me.json?.csrfToken === csrf, { status: me.status, role: me.json?.user?.role });

  const noCsrf = await call("/api/provider/operations/reconcile", { method: "POST", cookie, headers: { origin: base }, body: {} });
  record("a state-changing request without CSRF is rejected", noCsrf.status === 403, { status: noCsrf.status });
  const wrongOrigin = await call("/api/provider/operations/reconcile", { method: "POST", cookie, headers: { origin: "http://127.0.0.1:9999", "x-csrf-token": csrf }, body: {} });
  record("a foreign origin is rejected", wrongOrigin.status === 403, { status: wrongOrigin.status });

  const reachable = await call("/api/provider/operations/reconcile", { method: "POST", cookie, headers: { origin: base, "x-csrf-token": csrf }, body: {} });
  record("the reconciliation route rejects a malformed body before any operation", reachable.status === 400 && reachable.json?.ok !== true, { status: reachable.status });

  const summary = await call("/api/provider/operations", { cookie });
  record("the admin reads the fenced control state", summary.status === 200 && summary.json?.owner?.phase === "uncertain" && summary.json?.reconciliationRequired === true && summary.json?.owner?.epoch === "1" && summary.json?.gapVersion === before.provider.gap_version, {
    status: summary.status,
    phase: summary.json?.owner?.phase,
    epoch: summary.json?.owner?.epoch,
    reconciliationRequired: summary.json?.reconciliationRequired,
    gapVersion: summary.json?.gapVersion,
  });

  const logout = await call("/api/auth/logout", { method: "POST", cookie, headers: { origin: base, "x-csrf-token": csrf }, body: {} });
  record("the admin logs out", logout.status === 200, { status: logout.status });
  const afterLogout = await call("/api/auth/me", { cookie });
  record("the logged-out session is invalid", afterLogout.status === 401, { status: afterLogout.status });

  const after = await snapshot();
  const stateFields = ["phase", "epoch", "owner_id", "owner_label", "fault_code", "uncertain_at", "last_fenced_owner_id", "last_fenced_epoch", "last_fenced_at"];
  record("ownership state is unchanged", stateFields.every((key) => before.ownership[key] === after.ownership[key]), {
    fields: stateFields,
  });
  const providerFields = ["status", "reconciliation_required", "gap_version", "fault_code", "last_event_at"];
  record("provider state is unchanged", providerFields.every((key) => before.provider[key] === after.provider[key]), {
    fields: providerFields,
  });
  record("no reconciliation was applied", after.counts.reconciled === 0 && after.counts.reconciled === before.counts.reconciled, {
    reconciledRows: after.counts.reconciled,
  });
  record("delivery state is unchanged", ["messages", "outbox", "delivery_parts", "provider_ledger"].every((key) => before.counts[key] === after.counts[key]), {
    messages: after.counts.messages,
    outbox: after.counts.outbox,
    deliveryParts: after.counts.delivery_parts,
    providerLedger: after.counts.provider_ledger,
  });
  record("exactly one admin remains and no session survives", after.counts.users === 1 && after.counts.admins === 1 && after.counts.other_roles === 0 && after.counts.sessions === 0, {
    users: after.counts.users,
    admins: after.counts.admins,
    otherRoles: after.counts.other_roles,
    sessions: after.counts.sessions,
  });
  const beforeActions = before.counts.actions ?? [];
  const afterActions = after.counts.actions ?? [];
  const appended = afterActions.slice(beforeActions.length);
  const prefixIntact = JSON.stringify(afterActions.slice(0, beforeActions.length)) === JSON.stringify(beforeActions);
  record("only the login and logout audit rows were appended", prefixIntact && after.counts.audit === before.counts.audit + 2 && appended.length === 2 && appended[0] === "auth.login" && appended[1] === "auth.logout" && !afterActions.includes("connector.reconciled") && !afterActions.includes("user.create"), {
    appended,
    auditBefore: before.counts.audit,
    auditAfter: after.counts.audit,
  });

  const ok = checks.every((entry) => entry.pass);
  process.stdout.write(
    `${JSON.stringify({
      ok,
      accountRef: createHash("sha256").update(email).digest("hex").slice(0, 12),
      credentialVerifies: await (async () => {
        const row = await pool.query("SELECT password_hash FROM users WHERE email=$1", [email]);
        return row.rowCount === 1 && (await checkPassword(credential, row.rows[0].password_hash));
      })(),
      checks,
      before,
      after,
    })}\n`,
  );
  if (!ok) process.exitCode = 1;
} catch (error) {
  const reason = String(error?.message || error).split(credential).join("[redacted]");
  process.stdout.write(`${JSON.stringify({ ok: false, reason: sanitize(reason), checks })}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
