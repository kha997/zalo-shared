// Read-only preflight snapshot of the pilot database for the reviewed
// reconciliation. It opens one READ ONLY transaction, reads the control rows,
// the unresolved-work predicates and the session/lock state, and prints a
// sanitized JSON report. It never writes, locks a table or calls the HTTP API.
import { createPool } from "../../dist/server/db.js";

const fail = (message) => {
  process.stderr.write(`pilot-preflight: FAIL ${message}\n`);
  process.exit(1);
};

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) fail("DATABASE_URL is required");
if (!/sslmode=verify-full/.test(databaseUrl))
  fail("DATABASE_URL must use sslmode=verify-full");

const expectedDatabase = process.env.EXPECTED_DATABASE || "zalo";
const expected = {
  phase: "uncertain",
  ownerId: process.env.EXPECTED_OWNER_ID,
  epoch: process.env.EXPECTED_OWNER_EPOCH || "5",
  gapVersion: process.env.EXPECTED_GAP_VERSION || "5",
  status: "disconnected",
  sessionFault: process.env.EXPECTED_FAULT || "shutdown",
  uncertainAtPrefix: process.env.EXPECTED_UNCERTAIN_AT || "2026-11-07T00:05:07",
  // The previously reconciled incident is retained as the fenced record, so the
  // new incident must observe exactly that pair rather than a null marker.
  lastFencedOwnerId: process.env.EXPECTED_LAST_FENCED_OWNER_ID || null,
  lastFencedEpoch: process.env.EXPECTED_LAST_FENCED_EPOCH || null,
  // One reconciliation per fenced incident: this is the third incident, so
  // exactly two earlier `connector.reconciled` rows must already exist.
  priorReconciliations: Number(process.env.EXPECTED_PRIOR_RECONCILIATIONS ?? "1"),
};
if (!expected.ownerId) fail("EXPECTED_OWNER_ID is required");

const checks = [];
const record = (name, pass, detail = {}) => {
  checks.push({ name, pass: Boolean(pass), ...detail });
  return Boolean(pass);
};

const pool = createPool(databaseUrl, { max: 1 });
let client;
try {
  client = await pool.connect();
  await client.query("BEGIN TRANSACTION READ ONLY");

  const identity = (
    await client.query(
      `SELECT current_database() AS database, current_user AS role,
              s.ssl, s.version AS tls_version, s.cipher
       FROM pg_stat_ssl s WHERE s.pid = pg_backend_pid()`,
    )
  ).rows[0];
  record("the connection is the pilot database over TLS", identity?.database === expectedDatabase && identity?.ssl === true, {
    database: identity?.database,
    role: identity?.role,
    ssl: identity?.ssl,
    tlsVersion: identity?.tls_version,
    cipher: identity?.cipher,
  });

  const ownership = (
    await client.query(
      `SELECT account_id::text, phase, epoch::text, owner_id::text, owner_label, fault_code,
              to_char(uncertain_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS uncertain_at,
              last_fenced_owner_id::text, last_fenced_epoch::text,
              to_char(last_fenced_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS last_fenced_at
       FROM connector_ownership`,
    )
  ).rows;
  record("exactly one ownership row exists", ownership.length === 1, { rows: ownership.length });
  const o = ownership[0] ?? {};

  const provider = (
    await client.query(
      `SELECT account_id::text, status, reconciliation_required, gap_version::text, fault_code,
              to_char(last_event_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS last_event_at
       FROM provider_state`,
    )
  ).rows;
  record("exactly one provider-state row exists", provider.length === 1, { rows: provider.length });
  const p = provider[0] ?? {};

  record("ownership is the expected fenced incident", o.phase === expected.phase && o.owner_id === expected.ownerId && o.epoch === expected.epoch, {
    phase: o.phase,
    ownerId: o.owner_id,
    epoch: o.epoch,
  });
  record("ownership fault and fencing fields are the expected ones", o.fault_code === expected.sessionFault && o.last_fenced_owner_id === expected.lastFencedOwnerId && o.last_fenced_epoch === expected.lastFencedEpoch && String(o.uncertain_at ?? "").startsWith(expected.uncertainAtPrefix), {
    faultCode: o.fault_code,
    uncertainAt: o.uncertain_at,
    lastFencedOwnerId: o.last_fenced_owner_id,
    lastFencedEpoch: o.last_fenced_epoch,
  });
  record("provider state still requires reconciliation", p.status === expected.status && p.reconciliation_required === true && p.gap_version === expected.gapVersion && p.fault_code === expected.sessionFault, {
    status: p.status,
    reconciliationRequired: p.reconciliation_required,
    gapVersion: p.gap_version,
    faultCode: p.fault_code,
    lastEventAt: p.last_event_at,
  });
  record("both control rows belong to the same account", o.account_id === p.account_id, {
    accountId: o.account_id,
  });

  const identities = (
    await client.query(
      `SELECT (SELECT count(*)::int FROM users) AS users,
              (SELECT count(*)::int FROM users WHERE role='admin' AND active) AS admins,
              (SELECT count(*)::int FROM users WHERE role<>'admin') AS other_roles,
              (SELECT count(*)::int FROM sessions) AS sessions`,
    )
  ).rows[0];
  record("exactly one active admin and no session exists", identities.users === 1 && identities.admins === 1 && identities.other_roles === 0 && identities.sessions === 0, identities);

  const unresolved = (
    await client.query(
      `SELECT
        (SELECT count(*)::int FROM provider_events WHERE account_id=$1 AND (state='held' OR variant_overflow OR variant_evidence_missing OR (conflict AND resolved_at IS NULL))) AS events,
        (SELECT count(*)::int FROM provider_media_jobs WHERE account_id=$1 AND status IN ('held','pending','processing')) AS media,
        (SELECT count(*)::int FROM outbox b JOIN messages m ON m.id=b.message_id JOIN conversations c ON c.id=m.conversation_id WHERE c.account_id=$1 AND (b.status IN ('pending','processing','unknown') OR m.status IN ('pending','processing','unknown'))) AS dispatchable,
        (SELECT count(*)::int FROM delivery_parts dp JOIN messages m ON m.id=dp.message_id JOIN conversations c ON c.id=m.conversation_id WHERE c.account_id=$1 AND dp.status IN ('pending','processing','unknown')) AS parts`,
      [o.account_id],
    )
  ).rows[0];
  record("no unresolved provider, message or delivery work exists", Object.values(unresolved).every((value) => value === 0), unresolved);

  const counts = (
    await client.query(
      `SELECT (SELECT count(*)::int FROM messages) AS messages,
              (SELECT count(*)::int FROM outbox) AS outbox,
              (SELECT count(*)::int FROM delivery_parts) AS delivery_parts,
              (SELECT count(*)::int FROM provider_events) AS provider_events,
              (SELECT count(*)::int FROM provider_event_variants) AS provider_event_variants,
              (SELECT count(*)::int FROM provider_media_jobs) AS provider_media_jobs,
              (SELECT count(*)::int FROM provider_ledger) AS provider_ledger,
              (SELECT count(*)::int FROM pilot_send_budget) AS pilot_send_budget,
              (SELECT count(*)::int FROM pilot_part_ledger) AS pilot_part_ledger,
              (SELECT count(*)::int FROM attachments) AS attachments,
              (SELECT count(*)::int FROM conversations) AS conversations`,
    )
  ).rows[0];
  record("all message, delivery and provider tables are empty", Object.values(counts).every((value) => value === 0), counts);

  const audit = (
    await client.query(
      `SELECT count(*)::int AS rows,
              (SELECT count(*)::int FROM audit WHERE action='connector.reconciled') AS reconciled,
              (SELECT json_agg(action ORDER BY id) FROM audit) AS actions,
              (SELECT max(id) FROM audit) AS max_id
       FROM audit`,
    )
  ).rows[0];
  const actions = audit.actions ?? [];
  record("the expected number of prior reconciliation records exists", audit.reconciled === expected.priorReconciliations, { reconciled: audit.reconciled, expected: expected.priorReconciliations, auditRows: audit.rows });
  record("the incident audit prefix is preserved", actions[0] === "connector.reserved" && actions[1] === "connector.uncertain", {
    firstActions: actions.slice(0, 4),
    lastActions: actions.slice(-4),
    auditRows: audit.rows,
    maxAuditId: audit.max_id,
  });

  const concurrency = (
    await client.query(
      `SELECT (SELECT count(*)::int FROM pg_locks WHERE locktype='advisory') AS advisory_locks,
              (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()) AS other_sessions`,
    )
  ).rows[0];
  record("no advisory lock and no other database session exists", concurrency.advisory_locks === 0 && concurrency.other_sessions === 0, concurrency);

  await client.query("ROLLBACK");

  const ok = checks.every((entry) => entry.pass);
  process.stdout.write(
    `${JSON.stringify({
      ok,
      database: identity.database,
      tls: { ssl: identity.ssl, version: identity.tls_version, cipher: identity.cipher },
      ownership: {
        phase: o.phase,
        ownerId: o.owner_id,
        epoch: o.epoch,
        ownerLabel: o.owner_label,
        faultCode: o.fault_code,
        uncertainAt: o.uncertain_at,
        lastFencedOwnerId: o.last_fenced_owner_id,
        lastFencedEpoch: o.last_fenced_epoch,
        lastFencedAt: o.last_fenced_at,
      },
      provider: {
        status: p.status,
        reconciliationRequired: p.reconciliation_required,
        gapVersion: p.gap_version,
        faultCode: p.fault_code,
        lastEventAt: p.last_event_at,
      },
      identities,
      unresolved,
      counts,
      audit,
      concurrency,
      checks,
    })}\n`,
  );
  if (!ok) process.exitCode = 1;
} catch (error) {
  const reason = String(error?.message || error)
    .split(databaseUrl)
    .join("[redacted]");
  process.stdout.write(`${JSON.stringify({ ok: false, reason: reason.slice(0, 300), checks })}\n`);
  process.exitCode = 1;
} finally {
  client?.release();
  await pool.end();
}
