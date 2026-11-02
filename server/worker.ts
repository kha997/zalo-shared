import type pg from "pg";
import { pathToFileURL } from "node:url";
import { ACCOUNT, audit, createPool } from "./db.js";
import { recordPartAccepted, reconcileSelfEvents } from "./provider-store.js";
import { configFromEnv } from "./config.js";
/** Only throw when the current operation is known not to have executed externally. */
export class ProviderNotDispatchedError extends Error {
  constructor() {
    super("Provider dispatch deferred");
    this.name = "ProviderNotDispatchedError";
  }
}
/**
 * The durable pilot ledger already owns this part, so no further egress attempt
 * is permitted. The part is known not to have been accepted, but it cannot be
 * retried under the same reservation; leave it terminal instead of pending so a
 * single stale reservation cannot wedge the queue head forever.
 */
export class ProviderReservationConsumedError extends Error {
  constructor() {
    super("Provider reservation already consumed");
    this.name = "ProviderReservationConsumedError";
  }
}
export interface Provider {
  connected(db?: pg.PoolClient): Promise<boolean>;
  prepareMessage?(messageId: string, db: pg.PoolClient): Promise<void>;
  sendPart(
    messageId: string,
    part: number,
    db?: pg.PoolClient,
  ): Promise<string | null>;
  releaseMessage?(messageId: string): void;
}
export function createMockProvider(pool: pg.Pool): Provider {
  return {
    async connected(db) {
      return (
        (
          await (db ?? pool).query(
            "SELECT status FROM provider_state WHERE account_id=$1",
            [ACCOUNT],
          )
        ).rows[0]?.status === "connected"
      );
    },
    async sendPart(messageId, part, db) {
      const r = await (db ?? pool).query(
        "INSERT INTO provider_ledger(message_id,part,provider_id) VALUES($1,$2,$3) ON CONFLICT(message_id,part) DO UPDATE SET message_id=excluded.message_id RETURNING provider_id",
        [messageId, part, `mock-${messageId}-${part}`],
      );
      return r.rows[0].provider_id;
    },
  };
}
const PEER_ID = /^[A-Za-z0-9_-]{1,200}$/;
/** A provided scope is always exact: an empty or malformed list must never widen the claim. */
function exactPeers(
  scope: { peers: readonly string[] } | undefined,
): readonly string[] | undefined {
  if (scope === undefined) return undefined;
  const peers = scope?.peers;
  if (
    !Array.isArray(peers) ||
    peers.length === 0 ||
    peers.some((peer) => typeof peer !== "string" || !PEER_ID.test(peer)) ||
    new Set(peers).size !== peers.length
  )
    throw new TypeError("Worker scope must list exact direct peers");
  return [...peers];
}
export async function runWorkerOnce(
  pool: pg.Pool,
  provider: Provider,
  /** Optional exact direct-peer scope; other conversations are never claimed. */
  scope?: { peers: readonly string[] },
) {
  const peers = exactPeers(scope);
  const db = await pool.connect();
  let locked = false;
  try {
    locked = (await db.query("SELECT pg_try_advisory_lock(73001) AS locked"))
      .rows[0].locked;
    if (!locked) return { processed: false };
    // Only the exclusive owner can quarantine an interrupted dispatch. Never retry these jobs.
    await db.query("BEGIN");
    const interrupted = await db.query(
      peers
        ? "SELECT o.message_id FROM outbox o JOIN messages m ON m.id=o.message_id JOIN conversations c ON c.id=m.conversation_id WHERE o.status='processing' AND c.account_id=$1 AND c.provider_thread_type=0 AND c.provider_thread_id=ANY($2::text[]) FOR UPDATE OF o"
        : "SELECT o.message_id FROM outbox o JOIN messages m ON m.id=o.message_id JOIN conversations c ON c.id=m.conversation_id WHERE o.status='processing' AND c.account_id=$1 FOR UPDATE OF o",
      peers ? [ACCOUNT, peers] : [ACCOUNT],
    );
    for (const job of interrupted.rows) {
      await db.query("UPDATE messages SET status='unknown' WHERE id=$1", [
        job.message_id,
      ]);
      await db.query(
        "UPDATE delivery_parts SET status='unknown' WHERE message_id=$1 AND status='processing'",
        [job.message_id],
      );
      await db.query("UPDATE outbox SET status='unknown' WHERE message_id=$1", [
        job.message_id,
      ]);
      await audit(db, null, "message.unknown", job.message_id, {
        reason: "interrupted-dispatch",
      });
    }
    await db.query("COMMIT");
    if (!(await provider.connected(db))) return { processed: false };
    await db.query("BEGIN");
    const scoped = peers !== undefined;
    const r = await db.query(
      scoped
        ? "SELECT o.* FROM outbox o JOIN messages m ON m.id=o.message_id JOIN conversations c ON c.id=m.conversation_id WHERE o.status='pending' AND c.account_id=$1 AND c.provider_thread_type=0 AND c.provider_thread_id=ANY($2::text[]) ORDER BY o.created_at,o.id FOR UPDATE OF o SKIP LOCKED LIMIT 1"
        : "SELECT o.* FROM outbox o JOIN messages m ON m.id=o.message_id JOIN conversations c ON c.id=m.conversation_id WHERE o.status='pending' AND c.account_id=$1 ORDER BY o.created_at,o.id FOR UPDATE OF o SKIP LOCKED LIMIT 1",
      scoped ? [ACCOUNT, peers] : [ACCOUNT],
    );
    if (!r.rowCount) {
      await db.query("COMMIT");
      return { processed: false };
    }
    const job = r.rows[0];
    let dispatched = false;
    let deferredJob = false;
    try {
      const parts = (
        await db.query(
          "SELECT * FROM delivery_parts WHERE message_id=$1 ORDER BY part",
          [job.message_id],
        )
      ).rows;
      if (
        parts.some((p) => p.status === "unknown" || p.status === "processing")
      ) {
        dispatched = true;
        throw new Error("Uncertain prior execution");
      }
      if (
        !parts.length ||
        parts.some((p) => !["pending", "sent", "skipped"].includes(p.status))
      )
        throw new Error("Explicit part reset required");
      await provider.prepareMessage?.(job.message_id, db);
      await db.query("UPDATE outbox SET status='processing' WHERE id=$1", [
        job.id,
      ]);
      await db.query("UPDATE messages SET status='processing' WHERE id=$1", [
        job.message_id,
      ]);
      await db.query("COMMIT");
      for (const part of parts) {
        if (part.status === "sent" || part.status === "skipped") continue;
        // Blank text is skippable only when actual attachment parts exist.
        const attachmentText =
          part.part === 0 &&
          (
            await db.query(
              "SELECT m.text FROM messages m WHERE m.id=$1 AND EXISTS(SELECT 1 FROM attachments a WHERE a.message_id=m.id) AND EXISTS(SELECT 1 FROM delivery_parts p WHERE p.message_id=m.id AND p.part>0)",
              [job.message_id],
            )
          ).rows[0]?.text;
        const blank =
          typeof attachmentText === "string" && !attachmentText.trim();
        await db.query(
          "UPDATE delivery_parts SET status='processing' WHERE message_id=$1 AND part=$2",
          [job.message_id, part.part],
        );
        dispatched = true;
        const providerId = await provider.sendPart(
          job.message_id,
          part.part,
          db,
        );
        await db.query("BEGIN");
        if (providerId === null) {
          if (!blank) throw new Error("Invalid skipped result");
          await db.query(
            "UPDATE delivery_parts SET status='skipped',provider_id=NULL WHERE message_id=$1 AND part=$2",
            [job.message_id, part.part],
          );
        } else
          await recordPartAccepted(db, job.message_id, part.part, providerId);
        await db.query("COMMIT");
      }
      await db.query("BEGIN");
      const m = await db.query(
        "UPDATE messages SET status='sent',provider_id=(SELECT provider_id FROM delivery_parts WHERE message_id=$1 AND status='sent' AND provider_id IS NOT NULL ORDER BY part LIMIT 1) WHERE id=$1 RETURNING conversation_id",
        [job.message_id],
      );
      await db.query("UPDATE outbox SET status='sent' WHERE id=$1", [job.id]);
      await audit(db, null, "message.sent", job.message_id);
      await reconcileSelfEvents(db, m.rows[0].conversation_id);
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK").catch(() => {});
      await db.query("BEGIN");
      const deferred = error instanceof ProviderNotDispatchedError;
      if (deferred) deferredJob = true;
      const consumed = error instanceof ProviderReservationConsumedError;
      // A spent reservation is refused before the provider call, so this
      // attempt is known not to have dispatched even though the part was
      // marked processing above.
      const status =
        deferred ? "pending" : dispatched && !consumed ? "unknown" : "failed";
      await db.query("UPDATE messages SET status=$2 WHERE id=$1", [
        job.message_id,
        status,
      ]);
      await db.query("UPDATE outbox SET status=$2 WHERE id=$1", [
        job.id,
        status,
      ]);
      await db.query(
        deferred
          ? "UPDATE delivery_parts SET status=$2 WHERE message_id=$1 AND status='processing'"
          : "UPDATE delivery_parts SET status=$2 WHERE message_id=$1 AND status IN ('pending','processing')",
        [job.message_id, status],
      );
      await audit(
        db,
        null,
        deferred
          ? "message.deferred"
          : dispatched && !consumed
            ? "message.unknown"
            : "message.failed",
        job.message_id,
        deferred
          ? { reason: "provider-not-dispatched" }
          : dispatched && !consumed
            ? {}
            : {
                reason: consumed
                  ? "reservation-already-consumed"
                  : "preparation-failed",
              },
      );
      if (deferred) {
        const m = (
          await db.query("SELECT conversation_id FROM messages WHERE id=$1", [
            job.message_id,
          ])
        ).rows[0];
        await reconcileSelfEvents(db, m.conversation_id);
      }
      await db.query("COMMIT");
    } finally {
      provider.releaseMessage?.(job.message_id);
    }
    // A deferral is a no-op for this tick: the caller must back off instead of
    // immediately reclaiming the same destination in a hot loop.
    return { processed: !deferredJob };
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    if (locked)
      await db.query("SELECT pg_advisory_unlock(73001)").catch(() => {});
    db.release();
  }
}
async function main() {
  const config = configFromEnv();
  let stopping = false;
  process.on("SIGTERM", () => {
    stopping = true;
  });
  process.on("SIGINT", () => {
    stopping = true;
  });
  if (!config.mockEnabled) {
    console.info("Provider disabled; worker idle");
    while (!stopping) await new Promise((r) => setTimeout(r, 500));
    return;
  }
  const pool = createPool(process.env.DATABASE_URL!);
  const provider = createMockProvider(pool);
  try {
    while (!stopping) {
      const result = await runWorkerOnce(pool, provider);
      // Back off only when idle/disconnected or another owner holds the lock.
      if (!result.processed) await new Promise((r) => setTimeout(r, 500));
    }
  } finally {
    await pool.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => {
    console.error("Worker stopped");
    process.exitCode = 1;
  });
