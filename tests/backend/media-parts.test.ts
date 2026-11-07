import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../server/app.js";
import { ACCOUNT, migrate, seed } from "../../server/db.js";
import { configFromEnv } from "../../server/config.js";
import { isolatedDatabase } from "./isolation.js";

test("media enqueue binds original UUID order atomically and retains it across retries and migration", async () => {
  const database = await isolatedDatabase();
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  try {
    const pool = database.pool;
    const password = randomUUID();
    await seed(pool, {
      adminEmail: "media@example.test",
      adminPassword: password,
      demo: true,
    });
    app = await buildApp({ pool, config: configFromEnv({}) });
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "media@example.test", password },
    });
    assert.equal(login.statusCode, 200);
    const headers = {
      cookie: String(login.headers["set-cookie"]).split(";")[0],
      origin: "http://127.0.0.1:3100",
      "x-csrf-token": login.json().csrfToken,
    };
    const cid = (await pool.query("SELECT id FROM conversations")).rows[0].id;
    const owner = (await pool.query("SELECT id FROM users")).rows[0].id;
    const upload = async (name: string) => {
      const r = await app!.inject({
        method: "POST",
        url: "/api/attachments",
        headers,
        payload: {
          name,
          mime: "text/plain",
          dataBase64: Buffer.from("synthetic").toString("base64"),
        },
      });
      assert.equal(r.statusCode, 200);
      return r.json().id as string;
    };
    const first = await upload("first.txt"),
      second = await upload("second.txt");
    const enqueue = (key: string, attachmentIds: string[]) =>
      app!.inject({
        method: "POST",
        url: `/api/conversations/${cid}/messages`,
        headers: { ...headers, "idempotency-key": key },
        payload: { text: "synthetic", attachmentIds },
      });
    assert.equal((await enqueue("duplicate", [first, first])).statusCode, 400);
    const response = await enqueue("ordered", [second, first]);
    assert.equal(response.statusCode, 200);
    const mid = response.json().id;
    const bindings = async () =>
      (
        await pool.query(
          "SELECT part,attachment_id FROM delivery_parts WHERE message_id=$1 ORDER BY part",
          [mid],
        )
      ).rows;
    assert.deepEqual(await bindings(), [
      { part: 0, attachment_id: null },
      { part: 1, attachment_id: second },
      { part: 2, attachment_id: first },
    ]);
    assert.equal((await enqueue("ordered", [second, first])).json().id, mid);
    assert.equal((await enqueue("ordered", [first, second])).statusCode, 409);
    await migrate(pool);
    assert.deepEqual(await bindings(), [
      { part: 0, attachment_id: null },
      { part: 1, attachment_id: second },
      { part: 2, attachment_id: first },
    ]);
    assert.equal(
      (await pool.query("SELECT count(*)::int n FROM outbox")).rows[0].n,
      1,
    );
    const available = await upload("available.txt");
    const foreignOwner = (
      await pool.query(
        "INSERT INTO users(name,email,password_hash,role) VALUES('Other','other@example.test','unused','agent') RETURNING id",
      )
    ).rows[0].id;
    const foreign = (
      await pool.query(
        "INSERT INTO attachments(owner_id,name,mime,data) VALUES($1,'foreign.txt','text/plain',$2) RETURNING id",
        [foreignOwner, Buffer.from("synthetic")],
      )
    ).rows[0].id;
    const otherAccount = (
      await pool.query(
        "INSERT INTO attachments(account_id,owner_id,name,mime,data) VALUES($1,$2,'other-account.txt','text/plain',$3) RETURNING id",
        [randomUUID(), owner, Buffer.from("synthetic")],
      )
    ).rows[0].id;
    for (const unavailable of [foreign, otherAccount, randomUUID(), first]) {
      assert.equal(
        (await enqueue(randomUUID(), [available, unavailable])).statusCode,
        400,
      );
      assert.equal(
        (
          await pool.query("SELECT message_id FROM attachments WHERE id=$1", [
            available,
          ])
        ).rows[0].message_id,
        null,
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int n FROM messages WHERE direction='outbound'",
          )
        ).rows[0].n,
        1,
      );
      assert.equal(
        (await pool.query("SELECT count(*)::int n FROM outbox")).rows[0].n,
        1,
      );
    }
    await assert.rejects(
      pool.query(
        "UPDATE delivery_parts SET attachment_id=$2 WHERE message_id=$1 AND part=0",
        [mid, available],
      ),
      { code: "23514" },
    );
    await assert.rejects(
      pool.query(
        "INSERT INTO delivery_parts(message_id,part,attachment_id) VALUES($1,3,$2)",
        [mid, second],
      ),
      { code: "23505" },
    );
    await assert.rejects(
      pool.query(
        "INSERT INTO delivery_parts(message_id,part,attachment_id) VALUES($1,3,$2)",
        [mid, randomUUID()],
      ),
      { code: "23503" },
    );
    // Existing unmapped rows remain explicit legacy data; never guess UUID order.
    const legacy = (
      await pool.query(
        "INSERT INTO messages(conversation_id,direction,text,status) VALUES($1,'outbound','legacy','pending') RETURNING id",
        [cid],
      )
    ).rows[0].id;
    await pool.query(
      "INSERT INTO delivery_parts(message_id,part) VALUES($1,0),($1,1)",
      [legacy],
    );
    await migrate(pool);
    assert.deepEqual(
      (
        await pool.query(
          "SELECT attachment_id FROM delivery_parts WHERE message_id=$1 ORDER BY part",
          [legacy],
        )
      ).rows,
      [{ attachment_id: null }, { attachment_id: null }],
    );
    assert.equal(
      (
        await pool.query("SELECT account_id FROM attachments WHERE id=$1", [
          first,
        ])
      ).rows[0].account_id,
      ACCOUNT,
    );
  } finally {
    await app?.close();
    await database.close();
  }
});
