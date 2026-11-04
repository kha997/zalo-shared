// One-shot executor for the Owner-authorized reconciliation of the failed
// G5-A bootstrap.
//
// It refuses to run before or after the supplied UTC window (after expiry the
// outcome is `expired` and the authorization is spent), holds a session-level
// advisory single-flight lock so two drivers can never race, re-checks the
// fenced incident and the unresolved-work predicates, authenticates the pilot
// admin through the reviewed HTTP surface, invokes POST /api/provider/
// operations/reconcile exactly once with the incident-bound body, then verifies
// the resulting state through a separate read-only connection. It never retries
// a POST, never replays a request id it did not create, never prints a
// credential, and exits non-zero on any mismatch.
import { readFileSync } from "node:fs";
import { createPool } from "../../dist/server/db.js";

const startedAt = new Date().toISOString();
const say = (payload) => process.stdout.write(`${JSON.stringify(payload)}\n`);
const result = (outcome, exitCode, extra = {}) => {
  say({ ok: exitCode === 0, outcome, startedAt, finishedAt: new Date().toISOString(), ...extra });
  process.exitCode = exitCode;
  return exitCode;
};
const redact = (value, secrets) => {
  let text = String(value?.message ?? value ?? "");
  for (const secret of secrets) if (secret) text = text.split(secret).join("[redacted]");
  return text.replace(/[\r\n]/g, " ").slice(0, 300);
};

const required = [
  "PILOT_ADMIN_CREDENTIAL_FILE",
  "PILOT_ADMIN_BASE_URL",
  "DATABASE_URL",
  "PILOT_RECONCILE_EXPECTED_OWNER_ID",
  "PILOT_RECONCILE_EXPECTED_EPOCH",
  "PILOT_RECONCILE_EXPECTED_GAP",
  "PILOT_RECONCILE_REQUEST_ID",
  "PILOT_RECONCILE_NOT_BEFORE",
  "PILOT_RECONCILE_NOT_AFTER",
];
for (const key of required) {
  if (!process.env[key]) {
    process.stderr.write(`reconcile-pilot: FAIL ${key} is required\n`);
    process.exit(3);
  }
}
if (process.env.PILOT_RECONCILE_CONFIRM !== "ONE_SHOT") {
  process.stderr.write("reconcile-pilot: FAIL PILOT_RECONCILE_CONFIRM=ONE_SHOT is required\n");
  process.exit(3);
}

const databaseUrl = process.env.DATABASE_URL;
const credentialFile = process.env.PILOT_ADMIN_CREDENTIAL_FILE;
const evidenceRef = process.env.PILOT_RECONCILE_EVIDENCE_REF || "G5A-BOOTSTRAP-REPORT.md#9";
const requestId = process.env.PILOT_RECONCILE_REQUEST_ID;
const expectedOwnerId = process.env.PILOT_RECONCILE_EXPECTED_OWNER_ID;
const expectedEpoch = process.env.PILOT_RECONCILE_EXPECTED_EPOCH;
const expectedGap = process.env.PILOT_RECONCILE_EXPECTED_GAP;
const expectedDatabase = process.env.PILOT_RECONCILE_EXPECTED_DATABASE || "zalo";
const disposable = process.env.PILOT_RECONCILE_DISPOSABLE === "1";
const notBefore = Date.parse(process.env.PILOT_RECONCILE_NOT_BEFORE);
const notAfter = Date.parse(process.env.PILOT_RECONCILE_NOT_AFTER);

const fail = (message) => {
  process.stderr.write(`reconcile-pilot: FAIL ${message}\n`);
  process.exit(3);
};
const counter = (value) => /^(0|[1-9][0-9]{0,18})$/.test(value);
const uuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

if (!/sslmode=verify-full/.test(databaseUrl) && !disposable)
  fail("DATABASE_URL must use sslmode=verify-full");
if (!counter(expectedEpoch) || !counter(expectedGap) || !uuid(expectedOwnerId) || !uuid(requestId))
  fail("the expected incident values are malformed");
if (!/^[A-Za-z0-9][A-Za-z0-9_. /#-]*$/.test(evidenceRef) || evidenceRef.length > 256)
  fail("PILOT_RECONCILE_EVIDENCE_REF is malformed");
if (!Number.isFinite(notBefore) || !Number.isFinite(notAfter) || notAfter <= notBefore)
  fail("PILOT_RECONCILE_NOT_BEFORE/NOT_AFTER are malformed");
if (disposable && expectedDatabase === "zalo") fail("a disposable run must not name the pilot database");
if (!disposable && expectedDatabase !== "zalo") fail("a non-disposable run is confined to the pilot database");

let baseUrl;
try {
  baseUrl = new URL(process.env.PILOT_ADMIN_BASE_URL);
} catch {
  fail("PILOT_ADMIN_BASE_URL is not a URL");
}
if (!["127.0.0.1", "localhost", "[::1]"].includes(baseUrl.hostname))
  fail("PILOT_ADMIN_BASE_URL must be loopback; the credential is never sent elsewhere");
const base = baseUrl.origin;

const readCredential = (key) => {
  const line = readFileSync(credentialFile, "utf8")
    .split("\n")
    .find((entry) => entry.startsWith(`${key}=`));
  if (!line) fail(`${key} is missing from the credential file`);
  return line.slice(key.length + 1);
};

const now = Date.now();
if (now < notBefore) {
  result("outside-window", 2, {
    now: new Date(now).toISOString(),
    notBefore: new Date(notBefore).toISOString(),
    notAfter: new Date(notAfter).toISOString(),
    message: "the authorized window has not opened; no session was opened and no request was sent",
  });
  process.exit(2);
}
if (now >= notAfter) {
  result("expired", 2, {
    now: new Date(now).toISOString(),
    notBefore: new Date(notBefore).toISOString(),
    notAfter: new Date(notAfter).toISOString(),
    token: "G5A_RECONCILIATION_AUTHORIZATION_EXPIRED",
    message: "the authorized window expired; nothing was started, sent or executed late",
  });
  process.exit(2);
}

const checks = [];
const record = (name, pass, detail = {}) => {
  checks.push({ name, pass: Boolean(pass), ...detail });
  return Boolean(pass);
};

const unresolvedQuery = `SELECT
  (SELECT count(*)::int FROM provider_events WHERE account_id=$1 AND (state='held' OR variant_overflow OR variant_evidence_missing OR (conflict AND resolved_at IS NULL))) AS events,
  (SELECT count(*)::int FROM provider_media_jobs WHERE account_id=$1 AND status IN ('held','pending','processing')) AS media,
  (SELECT count(*)::int FROM outbox b JOIN messages m ON m.id=b.message_id JOIN conversations c ON c.id=m.conversation_id WHERE c.account_id=$1 AND (b.status IN ('pending','processing','unknown') OR m.status IN ('pending','processing','unknown'))) AS dispatchable,
  (SELECT count(*)::int FROM delivery_parts dp JOIN messages m ON m.id=dp.message_id JOIN conversations c ON c.id=m.conversation_id WHERE c.account_id=$1 AND dp.status IN ('pending','processing','unknown')) AS parts`;
const controlQuery = `SELECT o.account_id::text,o.phase,o.owner_id::text,o.epoch::text,o.owner_label,o.fault_code,
  to_char(o.uncertain_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS uncertain_at,
  o.last_fenced_owner_id::text,o.last_fenced_epoch::text,
  to_char(o.last_fenced_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS last_fenced_at,
  s.status,s.reconciliation_required,s.gap_version::text,s.fault_code provider_fault,
  to_char(s.last_event_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS last_event_at
 FROM connector_ownership o JOIN provider_state s ON s.account_id=o.account_id`;
const countsQuery = `SELECT
  (SELECT count(*)::int FROM users) AS users,
  (SELECT count(*)::int FROM users WHERE role='admin' AND active) AS admins,
  (SELECT count(*)::int FROM sessions) AS sessions,
  (SELECT count(*)::int FROM messages) AS messages,
  (SELECT count(*)::int FROM outbox) AS outbox,
  (SELECT count(*)::int FROM delivery_parts) AS delivery_parts,
  (SELECT count(*)::int FROM provider_events) AS provider_events,
  (SELECT count(*)::int FROM provider_event_variants) AS provider_event_variants,
  (SELECT count(*)::int FROM provider_media_jobs) AS provider_media_jobs,
  (SELECT count(*)::int FROM provider_ledger) AS provider_ledger,
  (SELECT count(*)::int FROM pilot_send_budget) AS pilot_send_budget,
  (SELECT count(*)::int FROM pilot_part_ledger) AS pilot_part_ledger,
  (SELECT count(*)::int FROM attachments) AS attachments,
  (SELECT count(*)::int FROM conversations) AS conversations,
  (SELECT count(*)::int FROM audit WHERE action='connector.reconciled') AS reconciled`;

const call = async (path, { method = "GET", headers = {}, body, cookie } = {}) => {
  const h = { ...headers };
  if (cookie) h.cookie = cookie;
  let payload;
  if (body !== undefined) {
    h["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const response = await fetch(base + path, {
    method,
    headers: h,
    body: payload,
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  return {
    status: response.status,
    json,
    setCookie: response.headers.getSetCookie?.() ?? [],
  };
};

const email = readCredential("PILOT_ADMIN_EMAIL");
const credential = readCredential("PILOT_ADMIN_PASSWORD");
const secrets = [credential];
let cookie = null;
let csrf = null;
let pool;
let separatePool;
let lockPool;
let lockClient;
let lockPid;
try {
  lockPool = createPool(databaseUrl, { max: 1 });
  lockClient = await lockPool.connect();
  const lock = (
    await lockClient.query("SELECT pg_try_advisory_lock(73003,1) AS got, pg_backend_pid() AS pid")
  ).rows[0];
  lockPid = lock.pid;
  if (!lock.got) {
    result("concurrent-invocation", 3, {
      message: "another reconciliation driver holds the single-flight lock; nothing was sent",
    });
    lockClient.release();
    await lockPool.end();
    process.exit(3);
  }

  pool = createPool(databaseUrl, { max: 1 });
  const client = await pool.connect();
  await client.query("BEGIN TRANSACTION READ ONLY");
  const identity = (
    await client.query(
      `SELECT current_database() AS database, s.ssl FROM pg_stat_ssl s WHERE s.pid = pg_backend_pid()`,
    )
  ).rows[0];
  const control = (await client.query(controlQuery)).rows[0];
  const counts = (await client.query(countsQuery)).rows[0];
  const unresolved = (await client.query(unresolvedQuery, [control?.account_id])).rows[0];
  const concurrency = (
    await client.query(
      `SELECT (SELECT count(*)::int FROM pg_locks WHERE locktype='advisory' AND pid<>$1) AS advisory_locks,
              (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND pid<>$1 AND state='active') AS other_active_sessions`,
      [lockPid],
    )
  ).rows[0];
  const prior = (
    await client.query(
      "SELECT count(*)::int AS n FROM audit WHERE action='connector.reconciled' AND metadata->>'requestId'=$1",
      [requestId],
    )
  ).rows[0].n;
  await client.query("ROLLBACK");
  client.release();

  record("the connection is the expected database over TLS", identity?.database === expectedDatabase && (identity?.ssl === true || disposable), {
    database: identity?.database,
    ssl: identity?.ssl,
  });
  record("the ownership row is the expected fenced incident", control?.phase === "uncertain" && control?.owner_id === expectedOwnerId && control?.epoch === expectedEpoch, {
    phase: control?.phase,
    ownerId: control?.owner_id,
    epoch: control?.epoch,
    faultCode: control?.fault_code,
  });
  record("the provider state still requires reconciliation", control?.status === "disconnected" && control?.reconciliation_required === true && control?.gap_version === expectedGap, {
    status: control?.status,
    reconciliationRequired: control?.reconciliation_required,
    gapVersion: control?.gap_version,
    faultCode: control?.provider_fault,
  });
  record("no unresolved provider, message or delivery work exists", Object.values(unresolved ?? {}).every((value) => value === 0), unresolved);
  record("at least one active admin exists and no session is open", counts.admins >= 1 && counts.sessions === 0, {
    users: counts.users,
    admins: counts.admins,
    sessions: counts.sessions,
  });
  record("this request id has not been used before", prior === 0, { priorReconcileRows: prior });
  record("no advisory lock and no other active database session exists", concurrency.advisory_locks === 0 && concurrency.other_active_sessions === 0, concurrency);
  if (!checks.every((entry) => entry.pass))
    result("precondition-failed", 3, { checks, preState: { control, counts, unresolved, concurrency } });
  else {
    const login = await call("/api/auth/login", {
      method: "POST",
      headers: { origin: base },
      body: { email, password: credential },
    });
    const rawCookie = login.setCookie.find((entry) => entry.startsWith("zs_session="));
    if (!record("the pilot admin authenticates", login.status === 200 && login.json?.user?.role === "admin", { status: login.status, role: login.json?.user?.role }))
      throw new Error("authentication failed");
    cookie = rawCookie.split(";")[0];
    csrf = login.json?.csrfToken;
    record("a CSRF token is issued", typeof csrf === "string" && csrf.length >= 32, { csrfBytes: csrf?.length ?? 0 });

    const me = await call("/api/auth/me", { cookie });
    record("the session resolves to the admin", me.status === 200 && me.json?.user?.role === "admin", { status: me.status });

    const summary = await call("/api/provider/operations", { cookie });
    record("the route reports the exact incident", summary.status === 200 && summary.json?.owner?.phase === "uncertain" && summary.json?.owner?.epoch === expectedEpoch && summary.json?.gapVersion === expectedGap && summary.json?.reconciliationRequired === true, {
      status: summary.status,
      phase: summary.json?.owner?.phase,
      epoch: summary.json?.owner?.epoch,
      gapVersion: summary.json?.gapVersion,
      reconciliationRequired: summary.json?.reconciliationRequired,
    });

    const body = {
      requestId,
      expectedOwnerId,
      expectedOwnerEpoch: expectedEpoch,
      expectedGapVersion: expectedGap,
      evidenceRef,
      confirmOwnerApproved: true,
      localState: { sessionFile: "absent", quarantine: "absent" },
    };
    let applied = null;
    let postStatus = null;
    let transportUnknown = false;
    try {
      const response = await call("/api/provider/operations/reconcile", {
        method: "POST",
        headers: { origin: base, "x-csrf-token": csrf },
        body,
        cookie,
      });
      postStatus = response.status;
      applied = response;
    } catch (error) {
      transportUnknown = true;
      record("the single reconciliation request returned a response", false, { reason: redact(error, secrets) });
    }

    const logout = await call("/api/auth/logout", {
      method: "POST",
      headers: { origin: base, "x-csrf-token": csrf },
      body: {},
      cookie,
    });
    record("the admin session is closed", logout.status === 200, { status: logout.status });
    const afterLogout = await call("/api/auth/me", { cookie });
    record("the closed session is invalid", afterLogout.status === 401, { status: afterLogout.status });
    cookie = null;
    await pool.end();
    pool = null;

    separatePool = createPool(databaseUrl, { max: 1 });
    const verifyClient = await separatePool.connect();
    await verifyClient.query("BEGIN TRANSACTION READ ONLY");
    const after = (await verifyClient.query(controlQuery)).rows[0];
    const afterCounts = (await verifyClient.query(countsQuery)).rows[0];
    const reconciled = (
      await verifyClient.query(
        `SELECT id::text,metadata FROM audit WHERE action='connector.reconciled' AND metadata->>'requestId'=$1 ORDER BY id DESC LIMIT 1`,
        [requestId],
      )
    ).rows;
    const afterConcurrency = (
      await verifyClient.query(
        `SELECT (SELECT count(*)::int FROM pg_locks WHERE locktype='advisory' AND pid<>$1) AS advisory_locks,
                (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND pid<>$1 AND state='active') AS other_active_sessions`,
        [lockPid],
      )
    ).rows[0];
    const afterPrior = (
      await verifyClient.query(
        "SELECT count(*)::int AS n FROM audit WHERE action='connector.reconciled' AND metadata->>'requestId'=$1",
        [requestId],
      )
    ).rows[0].n;
    await verifyClient.query("ROLLBACK");
    verifyClient.release();

    const appliedOk = applied?.status === 200 && applied?.json?.ok === true && String(applied?.json?.epoch) === (BigInt(expectedEpoch) + 1n).toString() && String(applied?.json?.gapVersion) === (BigInt(expectedGap) + 1n).toString() && applied?.json?.alreadyApplied === false;
    record("the single request applied the reviewed transition", appliedOk, {
      status: applied?.status ?? null,
      epoch: applied?.json?.epoch ?? null,
      gapVersion: applied?.json?.gapVersion ?? null,
      alreadyApplied: applied?.json?.alreadyApplied ?? null,
      transportUnknown,
    });

    const meta = reconciled[0]?.metadata;
    const stateChecks = [
      record("the ownership row is idle with the incident fenced", after?.phase === "idle" && after?.owner_id === null && after?.owner_label === null && after?.uncertain_at === null && after?.fault_code === null && after?.epoch === (BigInt(expectedEpoch) + 1n).toString() && after?.last_fenced_owner_id === expectedOwnerId && after?.last_fenced_epoch === expectedEpoch && after?.last_fenced_at !== null, {
        phase: after?.phase,
        ownerId: after?.owner_id,
        epoch: after?.epoch,
        faultCode: after?.fault_code,
        lastFencedOwnerId: after?.last_fenced_owner_id,
        lastFencedEpoch: after?.last_fenced_epoch,
        lastFencedAt: after?.last_fenced_at,
      }),
      record("the provider state no longer requires reconciliation", after?.status === "disconnected" && after?.reconciliation_required === false && after?.gap_version === (BigInt(expectedGap) + 1n).toString() && after?.provider_fault === null, {
        status: after?.status,
        reconciliationRequired: after?.reconciliation_required,
        gapVersion: after?.gap_version,
        faultCode: after?.provider_fault,
      }),
      record("exactly one reconciliation audit record carries this request", afterPrior === 1 && Boolean(meta) && meta.ownerId === expectedOwnerId && meta.epochBefore === expectedEpoch && meta.epochAfter === after?.epoch && meta.gapVersionBefore === expectedGap && meta.gapVersionAfter === after?.gap_version && meta.evidenceRef === evidenceRef && meta.faultCode === control?.fault_code && meta.providerFault === control?.provider_fault, {
        reconciledRows: afterPrior,
        auditId: reconciled[0]?.id ?? null,
        evidenceRef: meta?.evidenceRef ?? null,
        metadata: meta
          ? {
              ownerId: meta.ownerId,
              epochBefore: meta.epochBefore,
              epochAfter: meta.epochAfter,
              gapVersionBefore: meta.gapVersionBefore,
              gapVersionAfter: meta.gapVersionAfter,
              faultCode: meta.faultCode,
              providerFault: meta.providerFault,
              localSessionFile: meta.localSessionFile,
              localQuarantine: meta.localQuarantine,
            }
          : null,
      }),
      (() => {
        const unchanged = ["messages", "outbox", "delivery_parts", "provider_events", "provider_event_variants", "provider_media_jobs", "provider_ledger", "pilot_send_budget", "pilot_part_ledger", "attachments", "conversations"];
        return record("message, delivery and provider state are unchanged", unchanged.every((key) => afterCounts[key] === counts[key]), {
          before: Object.fromEntries(unchanged.map((key) => [key, counts[key]])),
          after: Object.fromEntries(unchanged.map((key) => [key, afterCounts[key]])),
        });
      })(),
      record("the identity state is unchanged and no session survives", afterCounts.users === counts.users && afterCounts.admins === counts.admins && afterCounts.sessions === 0, {
        users: afterCounts.users,
        admins: afterCounts.admins,
        sessions: afterCounts.sessions,
      }),
      record("no advisory lock and no connector session is left", afterConcurrency.advisory_locks === 0 && afterConcurrency.other_active_sessions === 0, afterConcurrency),
    ];
    const stateOk = stateChecks.every(Boolean);
    const notApplied =
      after?.phase === "uncertain" &&
      after?.owner_id === expectedOwnerId &&
      after?.epoch === expectedEpoch &&
      after?.reconciliation_required === true &&
      after?.gap_version === expectedGap &&
      afterPrior === 0;
    let outcome;
    let code;
    if (appliedOk && stateOk) {
      outcome = "reconciled";
      code = 0;
    } else if (stateOk && transportUnknown) {
      outcome = "reconciled-after-unknown-response";
      code = 0;
    } else if (!appliedOk && notApplied) {
      outcome = "not-applied";
      code = 1;
    } else {
      outcome = "failed";
      code = 1;
    }
    result(outcome, code, {
      requestId,
      evidenceRef,
      expected: { ownerId: expectedOwnerId, epoch: expectedEpoch, gapVersion: expectedGap },
      identity: { database: identity?.database, ssl: identity?.ssl },
      responseStatus: postStatus,
      response: applied?.json ?? null,
      preState: { control, counts, unresolved, concurrency, priorReconcileRows: prior },
      postState: { control: after, counts: afterCounts, reconciledRows: afterPrior, concurrency: afterConcurrency },
      checks,
      note: "no retry and no replay were performed",
    });
  }
} catch (error) {
  if (cookie && csrf) {
    await call("/api/auth/logout", {
      method: "POST",
      headers: { origin: base, "x-csrf-token": csrf },
      body: {},
      cookie,
    }).catch(() => {});
  }
  say({ ok: false, outcome: "failed", reason: redact(error, secrets), checks });
  process.exitCode = 1;
} finally {
  await pool?.end().catch(() => {});
  await separatePool?.end().catch(() => {});
  try {
    await lockClient?.query("SELECT pg_advisory_unlock(73003,1)");
  } catch {}
  lockClient?.release();
  await lockPool?.end().catch(() => {});
}
