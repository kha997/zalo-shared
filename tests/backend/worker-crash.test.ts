import { test } from "node:test";
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { isolatedDatabase } from "./isolation.js";
import { createMockProvider, runWorkerOnce } from "../../server/worker.js";
import { ACCOUNT } from "../../server/db.js";

test(
  "SIGKILL after provider acceptance quarantines interrupted dispatch without resend",
  { timeout: 15_000 },
  async () => {
    const database = await isolatedDatabase();
    let child: ChildProcess | undefined;
    let exited:
      | Promise<{ code: number | null; signal: NodeJS.Signals | null }>
      | undefined;
    try {
      const c = (
        await database.pool.query(
          "INSERT INTO conversations(contact_id,contact_name) VALUES($1,'Synthetic crash') RETURNING id",
          [randomUUID()],
        )
      ).rows[0];
      const m = (
        await database.pool.query(
          "INSERT INTO messages(conversation_id,direction,text,status) VALUES($1,'outbound','synthetic','pending') RETURNING id",
          [c.id],
        )
      ).rows[0];
      await database.pool.query("INSERT INTO outbox(message_id) VALUES($1)", [
        m.id,
      ]);
      await database.pool.query(
        "INSERT INTO delivery_parts(message_id,part) VALUES($1,0)",
        [m.id],
      );
      await database.pool.query(
        "UPDATE provider_state SET status='connected' WHERE account_id=$1",
        [ACCOUNT],
      );
      const schema = (await database.pool.query("SELECT current_schema() name"))
        .rows[0].name;
      const url = new URL(process.env.TEST_DATABASE_URL!);
      url.searchParams.set("options", `-c search_path=${schema},public`);
      child = fork(
        fileURLToPath(new URL("../helpers/crash-worker.ts", import.meta.url)),
        [],
        {
          execArgv: ["--import", "tsx"],
          env: { ...process.env, CRASH_TEST_DATABASE_URL: url.toString() },
          stdio: ["ignore", "ignore", "ignore", "ipc"],
        },
      );
      const running = child;
      exited = new Promise((resolve) =>
        running.once("close", (code, signal) => resolve({ code, signal })),
      );
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => finish(new Error("Worker acceptance IPC timed out")),
          5_000,
        );
        const onMessage = (message: any) => {
          if (message?.stage === "accepted") finish();
        };
        const onExit = () =>
          finish(new Error("Worker exited before provider acceptance"));
        const onError = () => finish(new Error("Worker child failed to start"));
        function finish(error?: Error) {
          clearTimeout(timer);
          running.off("message", onMessage);
          running.off("exit", onExit);
          running.off("error", onError);
          if (error) reject(error);
          else resolve();
        }
        running.on("message", onMessage);
        running.once("exit", onExit);
        running.once("error", onError);
      });
      assert.equal(child.kill("SIGKILL"), true);
      assert.equal((await exited).signal, "SIGKILL");
      // Wait for PostgreSQL to observe the dead connection and release its worker lock.
      const recovery = await database.pool.connect();
      try {
        await recovery.query("SET statement_timeout='3s'");
        await recovery.query("SELECT pg_advisory_lock(73001)");
        await recovery.query("SELECT pg_advisory_unlock(73001)");
        await recovery.query("RESET statement_timeout");
      } finally {
        recovery.release();
      }
      let sends = 0;
      const normal = createMockProvider(database.pool);
      const provider = {
        connected: normal.connected,
        sendPart: async (id: string, part: number) => {
          sends++;
          return normal.sendPart(id, part);
        },
      };
      await runWorkerOnce(database.pool, provider);
      await runWorkerOnce(database.pool, provider);
      assert.equal(sends, 0);
      const statuses = (
        await database.pool.query(
          "SELECT m.status message_status,o.status outbox_status,p.status part_status FROM messages m JOIN outbox o ON o.message_id=m.id JOIN delivery_parts p ON p.message_id=m.id WHERE m.id=$1",
          [m.id],
        )
      ).rows[0];
      assert.deepEqual(statuses, {
        message_status: "unknown",
        outbox_status: "unknown",
        part_status: "unknown",
      });
      assert.equal(
        (
          await database.pool.query(
            "SELECT count(*)::int n FROM provider_ledger WHERE message_id=$1",
            [m.id],
          )
        ).rows[0].n,
        1,
      );
      const audit = (
        await database.pool.query(
          "SELECT metadata FROM audit WHERE action='message.unknown' AND target_id=$1",
          [m.id],
        )
      ).rows;
      assert.deepEqual(
        audit.map((r) => r.metadata),
        [{ reason: "interrupted-dispatch" }],
      );
    } finally {
      if (child && child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      if (exited) await exited;
      await database.close();
    }
  },
);
