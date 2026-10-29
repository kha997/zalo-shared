import { test } from "node:test";
import assert from "node:assert/strict";
import { createSdkProvider } from "../../adapters/zalo/provider.js";
import {
  ProviderNotDispatchedError,
  runWorkerOnce,
} from "../../server/worker.js";
import { ingestProviderEvent } from "../../server/provider-store.js";
import { isolatedDatabase } from "./isolation.js";
import { ACCOUNT } from "../../server/db.js";

test("SDK bridge preflight never calls transport and rejects media before text", async () => {
  let sends = 0;
  const provider = createSdkProvider(null as any, {
    status: "connected",
    async sendText() {
      sends++;
      return { status: "sent", providerId: "id" };
    },
  });
  const db = {
    async query(sql: string) {
      return {
        rows: sql.includes("delivery_parts")
          ? [{ part: 0 }, { part: 1 }]
          : [
              {
                text: "hello",
                provider_thread_type: 0,
                provider_thread_id: "thread",
                attachments: 1,
              },
            ],
      };
    },
  } as any;
  await assert.rejects(provider.prepareMessage!("message", db));
  assert.equal(sends, 0);
});

test("real worker reconciles early and late exact echoes without transcript duplication", async () => {
  const database = await isolatedDatabase();
  try {
    const pool = database.pool;
    const event = {
      threadType: 0 as const,
      threadId: "synthetic",
      providerId: "in",
      senderId: "peer",
      isSelf: false,
      kind: "text" as const,
      text: "inbound",
    };
    await ingestProviderEvent(pool, event);
    const cid = (await pool.query("SELECT id FROM conversations")).rows[0].id;
    const actor = (
      await pool.query(
        "INSERT INTO users(name,email,password_hash,role) VALUES('Staff','synthetic@example.test','x','agent') RETURNING id",
      )
    ).rows[0].id;
    const mid = (
      await pool.query(
        "INSERT INTO messages(conversation_id,direction,text,status,actor_id,request_key) VALUES($1,'outbound','hello','pending',$2,'retry-key') RETURNING id",
        [cid, actor],
      )
    ).rows[0].id;
    await pool.query("INSERT INTO outbox(message_id) VALUES($1)", [mid]);
    await pool.query(
      "INSERT INTO delivery_parts(message_id,part) VALUES($1,0)",
      [mid],
    );
    await pool.query(
      "UPDATE provider_state SET status='connected' WHERE account_id=$1",
      [ACCOUNT],
    );
    let sends = 0;
    const echo = {
      ...event,
      providerId: "accepted",
      isSelf: true,
      senderId: "self",
      text: "hello",
    };
    const provider = createSdkProvider(pool, {
      status: "connected",
      async sendText(peer, text, type) {
        sends++;
        assert.deepEqual([peer, text, type], ["synthetic", "hello", 0]);
        assert.equal((await ingestProviderEvent(pool, echo)).held, true);
        return { status: "sent", providerId: "accepted" };
      },
    });
    await runWorkerOnce(pool, provider);
    await ingestProviderEvent(pool, echo);
    await runWorkerOnce(pool, provider);
    assert.equal(sends, 1);
    const messages = (
      await pool.query("SELECT * FROM messages ORDER BY created_at")
    ).rows;
    assert.equal(messages.length, 2);
    assert.equal(messages[1].actor_id, actor);
    assert.equal(messages[1].status, "sent");
    assert.equal(messages[1].provider_id, "accepted");
    await ingestProviderEvent(pool, {
      ...echo,
      providerId: "native",
      text: "phone",
    });
    assert.equal(
      (
        await pool.query(
          "SELECT actor_id FROM messages WHERE provider_id='native'",
        )
      ).rows[0].actor_id,
      null,
    );
  } finally {
    await database.close();
  }
});

test("worker preserves confirmations, holds ambiguous parts, rejects unsupported media and unmapped jobs", async () => {
  const database = await isolatedDatabase();
  try {
    const pool = database.pool;
    await ingestProviderEvent(pool, {
      threadType: 1,
      threadId: "group",
      providerId: "inbound",
      senderId: "peer",
      isSelf: false,
      kind: "text",
      text: "hello",
    });
    const cid = (await pool.query("SELECT id FROM conversations")).rows[0].id;
    await pool.query("UPDATE provider_state SET status='connected'");
    async function enqueue(
      statuses: string[],
      text = "hello",
      conversation = cid,
    ) {
      const mid = (
        await pool.query(
          "INSERT INTO messages(conversation_id,direction,text,status) VALUES($1,'outbound',$2,'pending') RETURNING id",
          [conversation, text],
        )
      ).rows[0].id;
      await pool.query("INSERT INTO outbox(message_id) VALUES($1)", [mid]);
      for (const [part, status] of statuses.entries())
        await pool.query(
          "INSERT INTO delivery_parts(message_id,part,status,provider_id) VALUES($1,$2,$3,$4)",
          [mid, part, status, status === "sent" ? `prior-${mid}` : null],
        );
      return mid;
    }
    const state = async (mid: string) =>
      (
        await pool.query(
          "SELECT status,provider_id FROM messages WHERE id=$1",
          [mid],
        )
      ).rows[0];
    let sends = 0;
    const transport = {
      status: "connected",
      async sendText() {
        sends++;
        return { status: "sent" as const, providerId: "next" };
      },
    };
    const sdk = createSdkProvider(pool, transport);
    const media = await enqueue(["pending", "pending"]);
    await runWorkerOnce(pool, sdk);
    assert.equal((await state(media)).status, "failed");
    assert.equal(sends, 0);
    const legacy = (
      await pool.query(
        "INSERT INTO conversations(contact_id,contact_name) VALUES('legacy','Legacy') RETURNING id",
      )
    ).rows[0].id;
    const unmapped = await enqueue(["pending"], "text", legacy);
    await runWorkerOnce(pool, sdk);
    assert.equal((await state(unmapped)).status, "failed");
    const held = await enqueue(["sent", "unknown"]);
    await runWorkerOnce(pool, sdk);
    assert.equal((await state(held)).status, "unknown");
    assert.equal(
      (
        await pool.query(
          "SELECT status FROM delivery_parts WHERE message_id=$1 AND part=0",
          [held],
        )
      ).rows[0].status,
      "sent",
    );
    assert.equal(sends, 0);
    const confirmed = await enqueue(["sent"]);
    await runWorkerOnce(pool, sdk);
    assert.equal((await state(confirmed)).status, "sent");
    assert.equal((await state(confirmed)).provider_id, `prior-${confirmed}`);
    assert.equal(sends, 0);
    transport.status = "disconnected";
    const waiting = await enqueue(["pending"]);
    await runWorkerOnce(pool, sdk);
    assert.equal((await state(waiting)).status, "pending");
    transport.status = "connected";
    await pool.query("UPDATE provider_state SET reconciliation_required=true");
    await runWorkerOnce(pool, sdk);
    assert.equal((await state(waiting)).status, "pending");
    await pool.query("UPDATE provider_state SET reconciliation_required=false");
    const uncertain = createSdkProvider(pool, {
      status: "connected",
      async sendText() {
        sends++;
        return { status: "unknown" };
      },
    });
    await runWorkerOnce(pool, uncertain);
    await runWorkerOnce(pool, uncertain);
    assert.equal((await state(waiting)).status, "unknown");
    assert.equal(sends, 1);
  } finally {
    await database.close();
  }
});

test("null skips only blank text with real attachment parts and confirmed parts survive a later uncertain send", async () => {
  const database = await isolatedDatabase();
  try {
    const pool = database.pool;
    await ingestProviderEvent(pool, {
      threadType: 0,
      threadId: "parts",
      providerId: "in",
      senderId: "peer",
      isSelf: false,
      kind: "text",
      text: "in",
    });
    const cid = (await pool.query("SELECT id FROM conversations")).rows[0].id;
    await pool.query("UPDATE provider_state SET status='connected'");
    const mid = (
      await pool.query(
        "INSERT INTO messages(conversation_id,direction,text,status) VALUES($1,'outbound','  ','pending') RETURNING id",
        [cid],
      )
    ).rows[0].id;
    await pool.query("INSERT INTO outbox(message_id) VALUES($1)", [mid]);
    await pool.query(
      "INSERT INTO delivery_parts(message_id,part) VALUES($1,0),($1,1),($1,2)",
      [mid],
    );
    await pool.query(
      "INSERT INTO attachments(name,mime,data,message_id) VALUES('synthetic.txt','text/plain',$1,$2)",
      [Buffer.from("synthetic"), mid],
    );
    const called: number[] = [];
    await runWorkerOnce(pool, {
      async connected() {
        return true;
      },
      async sendPart(_id, part) {
        called.push(part);
        if (part === 0) return null;
        if (part === 1) return "part-one";
        throw new Error("uncertain private error");
      },
    });
    assert.deepEqual(called, [0, 1, 2]);
    assert.deepEqual(
      (
        await pool.query(
          "SELECT status,provider_id FROM delivery_parts WHERE message_id=$1 ORDER BY part",
          [mid],
        )
      ).rows,
      [
        { status: "skipped", provider_id: null },
        { status: "sent", provider_id: "part-one" },
        { status: "unknown", provider_id: null },
      ],
    );
    await runWorkerOnce(pool, {
      async connected() {
        return true;
      },
      async sendPart() {
        throw new Error("must not repeat");
      },
    });
    const next = (
      await pool.query(
        "INSERT INTO messages(conversation_id,direction,text,status) VALUES($1,'outbound','nonblank','pending') RETURNING id",
        [cid],
      )
    ).rows[0].id;
    await pool.query("INSERT INTO outbox(message_id) VALUES($1)", [next]);
    await pool.query(
      "INSERT INTO delivery_parts(message_id,part) VALUES($1,0)",
      [next],
    );
    await runWorkerOnce(pool, {
      async connected() {
        return true;
      },
      async sendPart() {
        return null;
      },
    });
    assert.equal(
      (await pool.query("SELECT status FROM messages WHERE id=$1", [next]))
        .rows[0].status,
      "unknown",
    );
  } finally {
    await database.close();
  }
});

test("dispatch boundary refuses changed eligibility and distinguishes transport failed from unknown", async () => {
  let sends = 0;
  let eligible = true;
  let outcome: "failed" | "unknown" = "failed";
  const db = {
    async query(sql: string) {
      return {
        rows: sql.includes("provider_state")
          ? [{ status: "connected", reconciliation_required: !eligible }]
          : sql.includes("delivery_parts")
            ? [{ part: 0 }]
            : [
                {
                  text: "hello",
                  provider_thread_id: "peer",
                  provider_thread_type: 0,
                  attachments: 0,
                },
              ],
      };
    },
  } as any;
  const provider = createSdkProvider(null as any, {
    status: "connected",
    async sendText() {
      sends++;
      return { status: outcome };
    },
  });
  await provider.prepareMessage!("message", db);
  eligible = false;
  await assert.rejects(
    provider.sendPart("message", 0, db),
    ProviderNotDispatchedError,
  );
  assert.equal(sends, 0);
  eligible = true;
  await assert.rejects(
    provider.sendPart("message", 0, db),
    ProviderNotDispatchedError,
  );
  assert.equal(sends, 1);
  outcome = "unknown";
  await assert.rejects(
    provider.sendPart("message", 0, db),
    (error) =>
      error instanceof Error && !(error instanceof ProviderNotDispatchedError),
  );
  assert.equal(sends, 2);
});

test("eligibility changes during preparation defer without execution and reconnect resumes safely", async () => {
  const database = await isolatedDatabase();
  try {
    const pool = database.pool;
    await ingestProviderEvent(pool, {
      threadType: 0,
      threadId: "boundary",
      providerId: "in",
      senderId: "peer",
      isSelf: false,
      kind: "text",
      text: "in",
    });
    const cid = (await pool.query("SELECT id FROM conversations")).rows[0].id;
    for (const fault of [
      "reconciliation",
      "database-disconnect",
      "transport-disconnect",
      "transport-failed",
    ] as const) {
      await pool.query(
        "UPDATE provider_state SET status='connected',reconciliation_required=false",
      );
      const mid = (
        await pool.query(
          "INSERT INTO messages(conversation_id,direction,text,status) VALUES($1,'outbound','hello','pending') RETURNING id",
          [cid],
        )
      ).rows[0].id;
      await pool.query("INSERT INTO outbox(message_id) VALUES($1)", [mid]);
      await pool.query(
        "INSERT INTO delivery_parts(message_id,part) VALUES($1,0)",
        [mid],
      );
      let sends = 0;
      const transport = {
        status: "connected",
        async sendText() {
          sends++;
          return fault === "transport-failed" && sends === 1
            ? { status: "failed" as const }
            : { status: "sent" as const, providerId: `accepted-${mid}` };
        },
      };
      const provider = createSdkProvider(pool, transport);
      const prepare = provider.prepareMessage!;
      provider.prepareMessage = async (id, db) => {
        await prepare(id, db);
        if (fault === "reconciliation")
          await pool.query(
            "UPDATE provider_state SET reconciliation_required=true",
          );
        if (fault === "database-disconnect")
          await pool.query("UPDATE provider_state SET status='disconnected'");
        if (fault === "transport-disconnect") transport.status = "disconnected";
      };
      await runWorkerOnce(pool, provider);
      assert.equal(sends, fault === "transport-failed" ? 1 : 0);
      assert.deepEqual(
        (
          await pool.query(
            "SELECT m.status message,o.status outbox,p.status part FROM messages m JOIN outbox o ON o.message_id=m.id JOIN delivery_parts p ON p.message_id=m.id WHERE m.id=$1",
            [mid],
          )
        ).rows[0],
        { message: "pending", outbox: "pending", part: "pending" },
      );
      assert.deepEqual(
        (
          await pool.query(
            "SELECT metadata FROM audit WHERE action='message.deferred' AND target_id=$1",
            [mid],
          )
        ).rows[0].metadata,
        { reason: "provider-not-dispatched" },
      );
      provider.prepareMessage = prepare;
      transport.status = "connected";
      await pool.query(
        "UPDATE provider_state SET status='connected',reconciliation_required=false",
      );
      await runWorkerOnce(pool, provider);
      await runWorkerOnce(pool, provider);
      assert.equal(sends, fault === "transport-failed" ? 2 : 1);
      assert.equal(
        (await pool.query("SELECT status FROM messages WHERE id=$1", [mid]))
          .rows[0].status,
        "sent",
      );
    }
    // Generic multipart providers can resume a proven non-execution gap without repeating accepted parts.
    const mid = (
      await pool.query(
        "INSERT INTO messages(conversation_id,direction,text,status) VALUES($1,'outbound','parts','pending') RETURNING id",
        [cid],
      )
    ).rows[0].id;
    await pool.query("INSERT INTO outbox(message_id) VALUES($1)", [mid]);
    await pool.query(
      "INSERT INTO delivery_parts(message_id,part) VALUES($1,0),($1,1),($1,2)",
      [mid],
    );
    const calls: number[] = [];
    let refuse = true;
    const provider = {
      async connected() {
        return true;
      },
      async sendPart(_id: string, part: number) {
        calls.push(part);
        if (part === 1 && refuse) throw new ProviderNotDispatchedError();
        return `part-${mid}-${part}`;
      },
    };
    await runWorkerOnce(pool, provider);
    assert.deepEqual(
      (
        await pool.query(
          "SELECT status FROM delivery_parts WHERE message_id=$1 ORDER BY part",
          [mid],
        )
      ).rows.map((r) => r.status),
      ["sent", "pending", "pending"],
    );
    refuse = false;
    await runWorkerOnce(pool, provider);
    assert.deepEqual(calls, [0, 1, 1, 2]);
    assert.equal(
      (await pool.query("SELECT provider_id FROM messages WHERE id=$1", [mid]))
        .rows[0].provider_id,
      `part-${mid}-0`,
    );
  } finally {
    await database.close();
  }
});

test("preflight rejects whitespace-only mapped thread IDs before any execution", async () => {
  let sends = 0;
  const provider = createSdkProvider(null as any, {
    status: "connected",
    async sendText() {
      sends++;
      return { status: "failed" };
    },
  });
  const db = {
    async query(sql: string) {
      return {
        rows: sql.includes("delivery_parts")
          ? [{ part: 0 }]
          : [
              {
                text: "hello",
                provider_thread_id: "  \t ",
                provider_thread_type: 0,
                attachments: 0,
              },
            ],
      };
    },
  } as any;
  await assert.rejects(
    provider.prepareMessage!("message", db),
    /Unsupported SDK message/,
  );
  assert.equal(sends, 0);
});
