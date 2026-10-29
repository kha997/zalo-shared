import test from "node:test";
import assert from "node:assert/strict";
import { createSdkProvider } from "../../adapters/zalo/provider.js";
import { runWorkerOnce } from "../../server/worker.js";
import { ACCOUNT } from "../../server/db.js";
import { ingestProviderEvent } from "../../server/provider-store.js";
import { isolatedDatabase } from "./isolation.js";
const data = Buffer.from("synthetic");
function metadataDb(parts: any[], attachments: any[], text = "hello") {
  return {
    async query(sql: string) {
      return {
        rows: sql.includes("provider_state")
          ? [{ status: "connected", reconciliation_required: false }]
          : sql.includes("delivery_parts")
            ? parts
            : sql.includes("SELECT id,data")
              ? attachments.map((a) => ({ id: a.id, data: a.data }))
              : sql.includes("FROM attachments WHERE message_id")
                ? attachments
                : [
                    {
                      text,
                      provider_thread_type: 0,
                      provider_thread_id: "peer",
                      attachments: attachments.length,
                    },
                  ],
      };
    },
  } as any;
}
function attachment(id: string) {
  return {
    id,
    message_id: "message",
    account_id: ACCOUNT,
    name: id + ".txt",
    mime: "text/plain",
    size: data.length,
    data: Buffer.from(data),
  };
}
test("media bridge preflights original bindings and snapshots bytes before dispatch", async () => {
  const a = attachment("a"),
    b = attachment("b"),
    calls: any[] = [];
  const db = metadataDb(
    [
      { part: 0, attachment_id: null },
      { part: 1, attachment_id: "b" },
      { part: 2, attachment_id: "a" },
    ],
    [a, b],
  );
  const p = createSdkProvider(null as any, {
    status: "connected",
    async sendText() {
      calls.push("text");
      return { status: "sent", providerId: "text" };
    },
    async sendAttachment(m) {
      calls.push(m.data.toString());
      return { status: "sent", providerId: m.name };
    },
  });
  await p.prepareMessage!("message", db);
  a.data.fill(0);
  b.data.fill(0);
  assert.equal(await p.sendPart("message", 0, db), "text");
  await p.sendPart("message", 1, db);
  await p.sendPart("message", 2, db);
  assert.deepEqual(calls, ["text", "synthetic", "synthetic"]);
  p.releaseMessage!("message");
  await assert.rejects(p.sendPart("message", 1, db));
});
test("media bridge validates all parts before text and supports attachment-only skip", async () => {
  let calls = 0;
  const p = createSdkProvider(null as any, {
    status: "connected",
    async sendText() {
      calls++;
      return { status: "sent", providerId: "t" };
    },
    async sendAttachment() {
      calls++;
      return { status: "sent", providerId: "m" };
    },
  });
  const a = attachment("a");
  const valid = [
    { part: 0, attachment_id: null },
    { part: 1, attachment_id: "a" },
  ];
  for (const [parts, attachments] of [
    [[{ part: 0 }, { part: 1 }], [a]],
    [[{ part: 0 }, { part: 2, attachment_id: "a" }], [a]],
    [valid, [{ ...a, account_id: "foreign" }]],
    [valid, [{ ...a, message_id: "foreign" }]],
    [valid, [{ ...a, size: 5 * 1024 * 1024 + 1 }]],
    [valid, [{ ...a, mime: "image/png" }]],
    [
      [
        { part: 0 },
        { part: 1, attachment_id: "a" },
        { part: 2, attachment_id: "a" },
      ],
      [a, a],
    ],
  ] as [any[], any[]][]) {
    await assert.rejects(
      p.prepareMessage!("message", metadataDb(parts, attachments)),
    );
    assert.equal(calls, 0);
  }
  const db = metadataDb(valid, [a], "");
  await p.prepareMessage!("message", db);
  assert.equal(await p.sendPart("message", 0, db), null);
  assert.equal(calls, 0);
  assert.equal(await p.sendPart("message", 1, db), "m");
  assert.equal(calls, 1);
});
test("real media worker preserves accepted parts and exact early echoes, and never retries uncertain media", async () => {
  const database = await isolatedDatabase();
  try {
    const pool = database.pool;
    await ingestProviderEvent(pool, {
      threadType: 0,
      threadId: "media-peer",
      providerId: "in",
      senderId: "peer",
      isSelf: false,
      kind: "text",
      text: "in",
    });
    const cid = (await pool.query("SELECT id FROM conversations")).rows[0].id;
    const actor = (
      await pool.query(
        "INSERT INTO users(name,email,password_hash,role) VALUES('Staff','media-staff@example.test','x','agent') RETURNING id",
      )
    ).rows[0].id;
    await pool.query(
      "UPDATE provider_state SET status='connected',reconciliation_required=false",
    );
    async function enqueue(text: string, n: number, bound = true) {
      const mid = (
        await pool.query(
          "INSERT INTO messages(conversation_id,direction,text,status,actor_id) VALUES($1,'outbound',$2,'pending',$3) RETURNING id",
          [cid, text, actor],
        )
      ).rows[0].id;
      await pool.query("INSERT INTO outbox(message_id) VALUES($1)", [mid]);
      await pool.query(
        "INSERT INTO delivery_parts(message_id,part) VALUES($1,0)",
        [mid],
      );
      for (let i = 1; i <= n; i++) {
        const aid = (
          await pool.query(
            "INSERT INTO attachments(owner_id,message_id,name,mime,data) VALUES($1,$2,$3,'text/plain',$4) RETURNING id",
            [actor, mid, `file${i}.txt`, data],
          )
        ).rows[0].id;
        await pool.query(
          "INSERT INTO delivery_parts(message_id,part,attachment_id) VALUES($1,$2,$3)",
          [mid, i, bound ? aid : null],
        );
      }
      return mid;
    }
    const mid = await enqueue("hello", 2);
    let calls = 0;
    const provider = createSdkProvider(pool, {
      status: "connected",
      async sendText() {
        calls++;
        const id = "text-accepted";
        await ingestProviderEvent(pool, {
          threadType: 0,
          threadId: "media-peer",
          providerId: id,
          senderId: "self",
          isSelf: true,
          kind: "text",
          text: "hello",
        });
        return { status: "sent", providerId: id };
      },
      async sendAttachment(m) {
        calls++;
        if (m.name === "file2.txt") return { status: "unknown" };
        const id = "media-accepted-" + calls;
        await ingestProviderEvent(pool, {
          threadType: 0,
          threadId: "media-peer",
          providerId: id,
          senderId: "self",
          isSelf: true,
          kind: "unsupported",
        });
        return { status: "sent", providerId: id };
      },
    });
    await runWorkerOnce(pool, provider);
    assert.equal(calls, 3);
    assert.deepEqual(
      (
        await pool.query(
          "SELECT status FROM delivery_parts WHERE message_id=$1 ORDER BY part",
          [mid],
        )
      ).rows.map((r) => r.status),
      ["sent", "sent", "unknown"],
    );
    assert.equal(
      (await pool.query("SELECT status FROM outbox WHERE message_id=$1", [mid]))
        .rows[0].status,
      "unknown",
    );
    await runWorkerOnce(pool, provider);
    assert.equal(calls, 3);
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int n FROM provider_events WHERE message_id=$1 AND state='linked'",
          [mid],
        )
      ).rows[0].n,
      2,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int n FROM messages WHERE direction='outbound'",
        )
      ).rows[0].n,
      1,
    );
    const blank = await enqueue("\n\t ", 1);
    await runWorkerOnce(pool, provider);
    assert.equal(calls, 4);
    assert.deepEqual(
      (
        await pool.query(
          "SELECT status FROM delivery_parts WHERE message_id=$1 ORDER BY part",
          [blank],
        )
      ).rows.map((r) => r.status),
      ["skipped", "sent"],
    );
    const legacy = await enqueue("must not send", 1, false);
    await runWorkerOnce(pool, provider);
    assert.equal(calls, 4);
    assert.equal(
      (
        await pool.query("SELECT status FROM outbox WHERE message_id=$1", [
          legacy,
        ])
      ).rows[0].status,
      "failed",
    );
  } finally {
    await database.close();
  }
});
