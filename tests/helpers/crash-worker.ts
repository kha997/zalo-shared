import { createPool } from "../../server/db.js";
import { runWorkerOnce } from "../../server/worker.js";

const pool = createPool(process.env.CRASH_TEST_DATABASE_URL!);
try {
  await runWorkerOnce(pool, {
    connected: async () => true,
    async sendPart(messageId, part) {
      await pool.query(
        "INSERT INTO provider_ledger(message_id,part,provider_id) VALUES($1,$2,$3)",
        [messageId, part, `accepted-${messageId}-${part}`],
      );
      if (!process.send) throw new Error("IPC required");
      process.send({ stage: "accepted" });
      return new Promise<string>(() => {});
    },
  });
} catch {
  process.exitCode = 1;
} finally {
  await pool.end();
}
