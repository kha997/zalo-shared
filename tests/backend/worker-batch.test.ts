import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { isolatedDatabase } from "./isolation.js";

test("worker drains a connected backlog without sleeping between every accepted job", async () => {
  const db = await isolatedDatabase();
  const c = (
    await db.pool.query(
      "INSERT INTO conversations(contact_id,contact_name) VALUES('batch','Synthetic batch') RETURNING id",
    )
  ).rows[0];
  await db.pool.query(
    "INSERT INTO messages(conversation_id,direction,text,status) SELECT $1,'outbound','Synthetic batch','pending' FROM generate_series(1,12)",
    [c.id],
  );
  await db.pool.query("INSERT INTO outbox(message_id) SELECT id FROM messages");
  await db.pool.query(
    "INSERT INTO delivery_parts(message_id,part) SELECT id,0 FROM messages",
  );
  await db.pool.query("UPDATE provider_state SET status='connected'");
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.searchParams.set("options", String(db.pool.options.options));
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "server/worker.ts"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: url.toString(),
        PROVIDER_MODE: "mock",
        MOCK_ENABLED: "true",
        NODE_ENV: "test",
      },
      stdio: "ignore",
    },
  );
  const exited = once(child, "exit");
  try {
    const deadline = performance.now() + 4000;
    let count = 0;
    while (performance.now() < deadline) {
      count = (
        await db.pool.query(
          "SELECT count(*)::int n FROM outbox WHERE status='sent'",
        )
      ).rows[0].n;
      if (count === 12) break;
      await delay(40);
    }
    assert.equal(
      count,
      12,
      "connected backlog should drain; idle polling delay must not limit every job",
    );
    assert.equal(
      (await db.pool.query("SELECT count(*)::int n FROM provider_ledger"))
        .rows[0].n,
      12,
    );
  } finally {
    child.kill("SIGTERM");
    await exited;
    await db.close();
  }
});
