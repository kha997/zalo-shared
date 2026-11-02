import type pg from "pg";
import { ACCOUNT } from "./db.js";
import type { OwnershipHandle } from "./connector-ownership.js";

export interface MediaRetentionOptions {
  owner: OwnershipHandle;
  /** Default 24h; hard ceiling 7 days. */
  retentionMs?: number;
  /** Bounded rows per run. */
  maxJobs?: number;
}

export interface MediaRetentionResult {
  expired: number;
}

const MAX_VERSION = 9223372036854775807n;
const DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1000;
const MIN_RETENTION_MS = 60 * 60 * 1000;
const MAX_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const unavailable = () => new Error("Private media retention unavailable");
const uuid = (x: unknown): x is string =>
  typeof x === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(x);
const version = (x: unknown): x is string =>
  typeof x === "string" &&
  /^(0|[1-9][0-9]{0,18})$/.test(x) &&
  BigInt(x) <= MAX_VERSION;

/**
 * Erases expired encrypted locator envelopes without deleting job metadata or
 * touching messages/outbox. Ownership is revalidated inside the transaction;
 * restored/changed rows are skipped by version-independent status filters.
 */
export async function expireMediaLocators(
  pool: pg.Pool,
  options: MediaRetentionOptions,
): Promise<MediaRetentionResult> {
  let db: pg.PoolClient | undefined;
  let released = false;
  const retention = options?.retentionMs ?? DEFAULT_RETENTION_MS;
  const maxJobs = options?.maxJobs ?? 100;
  const owner = options?.owner;
  if (
    !owner?.admitted ||
    owner.token?.accountId !== ACCOUNT ||
    !uuid(owner.token?.ownerId) ||
    !version(owner.token?.epoch) ||
    typeof owner.assertCurrent !== "function" ||
    !Number.isInteger(retention) ||
    retention < MIN_RETENTION_MS ||
    retention > MAX_RETENTION_MS ||
    !Number.isInteger(maxJobs) ||
    maxJobs < 1 ||
    maxJobs > 500
  )
    throw unavailable();
  try {
    await owner.assertCurrent();
    if (!owner.admitted) throw unavailable();
    db = await pool.connect();
    await db.query("BEGIN");
    await db.query("SET LOCAL statement_timeout='2000ms'");
    const owned = (
      await db.query(
        "SELECT account_id FROM connector_ownership WHERE account_id=$1 AND owner_id=$2 AND epoch=$3 AND phase='active' FOR SHARE",
        [ACCOUNT, owner.token.ownerId, owner.token.epoch],
      )
    ).rowCount;
    if (!owned) throw unavailable();
    // A held transaction also prevents a second maintenance run from racing.
    if (
      !(
        await db.query("SELECT pg_try_advisory_xact_lock(73006) AS locked")
      ).rows[0]?.locked
    ) {
      await db.query("ROLLBACK");
      return { expired: 0 };
    }
    const updated = (
      await db.query(
        `UPDATE provider_media_jobs SET
          status='unavailable',error_code='expired',locator_envelope=NULL,claimed_at=NULL,
          version=CASE WHEN version<9223372036854775807 THEN version+1 ELSE version END
         WHERE id IN (
          SELECT id FROM provider_media_jobs
          WHERE account_id=$1 AND locator_envelope IS NOT NULL
           AND status IN ('pending','processing','held','unavailable')
           AND created_at<=now()-make_interval(secs=>$2)
          ORDER BY created_at,id LIMIT $3 FOR UPDATE SKIP LOCKED
         )
         RETURNING id,version`,
        [ACCOUNT, retention / 1000, maxJobs],
      )
    ).rows;
    for (const row of updated) {
      if (!uuid(row.id) || !version(row.version)) throw unavailable();
      await db.query(
        "INSERT INTO audit(account_id,action,target_id,metadata) VALUES($1,'media.locator_expired',$2,$3)",
        [ACCOUNT, row.id, { version: row.version }],
      );
    }
    await db.query("COMMIT");
    return { expired: updated.length };
  } catch {
    if (db) await db.query("ROLLBACK").catch(() => {});
    throw unavailable();
  } finally {
    if (db && !released) {
      released = true;
      try {
        db.release();
      } catch {}
    }
  }
}
