/** Disposable CI fixture only. Run after load/browser workers have stopped. */
import { ACCOUNT, createPool } from "../server/db.js";
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
    const attachment = (
      await c.query(
        "INSERT INTO attachments(owner_id,name,mime,data,message_id) VALUES($1,'ci-bound.txt','text/plain',$2,$3) RETURNING id",
        [actor, Buffer.from("synthetic bound media recovery fixture"), mid],
      )
    ).rows[0].id;
    await c.query(
      "INSERT INTO delivery_parts(message_id,part,attachment_id) VALUES($1,1,$2)",
      [mid, attachment],
    );
    await recordPartAccepted(c, mid, 1, "ci-bound-media");
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
  const owner = await pool.query(
    "UPDATE connector_ownership SET phase='uncertain',epoch=17,owner_id=gen_random_uuid(),owner_label='ci-synthetic-owner',reserved_at=now(),uncertain_at=now(),fault_code='shutdown' WHERE account_id=$1 AND phase='idle' RETURNING account_id",
    [ACCOUNT],
  );
  if (owner.rowCount !== 1) throw new Error("Pristine ownership fixture required");
  // A second synthetic row exercises restoration of a previously idle identity.
  // This is recovery coverage, not application multi-account support.
  await pool.query(
    "INSERT INTO connector_ownership(account_id) VALUES('00000000-0000-4000-8000-000000000002')",
  );
  console.log("Synthetic linked/held/conflict journal fixtures persisted");
} finally {
  await pool.end();
}
