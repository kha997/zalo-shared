import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../server/app.js";
import { seed } from "../../server/db.js";
import { configFromEnv } from "../../server/config.js";
import { isolatedDatabase } from "./isolation.js";

async function fixture(mockEnabled = true) {
  const database = await isolatedDatabase();
  const email = `${randomUUID()}@example.test`, password = randomUUID();
  await seed(database.pool, { adminEmail: email, adminPassword: password });
  const app = await buildApp({ pool: database.pool, config: configFromEnv({ ...process.env,
    MOCK_ENABLED: String(mockEnabled), PROVIDER_MODE: mockEnabled ? "mock" : "disabled", PUBLIC_ORIGIN: "http://localhost:3100" }) });
  async function login(email: string, password: string) {
    const r = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
    assert.equal(r.statusCode, 200);
    return { user: r.json().user, headers: { cookie: r.headers["set-cookie"]!.toString().split(";")[0],
      origin: "http://localhost:3100", "x-csrf-token": r.json().csrfToken } };
  }
  const admin = await login(email, password);
  return { ...database, app, admin, async actor(role: "agent" | "supervisor") {
    const email = `${randomUUID()}@example.test`, password = randomUUID();
    const r = await app.inject({ method: "POST", url: "/api/users", headers: admin.headers, payload: { name: role, email, password, role } });
    assert.equal(r.statusCode, 200);
    return login(email, password);
  }, async conversation(assigneeId: string | null = null) {
    return (await database.pool.query("INSERT INTO conversations(contact_id,contact_name,assignee_id) VALUES($1,'Synthetic',$2) RETURNING *", [randomUUID(), assigneeId])).rows[0];
  }, async close() { await app.close(); await database.close(); } };
}

test("last active administrator cannot be disabled or demoted", async () => {
  const f = await fixture();
  try {
    for (const payload of [{ active: false }, { role: "agent" }, { role: "supervisor" }])
      assert.equal((await f.app.inject({ method: "PATCH", url: `/api/users/${f.admin.user.id}`, headers: f.admin.headers, payload })).statusCode, 409);
    assert.equal((await f.app.inject({ url: "/api/auth/me", headers: f.admin.headers })).statusCode, 200);
    assert.deepEqual((await f.pool.query("SELECT role,active FROM users WHERE id=$1", [f.admin.user.id])).rows[0], { role: "admin", active: true });
  } finally { await f.close(); }
});

test("administrator mock mutations return 404 when mock is disabled", async () => {
  const f = await fixture(false);
  try {
    assert.equal((await f.app.inject({ method: "POST", url: "/api/provider/mock/state", headers: f.admin.headers, payload: { status: "connected" } })).statusCode, 404);
    assert.equal((await f.app.inject({ method: "POST", url: "/api/provider/mock/inbound", headers: f.admin.headers,
      payload: { contactId: "synthetic", contactName: "Synthetic", providerId: "synthetic", text: "hello" } })).statusCode, 404);
    assert.equal((await f.pool.query("SELECT count(*)::int n FROM messages")).rows[0].n, 0);
  } finally { await f.close(); }
});

for (const role of ["admin", "supervisor"] as const) test(`lost-response retry survives ${role} reassignment but a new send is forbidden`, async () => {
  const f = await fixture();
  try {
    const agent = await f.actor("agent"), other = await f.actor("agent");
    const reassigner = role === "admin" ? f.admin : await f.actor("supervisor");
    const c = await f.conversation(agent.user.id), key = randomUUID();
    const send = (requestKey: string) => f.app.inject({ method: "POST", url: `/api/conversations/${c.id}/messages`,
      headers: { ...agent.headers, "idempotency-key": requestKey }, payload: { text: "synthetic original" } });
    const original = await send(key);
    assert.equal(original.statusCode, 200);
    assert.equal((await f.app.inject({ method: "PATCH", url: `/api/conversations/${c.id}`, headers: reassigner.headers,
      payload: { expectedVersion: c.version, assigneeId: other.user.id } })).statusCode, 200);
    const retry = await send(key);
    assert.equal(retry.statusCode, 200);
    assert.deepEqual(retry.json(), original.json());
    assert.equal((await send(randomUUID())).statusCode, 403);
    assert.equal((await f.pool.query("SELECT count(*)::int n FROM messages WHERE conversation_id=$1", [c.id])).rows[0].n, 1);
    assert.equal((await f.pool.query("SELECT count(*)::int n FROM outbox")).rows[0].n, 1);
  } finally { await f.close(); }
});

test("concurrent agent claims have one winner and one version conflict", async () => {
  const f = await fixture();
  try {
    const agents = await Promise.all([f.actor("agent"), f.actor("agent")]), c = await f.conversation();
    const responses = await Promise.all(agents.map(agent => f.app.inject({ method: "PATCH", url: `/api/conversations/${c.id}`,
      headers: agent.headers, payload: { expectedVersion: c.version, assigneeId: agent.user.id } })));
    assert.deepEqual(responses.map(r => r.statusCode).sort(), [200, 409]);
    const stored = (await f.pool.query("SELECT assignee_id,version FROM conversations WHERE id=$1", [c.id])).rows[0];
    assert.equal(stored.assignee_id, agents[responses.findIndex(r => r.statusCode === 200)].user.id);
    assert.equal(stored.version, c.version + 1);
  } finally { await f.close(); }
});

test("foreign-account conversations and attachments are hidden with 404", async () => {
  const f = await fixture();
  try {
    const account = randomUUID();
    const c = (await f.pool.query("INSERT INTO conversations(account_id,contact_id,contact_name) VALUES($1,$2,'Foreign synthetic') RETURNING id", [account, randomUUID()])).rows[0];
    const m = (await f.pool.query("INSERT INTO messages(conversation_id,direction,text,status) VALUES($1,'inbound','foreign','received') RETURNING id", [c.id])).rows[0];
    const a = (await f.pool.query("INSERT INTO attachments(account_id,owner_id,name,mime,data,message_id) VALUES($1,$2,'foreign.txt','text/plain',$3,$4) RETURNING id", [account, f.admin.user.id, Buffer.from("foreign"), m.id])).rows[0];
    const requests = [
      { url: `/api/conversations/${c.id}/messages` },
      { method: "PATCH" as const, url: `/api/conversations/${c.id}`, payload: { expectedVersion: 1, status: "resolved" } },
      { method: "POST" as const, url: `/api/conversations/${c.id}/read`, payload: {} },
      { method: "POST" as const, url: `/api/conversations/${c.id}/messages`, payload: { text: "forbidden" } },
      { url: `/api/attachments/${a.id}` },
    ];
    for (const request of requests) assert.equal((await f.app.inject({ ...request, headers: { ...f.admin.headers, "idempotency-key": randomUUID() } })).statusCode, 404);
    assert.equal((await f.app.inject({ url: "/api/conversations", headers: f.admin.headers })).json().items.some((item: any) => item.id === c.id), false);
  } finally { await f.close(); }
});

test("message pagination preserves all 100 microsecond timestamps within one millisecond", async () => {
  const f = await fixture();
  try {
    const c = await f.conversation();
    await f.pool.query(`INSERT INTO messages(conversation_id,direction,text,status,created_at)
      SELECT $1,'inbound',n::text,'received','2026-01-01 00:00:00.123000+00'::timestamptz + n * interval '1 microsecond' FROM generate_series(1,100) n`, [c.id]);
    const expected = (await f.pool.query("SELECT id FROM messages WHERE conversation_id=$1 ORDER BY created_at,id", [c.id])).rows.map(r => r.id);
    const pages: string[][] = [];
    let before: string | undefined;
    for (let page = 0; page < 12; page++) {
      const response = await f.app.inject({ url: `/api/conversations/${c.id}/messages?limit=13${before ? `&before=${before}` : ""}`, headers: f.admin.headers });
      assert.equal(response.statusCode, 200);
      const ids = response.json().items.map((m: any) => m.id) as string[];
      if (!ids.length) break;
      pages.unshift(ids);
      before = ids[0];
    }
    const actual = pages.flat();
    assert.equal(actual.length, 100, "pagination must not drop sub-millisecond messages");
    assert.equal(new Set(actual).size, 100, "pagination must not duplicate messages");
    assert.deepEqual(actual, expected);
  } finally { await f.close(); }
});
