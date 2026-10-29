/** Disposable CI fixture only. Run after load/browser workers have stopped. */
import { createPool } from "../server/db.js";
import {
  ingestProviderEvent,
  recordPartAccepted,
} from "../server/provider-store.js";
if (
  process.env.CI_PROVIDER_JOURNAL_DISPOSABLE !== "yes" ||
  process.env.PROVIDER_MODE !== "mock"
)
  throw new Error("Requires explicit disposable CI database and mock provider");
const url = process.env.DATABASE_URL;
if (!url || !/^zalo_test$/.test(new URL(url).pathname.slice(1)))
  throw new Error("Requires disposable zalo_test database");
const pool = createPool(url);
const base = {
  threadType: 0 as const,
  threadId: "ci-synthetic-journal",
  senderId: "ci-synthetic-sender",
  kind: "text" as const,
  text: "synthetic journal fixture",
  isSelf: false,
  providerId: "ci-linked",
};
try {
  const initial = await ingestProviderEvent(pool, base);
  const c = await pool.connect();
  let mid: string;
  try {
    await c.query("BEGIN");
    const cid = (
      await c.query("SELECT conversation_id FROM messages WHERE id=$1", [
        initial.messageId,
      ])
    ).rows[0].conversation_id;
    await c.query("SELECT id FROM conversations WHERE id=$1 FOR UPDATE", [cid]);
    const actor = (await c.query("SELECT id FROM users ORDER BY id LIMIT 1"))
      .rows[0]?.id;
    if (!actor) throw new Error("CI users must be seeded first");
    mid = (
      await c.query(
        "INSERT INTO messages(conversation_id,direction,text,actor_id,status) VALUES($1,'outbound','synthetic staff fixture',$2,'unknown') RETURNING id",
        [cid, actor],
      )
    ).rows[0].id;
    await c.query(
      "INSERT INTO outbox(message_id,status) VALUES($1,'unknown')",
      [mid],
    );
    await c.query("INSERT INTO delivery_parts(message_id,part) VALUES($1,0)", [
      mid,
    ]);
    await recordPartAccepted(c, mid, 0, "ci-staff-echo");
    await c.query("COMMIT");
  } catch (error) {
    await c.query("ROLLBACK");
    throw error;
  } finally {
    c.release();
  }
  await ingestProviderEvent(pool, {
    ...base,
    isSelf: true,
    providerId: "ci-staff-echo",
  });
  await ingestProviderEvent(pool, {
    ...base,
    isSelf: true,
    providerId: "ci-held",
  });
  await ingestProviderEvent(pool, { ...base, providerId: "ci-conflict" });
  await ingestProviderEvent(pool, {
    ...base,
    providerId: "ci-conflict",
    text: "synthetic conflicting fixture",
  });
  const states = (
    await pool.query(
      "SELECT DISTINCT state FROM provider_events WHERE thread_id=$1",
      [base.threadId],
    )
  ).rows.map((r) => r.state);
  if (!["linked", "held", "conflict"].every((s) => states.includes(s)))
    throw new Error("Journal fixture incomplete");
  console.log("Synthetic linked/held/conflict journal fixtures persisted");
} finally {
  await pool.end();
}
