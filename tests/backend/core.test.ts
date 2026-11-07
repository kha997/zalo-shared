import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../../server/app.js";
import { seed } from "../../server/db.js";
import { isolatedDatabase } from "./isolation.js";
import { configFromEnv } from "../../server/config.js";
import { createMockProvider, runWorkerOnce } from "../../server/worker.js";
test("transactional authenticated inbox and durable dispatch", async () => {
  const database = await isolatedDatabase();
  const { pool } = database;
  await seed(pool, {
    adminEmail: "admin@example.test",
    adminPassword: "synthetic-password-123",
    demo: true,
  });
  const app = await buildApp({
    pool,
    config: configFromEnv({
      ...process.env,
      MOCK_ENABLED: "true",
      PROVIDER_MODE: "mock",
      PUBLIC_ORIGIN: "http://localhost:3100",
    }),
  });
  try {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: "admin@example.test",
        password: "synthetic-password-123",
      },
    });
    assert.equal(login.statusCode, 200);
    const headers = {
      cookie: login.headers["set-cookie"]!.toString().split(";")[0],
      origin: "http://localhost:3100",
      "x-csrf-token": login.json().csrfToken,
    };
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/provider/mock/state",
          headers: { cookie: headers.cookie },
          payload: { status: "connected" },
        })
      ).statusCode,
      403,
    );
    const employee = await app.inject({
      method: "POST",
      url: "/api/users",
      headers,
      payload: {
        name: "Synthetic Agent",
        email: "agent@example.test",
        password: "synthetic-agent-123",
        role: "agent",
      },
    });
    assert.equal(employee.statusCode, 200);
    const agentLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "agent@example.test", password: "synthetic-agent-123" },
    });
    const agentHeaders = {
      cookie: agentLogin.headers["set-cookie"]!.toString().split(";")[0],
      origin: "http://localhost:3100",
      "x-csrf-token": agentLogin.json().csrfToken,
    };
    assert.equal(
      (await app.inject({ url: "/api/audit", headers: agentHeaders }))
        .statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/provider/mock/state",
          headers: agentHeaders,
          payload: { status: "connected" },
        })
      ).statusCode,
      403,
    );
    await app.inject({
      method: "POST",
      url: "/api/provider/mock/inbound",
      headers,
      payload: {
        contactId: "agent-retry",
        contactName: "Retry",
        providerId: "agent-inbound",
        text: "hello",
      },
    });
    const retryConversation = (
      await app.inject({ url: "/api/conversations", headers })
    )
      .json()
      .items.find((x: any) => x.contactId === "agent-retry");
    await app.inject({
      method: "PATCH",
      url: `/api/conversations/${retryConversation.id}`,
      headers,
      payload: {
        expectedVersion: retryConversation.version,
        assigneeId: employee.json().id,
      },
    });
    const retrySend = (key: string) =>
      app.inject({
        method: "POST",
        url: `/api/conversations/${retryConversation.id}/messages`,
        headers: { ...agentHeaders, "idempotency-key": key },
        payload: { text: "original" },
      });
    const original = await retrySend("same-after-reassign");
    assert.equal(original.statusCode, 200);
    await app.inject({
      method: "PATCH",
      url: `/api/conversations/${retryConversation.id}`,
      headers,
      payload: {
        expectedVersion: retryConversation.version + 1,
        assigneeId: null,
      },
    });
    const retry = await retrySend("same-after-reassign");
    assert.equal(retry.statusCode, 200);
    assert.equal(retry.json().id, original.json().id);
    assert.equal((await retrySend("new-after-reassign")).statusCode, 403);
    assert.equal(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/users/${employee.json().id}`,
          headers,
          payload: { active: false },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (await app.inject({ url: "/api/auth/me", headers: agentHeaders }))
        .statusCode,
      401,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/attachments",
          headers,
          payload: {
            name: "bad.png",
            mime: "image/png",
            dataBase64: Buffer.from("not PNG").toString("base64"),
          },
        })
      ).statusCode,
      400,
    );
    const inbound = {
      contactId: "test",
      contactName: "Synthetic",
      providerId: "remote-1",
      text: "hello",
    };
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/provider/mock/inbound",
          headers,
          payload: inbound,
        })
      ).json().duplicate,
      false,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/provider/mock/inbound",
          headers,
          payload: inbound,
        })
      ).json().duplicate,
      true,
    );
    const c = (await app.inject({ url: "/api/conversations", headers }))
      .json()
      .items.find((x: any) => x.contactId === "test");
    assert.equal(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/conversations/${c.id}`,
          headers,
          payload: { expectedVersion: c.version, status: "resolved" },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/conversations/${c.id}`,
          headers,
          payload: { expectedVersion: c.version, status: "open" },
        })
      ).statusCode,
      409,
    );
    const send = () =>
      app.inject({
        method: "POST",
        url: `/api/conversations/${c.id}/messages`,
        headers: { ...headers, "idempotency-key": "send-1" },
        payload: { text: "reply" },
      });
    const [a, b] = await Promise.all([send(), send()]);
    assert.equal(a.statusCode, 200);
    assert.equal(a.json().id, b.json().id);
    await app.inject({
      method: "POST",
      url: "/api/provider/mock/state",
      headers,
      payload: { status: "connected" },
    });
    await runWorkerOnce(pool, createMockProvider(pool));
    await runWorkerOnce(pool, createMockProvider(pool));
    const messages = (
      await app.inject({ url: `/api/conversations/${c.id}/messages`, headers })
    ).json().items;
    assert.equal(
      messages.find((m: any) => m.id === a.json().id).status,
      "sent",
    );
  } finally {
    await app.close();
    await database.close();
  }
});
test("configuration rejects live provider and public HTTP", () => {
  assert.throws(() => configFromEnv({ PUBLIC_ORIGIN: "http://example.com" }));
  assert.throws(() => configFromEnv({ PROVIDER_MODE: "zalo" }));
  assert.throws(() =>
    configFromEnv({ NODE_ENV: "production", MOCK_ENABLED: "true" }),
  );
});
test("ambiguous delivery is quarantined without automatic retry", async () => {
  const database = await isolatedDatabase();
  const { pool } = database;
  const c = (
    await pool.query(
      "INSERT INTO conversations(contact_id,contact_name) VALUES('crash-test','Crash') ON CONFLICT(account_id,contact_id) DO UPDATE SET contact_name=excluded.contact_name RETURNING id",
    )
  ).rows[0];
  const m = (
    await pool.query(
      "INSERT INTO messages(conversation_id,direction,text,status) VALUES($1,'outbound','synthetic','pending') RETURNING id",
      [c.id],
    )
  ).rows[0];
  await pool.query("INSERT INTO outbox(message_id) VALUES($1)", [m.id]);
  await pool.query("INSERT INTO delivery_parts(message_id,part) VALUES($1,0)", [
    m.id,
  ]);
  let calls = 0;
  await runWorkerOnce(pool, {
    connected: async () => true,
    sendPart: async () => {
      calls++;
      throw new Error("ambiguous");
    },
  });
  await runWorkerOnce(pool, {
    connected: async () => true,
    sendPart: async () => {
      calls++;
      return "unexpected";
    },
  });
  assert.equal(calls, 1);
  assert.equal(
    (await pool.query("SELECT status FROM messages WHERE id=$1", [m.id]))
      .rows[0].status,
    "unknown",
  );
  await database.close();
});

test("audit prohibits update, delete and truncate even for ordinary owner SQL", async () => {
  const database = await isolatedDatabase();
  try {
    for (const statement of [
      "UPDATE audit SET action='changed'",
      "DELETE FROM audit",
      "TRUNCATE audit",
    ]) {
      if (statement.startsWith("UPDATE") || statement.startsWith("DELETE"))
        await database.pool.query("INSERT INTO audit(action) VALUES('test')");
      await assert.rejects(database.pool.query(statement), /append-only/);
    }
  } finally {
    await database.close();
  }
});
