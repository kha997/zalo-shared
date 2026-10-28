import type pg from "pg";
import { pathToFileURL } from "node:url";
import { ACCOUNT, audit, createPool } from "./db.js";
import { configFromEnv } from "./config.js";
export interface Provider {
  connected(): Promise<boolean>;
  sendPart(messageId: string, part: number): Promise<string>;
}
export function createMockProvider(pool: pg.Pool): Provider {
  return {
    async connected() {
      return (
        (
          await pool.query(
            "SELECT status FROM provider_state WHERE account_id=$1",
            [ACCOUNT],
          )
        ).rows[0]?.status === "connected"
      );
    },
    async sendPart(messageId, part) {
      const r = await pool.query(
        "INSERT INTO provider_ledger(message_id,part,provider_id) VALUES($1,$2,$3) ON CONFLICT(message_id,part) DO UPDATE SET message_id=excluded.message_id RETURNING provider_id",
        [messageId, part, `mock-${messageId}-${part}`],
      );
      return r.rows[0].provider_id;
    },
  };
}
export async function runWorkerOnce(pool: pg.Pool, provider: Provider) {
  const db = await pool.connect();
  let locked = false;
  try {
    locked = (await db.query("SELECT pg_try_advisory_lock(73001) AS locked"))
      .rows[0].locked;
    if (!locked) return { processed: false };
    // Only the exclusive owner can quarantine an interrupted dispatch. Never retry these jobs.
    await db.query("BEGIN");
    const interrupted = await db.query(
      "SELECT o.message_id FROM outbox o JOIN messages m ON m.id=o.message_id JOIN conversations c ON c.id=m.conversation_id WHERE o.status='processing' AND c.account_id=$1 FOR UPDATE OF o",
      [ACCOUNT],
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
    if (!(await provider.connected())) return { processed: false };
    await db.query("BEGIN");
    const r = await db.query(
      "SELECT o.* FROM outbox o JOIN messages m ON m.id=o.message_id JOIN conversations c ON c.id=m.conversation_id WHERE o.status='pending' AND c.account_id=$1 ORDER BY o.created_at,o.id FOR UPDATE OF o SKIP LOCKED LIMIT 1",
      [ACCOUNT],
    );
    if (!r.rowCount) {
      await db.query("COMMIT");
      return { processed: false };
    }
    const job = r.rows[0];
    await db.query("UPDATE outbox SET status='processing' WHERE id=$1", [
      job.id,
    ]);
    await db.query("UPDATE messages SET status='processing' WHERE id=$1", [
      job.message_id,
    ]);
    await db.query("COMMIT");
    try {
      const parts = await db.query(
        "SELECT * FROM delivery_parts WHERE message_id=$1 ORDER BY part",
        [job.message_id],
      );
      for (const part of parts.rows) {
        await db.query(
          "UPDATE delivery_parts SET status='processing' WHERE message_id=$1 AND part=$2",
          [job.message_id, part.part],
        );
        const providerId = await provider.sendPart(job.message_id, part.part);
        await db.query(
          "UPDATE delivery_parts SET status='sent',provider_id=$3 WHERE message_id=$1 AND part=$2",
          [job.message_id, part.part, providerId],
        );
      }
      await db.query("BEGIN");
      await db.query(
        "UPDATE messages SET status='sent',provider_id=(SELECT provider_id FROM delivery_parts WHERE message_id=$1 AND part=0) WHERE id=$1",
        [job.message_id],
      );
      await db.query("UPDATE outbox SET status='sent' WHERE id=$1", [job.id]);
      await audit(db, null, "message.sent", job.message_id);
      await db.query("COMMIT");
    } catch {
      await db.query("ROLLBACK").catch(() => {});
      await db.query("BEGIN");
      await db.query("UPDATE messages SET status='unknown' WHERE id=$1", [
        job.message_id,
      ]);
      await db.query("UPDATE outbox SET status='unknown' WHERE id=$1", [
        job.id,
      ]);
      await db.query(
        "UPDATE delivery_parts SET status='unknown' WHERE message_id=$1 AND status='processing'",
        [job.message_id],
      );
      await audit(db, null, "message.unknown", job.message_id);
      await db.query("COMMIT");
    }
    return { processed: true };
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
