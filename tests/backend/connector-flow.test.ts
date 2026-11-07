import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../server/app.js";
import { ACCOUNT, seed } from "../../server/db.js";
import { configFromEnv } from "../../server/config.js";
import { ingestProviderEvent } from "../../server/provider-store.js";
import { runWorkerOnce } from "../../server/worker.js";
import { createSdkProvider } from "../../adapters/zalo/provider.js";
import { createZaloTransport } from "../../adapters/zalo/transport.js";
import { isolatedDatabase } from "./isolation.js";

// Injected simulation: real HTTP/auth/store/worker/transport, no SDK authentication.
test("four HTTP staff retain attribution through SDK-shaped ingress, retries, early echoes and session loss", async () => {
  const database = await isolatedDatabase();
  const { pool } = database;
  const origin = "http://127.0.0.1:3100";
  const email = `${randomUUID()}@example.test`, password = randomUUID();
  await seed(pool, { adminEmail: email, adminPassword: password });
  const app = await buildApp({ pool, config: configFromEnv({ ...process.env,
    MOCK_ENABLED: "false", PROVIDER_MODE: "disabled", PUBLIC_ORIGIN: origin }) });
  const sent: { peer: string; text: string }[] = [];
  let faultDone!: () => void;
  const faultPersisted = new Promise<void>(resolve => { faultDone = resolve; });
  let faultFailure: unknown;
  class Listener extends EventEmitter {
    start(options: { retryOnClose: boolean }) {
      assert.equal(options.retryOnClose, false);
      this.emit("connected");
    }
    stop() {}
  }
  const listener = new Listener();
  const raw = (peer: string, id: string, self: boolean, text: string) => ({
    threadId: peer, type: 0, isSelf: self,
    data: { msgId: id, uidFrom: self ? "synthetic-self" : peer, msgType: "webchat", content: text },
  });
  const transport = createZaloTransport({
    approvedSdk: { async createApi(options) {
      assert.deepEqual(options, { logging: false, selfListen: true, checkUpdate: false });
      return { listener, async sendMessage(text, peer, type) {
        assert.equal(type, 0);
        sent.push({ peer, text });
        // All peers deliberately reuse the same ID; identity must include thread scope.
        listener.emit("message", raw(peer, "same-outbound-id", true, text));
        await transport.drain(); // Durable early echo before SDK-shaped acknowledgement.
        assert.equal((await pool.query("SELECT state FROM provider_events WHERE thread_id=$1 AND direction='outbound'", [peer])).rows[0].state, "held");
        return { message: { msgId: "same-outbound-id" } };
      } };
    } },
    onInbound: async event => {
      assert.ok(event.threadType === 0 || event.threadType === 1);
      await ingestProviderEvent(pool, { ...event, threadType: event.threadType });
    },
    onFault: async reason => {
      try {
        await pool.query("UPDATE provider_state SET status='disconnected',reconciliation_required=true,fault_code=$2 WHERE account_id=$1", [ACCOUNT, reason]);
      } catch (error) { faultFailure = error; throw error; }
      finally { faultDone(); }
    },
  });
  try {
    const base = await app.listen({ host: "127.0.0.1", port: 0 });
    type Client = { id: string; headers: Record<string, string> };
    async function request(path: string, method = "GET", body?: unknown, client?: Client, key?: string) {
      return fetch(base + path, { method, headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...client?.headers, ...(key ? { "idempotency-key": key } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    }
    async function login(email: string, password: string): Promise<Client> {
      const response = await request("/api/auth/login", "POST", { email, password });
      assert.equal(response.status, 200);
      const result = await response.json() as any;
      return { id: result.user.id, headers: { cookie: response.headers.get("set-cookie")!.split(";")[0], origin, "x-csrf-token": result.csrfToken } };
    }
    const admin = await login(email, password);
    const staff: Client[] = [];
    for (let i = 0; i < 4; i++) {
      const email = `${randomUUID()}@example.test`, password = randomUUID();
      assert.equal((await request("/api/users", "POST", { name: `Staff ${i}`, email, password, role: "agent" }, admin)).status, 200);
      staff.push(await login(email, password));
    }
    assert.equal(new Set(staff.map(s => s.id)).size, 4);
    assert.equal((await request("/api/provider/mock/state", "POST", { status: "connected" }, admin)).status, 404);
    await transport.start();
    await pool.query("UPDATE provider_state SET status='connected',reconciliation_required=false WHERE account_id=$1", [ACCOUNT]);
    for (let i = 0; i < 4; i++) {
      listener.emit("message", raw(`peer-${i}`, "same-inbound-id", false, `Inbound ${i}`));
    }
    await transport.drain();
    const conversations = (await pool.query("SELECT * FROM conversations ORDER BY provider_thread_id")).rows;
    assert.equal(conversations.length, 4);
    assert.equal((await pool.query("SELECT count(*)::int n FROM messages WHERE direction='inbound'")).rows[0].n, 4);
    const keys = staff.map(() => randomUUID());
    for (const [i, c] of conversations.entries()) {
      assert.equal((await request(`/api/conversations/${c.id}`, "PATCH", { expectedVersion: c.version, assigneeId: staff[i].id }, admin)).status, 200);
      // Exercise both protections over HTTP before the valid enqueue.
      assert.equal((await request(`/api/conversations/${c.id}/messages`, "POST", { text: `Reply ${i}` }, { ...staff[i], headers: { ...staff[i].headers, origin: "http://evil.example" } }, randomUUID())).status, 403);
      assert.equal((await request(`/api/conversations/${c.id}/messages`, "POST", { text: `Reply ${i}` }, { ...staff[i], headers: { ...staff[i].headers, "x-csrf-token": "wrong" } }, randomUUID())).status, 403);
    }
    const enqueue = (i: number, key = keys[i]) => request(`/api/conversations/${conversations[i].id}/messages`, "POST", { text: `Reply ${i}` }, staff[i], key);
    await Promise.all(staff.map(async (_, i) => {
      const retries = await Promise.all([enqueue(i), enqueue(i), enqueue(i)]);
      for (const response of retries) assert.equal(response.status, 200);
      const bodies = await Promise.all(retries.map(r => r.json()));
      assert.deepEqual(bodies[0], bodies[1]);
      assert.deepEqual(bodies[0], bodies[2]);
    }));
    assert.equal((await pool.query("SELECT count(*)::int n FROM outbox")).rows[0].n, 4);
    const provider = createSdkProvider(pool, transport);
    for (let i = 0; i < 5; i++) await runWorkerOnce(pool, provider);
    await transport.drain();
    assert.deepEqual(sent.sort((a,b) => a.peer.localeCompare(b.peer)), staff.map((_, i) => ({ peer: `peer-${i}`, text: `Reply ${i}` })));
    const outbound = (await pool.query("SELECT m.actor_id,m.status,m.provider_id,c.provider_thread_id FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE direction='outbound' ORDER BY c.provider_thread_id")).rows;
    assert.equal(outbound.length, 4, "early self echoes must not duplicate app sends");
    assert.equal((await pool.query("SELECT count(*)::int n FROM provider_events WHERE direction='outbound' AND state='linked'")).rows[0].n, 4);
    for (const [i, message] of outbound.entries()) {
      assert.equal(message.actor_id, staff[i].id);
      assert.equal(message.status, "sent");
      assert.equal(message.provider_id, "same-outbound-id");
      assert.equal((await enqueue(i)).status, 200);
    }
    await runWorkerOnce(pool, provider);
    assert.equal(sent.length, 4);
    listener.emit("message", raw("peer-0", "native-phone-id", true, "Synthetic native phone event"));
    await transport.drain();
    assert.equal((await pool.query("SELECT actor_id FROM messages WHERE provider_id='native-phone-id'")).rows[0].actor_id, null);
    listener.emit("closed", 3000);
    await faultPersisted;
    assert.equal(faultFailure, undefined);
    assert.equal(transport.status, "expired");
    assert.deepEqual((await pool.query("SELECT status,reconciliation_required FROM provider_state WHERE account_id=$1", [ACCOUNT])).rows[0], { status: "disconnected", reconciliation_required: true });
    assert.equal((await enqueue(0, randomUUID())).status, 200, "app can queue while session is invalid");
    await runWorkerOnce(pool, provider);
    await transport.start();
    assert.deepEqual(await transport.sendText("peer-0", "blocked"), { status: "failed" });
    assert.equal(sent.length, 4, "invalid session must block additional SDK calls");
    assert.equal((await pool.query("SELECT count(*)::int n FROM outbox WHERE status='pending'")).rows[0].n, 1);
  } finally {
    transport.stop();
    await app.close();
    await database.close();
  }
});
