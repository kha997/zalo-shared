import type pg from "pg";
import { ACCOUNT } from "./db.js";
import type { PilotGrant } from "./pilot-policy.js";

const unavailable = () => new Error("Pilot send budget unavailable");
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const timestamp = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
const peer = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const peerIds = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length >= 1 &&
  value.length <= 4 &&
  value.every(peer) &&
  new Set(value).size === value.length;
const day = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value + "T00:00:00.000Z"));

/**
 * A reservation is consumed before external dispatch. `"already-reserved"`
 * means budget was previously consumed for this exact part; it must never be
 * treated as permission for an automatic resend.
 */
export type PilotReservation = Readonly<{
  status: "reserved" | "already-reserved";
}>;

/** Caller transaction marker; a session-level setting would survive outside BEGIN. */
async function requireTransaction(db: pg.PoolClient) {
  // pg_current_xact_id() assigns an xid for the current transaction. Outside an
  // explicit transaction the assignment ends with the implicit statement, so
  // backend_xid is NULL by the next statement even if a session GUC is spoofed.
  await db.query("SELECT pg_current_xact_id()");
  const open = (
    await db.query(
      "SELECT backend_xid IS NOT NULL AS open FROM pg_stat_activity WHERE pid=pg_backend_pid()",
    )
  ).rows[0]?.open;
  if (open !== true) throw unavailable();
}

/**
 * Reserves one externally entered part before dispatch. The caller must already
 * hold a transaction. Reservations are idempotent per message/part, never
 * refunded and never reset by restart, day rollover or a new grant.
 */
export async function reservePilotPart(
  db: pg.PoolClient,
  grant: PilotGrant,
  input: { messageId: string; part: number; peerId: string; threadType: 0 },
): Promise<PilotReservation> {
  const grantId = grant?.grantId;
  const issuedAt = grant?.issuedAt;
  const expiresAt = grant?.expiresAt;
  const maxPartsPerDay = grant?.maxPartsPerDay;
  const minIntervalMs = grant?.minIntervalMs;
  const allowedPeerIds =
    grant && Array.isArray(grant.allowedPeerIds)
      ? [...grant.allowedPeerIds]
      : undefined;
  const messageId = input?.messageId;
  const part = input?.part;
  const peerId = input?.peerId;
  try {
    if (
      !grant ||
      grant.version !== 1 ||
      grant.purpose !== "send-test" ||
      !peer(grantId) ||
      !peer(grant.ownerConsentRef) ||
      !peer(grant.expectedAccountId) ||
      !timestamp(issuedAt) ||
      !timestamp(expiresAt) ||
      !peerIds(allowedPeerIds) ||
      typeof maxPartsPerDay !== "number" ||
      !Number.isInteger(maxPartsPerDay) ||
      maxPartsPerDay < 1 ||
      maxPartsPerDay > 30 ||
      typeof minIntervalMs !== "number" ||
      !Number.isInteger(minIntervalMs) ||
      minIntervalMs < 2000 ||
      minIntervalMs > 60000 ||
      !input ||
      !uuid(messageId) ||
      typeof part !== "number" ||
      !Number.isInteger(part) ||
      part < 0 ||
      part > 10000 ||
      !peer(peerId) ||
      input.threadType !== 0 ||
      !allowedPeerIds.includes(peerId)
    )
      throw unavailable();
    await requireTransaction(db);
    await db.query("SELECT pg_advisory_xact_lock(73007,1)");
    const state = (
      await db.query(
        "SELECT clock_timestamp() AS now,(clock_timestamp() AT TIME ZONE 'utc')::date::text AS day",
      )
    ).rows[0];
    const clock = state?.now;
    const currentDay = state?.day;
    if (!(clock instanceof Date) || !Number.isFinite(clock.getTime()))
      throw unavailable();
    if (!day(currentDay)) throw unavailable();
    const issued = Date.parse(issuedAt);
    const expires = Date.parse(expiresAt);
    if (issued > clock.getTime() + 30_000 || expires <= clock.getTime())
      throw unavailable();
    const prior = (
      await db.query(
        `SELECT l.account_id,l.peer_id,p.status FROM pilot_part_ledger l
           JOIN delivery_parts p ON p.message_id=l.message_id AND p.part=l.part
          WHERE l.message_id=$1 AND l.part=$2`,
        [messageId, part],
      )
    ).rows[0];
    if (prior) {
      // A verified repeat consumes nothing further. Accepted or ambiguous
      // work must never look like a fresh reservation. `processing` is the
      // caller's own in-flight part marked just before this admission check,
      // so it is still a repeat rather than new permission to egress.
      if (
        prior.account_id !== ACCOUNT ||
        prior.peer_id !== peerId ||
        (prior.status !== "pending" && prior.status !== "processing")
      )
        throw unavailable();
      return Object.freeze({ status: "already-reserved" as const });
    }
    if (
      !(
        await db.query(
          `SELECT 1 FROM delivery_parts p
             JOIN messages m ON m.id=p.message_id
             JOIN conversations c ON c.id=m.conversation_id
            WHERE p.message_id=$1 AND p.part=$2 AND c.account_id=$3
              AND m.direction='outbound' AND c.provider_thread_type=0
              AND c.provider_thread_id=$4 AND p.status IN ('pending','processing')`,
          [messageId, part, ACCOUNT, peerId],
        )
      ).rowCount
    )
      throw unavailable();
    const budget = (
      await db.query(
        `INSERT INTO pilot_send_budget(account_id,day,max_parts)
         VALUES($1,$2,$3)
         ON CONFLICT(account_id,day) DO UPDATE
           SET max_parts=LEAST(pilot_send_budget.max_parts,EXCLUDED.max_parts)
         RETURNING max_parts,reserved_parts`,
        [ACCOUNT, currentDay, maxPartsPerDay],
      )
    ).rows[0];
    if (!budget) throw unavailable();
    // The interval is global to the account, not per day: a UTC-midnight
    // rollover must not create a burst window.
    const lastReserved = (
      await db.query(
        "SELECT max(last_reserved_at) AS last FROM pilot_send_budget WHERE account_id=$1",
        [ACCOUNT],
      )
    ).rows[0]?.last;
    if (lastReserved != null) {
      const last = new Date(lastReserved).getTime();
      if (
        !Number.isFinite(last) ||
        last > clock.getTime() ||
        clock.getTime() - last < minIntervalMs
      )
        throw unavailable();
    }
    if (
      !Number.isInteger(budget.reserved_parts) ||
      !Number.isInteger(budget.max_parts) ||
      budget.reserved_parts >= budget.max_parts
    )
      throw unavailable();
    if (
      !(
        await db.query(
          "UPDATE pilot_send_budget SET reserved_parts=reserved_parts+1,last_reserved_at=$3 WHERE account_id=$1 AND day=$2 AND reserved_parts<max_parts",
          [ACCOUNT, currentDay, clock],
        )
      ).rowCount
    )
      throw unavailable();
    await db.query(
      "INSERT INTO pilot_part_ledger(account_id,day,message_id,part,grant_id,peer_id,reserved_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [ACCOUNT, currentDay, messageId, part, grantId, peerId, clock],
    );
    await db.query(
      "INSERT INTO audit(account_id,action,target_id,metadata) VALUES($1,'pilot.part_reserved',$2,$3)",
      [ACCOUNT, messageId, { grantId, part, day: currentDay }],
    );
    return Object.freeze({ status: "reserved" as const });
  } catch {
    throw unavailable();
  }
}
