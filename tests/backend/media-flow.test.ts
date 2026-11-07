import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { buildApp } from "../../server/app.js";
import { ACCOUNT, seed } from "../../server/db.js";
import { configFromEnv } from "../../server/config.js";
import { ingestProviderEvent } from "../../server/provider-store.js";
import { runWorkerOnce } from "../../server/worker.js";
import { createZaloTransport } from "../../adapters/zalo/transport.js";
import { createSdkProvider } from "../../adapters/zalo/provider.js";
import type { MediaInput } from "../../adapters/zalo/media.js";
import { isolatedDatabase } from "./isolation.js";

// Four synthetic HTTP sessions; no SDK import, upload or real-phone operation.
test("four HTTP staff send ordered private media once through actual connector persistence", async () => {
  const database = await isolatedDatabase();
  const { pool } = database;
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  let transport: ReturnType<typeof createZaloTransport> | undefined;
  try {
    const origin = "http://127.0.0.1:3100";
    const email = `${randomUUID()}@example.test`,
      password = randomUUID();
    await seed(pool, { adminEmail: email, adminPassword: password });
    app = await buildApp({
      pool,
      config: configFromEnv({
        PROVIDER_MODE: "disabled",
        PUBLIC_ORIGIN: origin,
        LOGIN_RATE_LIMIT: "30",
      }),
    });
    const base = await app.listen({ host: "127.0.0.1", port: 0 });
    type Client = { id: string; headers: Record<string, string> };
    const request = (
      path: string,
      method = "GET",
      body?: unknown,
      client?: Client,
      key?: string,
    ) =>
      fetch(base + path, {
        method,
        headers: {
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...client?.headers,
          ...(key ? { "idempotency-key": key } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    async function login(email: string, password: string): Promise<Client> {
      const r = await request("/api/auth/login", "POST", { email, password });
      assert.equal(r.status, 200);
      const b = (await r.json()) as any;
      return {
        id: b.user.id,
        headers: {
          cookie: r.headers.get("set-cookie")!.split(";")[0],
          origin,
          "x-csrf-token": b.csrfToken,
        },
      };
    }
    const admin = await login(email, password),
      staff: Client[] = [];
    for (let i = 0; i < 4; i++) {
      const email = `${randomUUID()}@example.test`,
        password = randomUUID();
      assert.equal(
        (
          await request(
            "/api/users",
            "POST",
            { name: `Media staff ${i}`, email, password, role: "agent" },
            admin,
          )
        ).status,
        200,
      );
      staff.push(await login(email, password));
    }
    assert.equal(new Set(staff.map((s) => s.id)).size, 4);
    const calls: { peer: string; kind: string; body: string }[] = [];
    class Listener extends EventEmitter {
      start() {
        this.emit("connected");
      }
      stop() {}
    }
    const listener = new Listener();
    function frame(peer: string, id: string, self: boolean, text?: string) {
      return {
        threadId: peer,
        type: 0,
        isSelf: self,
        data: {
          msgId: id,
          uidFrom: self ? "synthetic-self" : peer,
          msgType: text === undefined ? "chat.photo" : "webchat",
          content: text ?? {
            href: "https://untrusted.example.test/must-not-fetch",
          },
        },
      };
    }
    let faultResolve!: () => void, faultReject!: (error: unknown) => void;
    const faultPersisted = new Promise<void>((resolve, reject) => {
      faultResolve = resolve;
      faultReject = reject;
    });
    // Observe rejection immediately even if an earlier assertion exits before the barrier.
    void faultPersisted.catch(() => {});
    const ack = async (peer: string, id: string, text?: string) => {
      listener.emit("message", frame(peer, id, true, text));
      await transport!.drain();
      assert.equal(
        (
          await pool.query(
            "SELECT state FROM provider_events WHERE thread_id=$1 AND provider_id=$2 AND direction='outbound'",
            [peer, id],
          )
        ).rows[0].state,
        "held",
      );
    };
    transport = createZaloTransport({
      approvedSdk: {
        async createApi() {
          return {
            listener,
            async sendMessage(text: string, peer: string, type = 0) {
              assert.equal(type, 0);
              calls.push({ peer, kind: "text", body: text });
              await ack(peer, "shared-text-id", text);
              return { message: { msgId: "shared-text-id" } };
            },
            async sendAttachment(input: MediaInput, peer: string, type = 0) {
              assert.equal(type, 0);
              assert.ok(Buffer.isBuffer(input.data));
              const body = input.data.toString("utf8");
              calls.push({ peer, kind: input.mime, body });
              const id =
                input.mime === "application/pdf"
                  ? "shared-pdf-id"
                  : "shared-file-id";
              await ack(peer, id);
              return { message: null, attachment: [{ msgId: id }] };
            },
          };
        },
      },
      onInbound: async (event) => {
        await ingestProviderEvent(pool, event);
      },
      onFault: async (reason) => {
        try {
          await pool.query(
            "UPDATE provider_state SET status='disconnected',reconciliation_required=true,fault_code=$2 WHERE account_id=$1",
            [ACCOUNT, reason],
          );
          faultResolve();
        } catch (error) {
          faultReject(error);
          throw error;
        }
      },
    });
    await transport.start();
    await pool.query(
      "UPDATE provider_state SET status='connected',reconciliation_required=false WHERE account_id=$1",
      [ACCOUNT],
    );
    for (let i = 0; i < 4; i++)
      listener.emit(
        "message",
        frame(`media-peer-${i}`, "shared-inbound-id", false, `Inbound ${i}`),
      );
    await transport.drain();
    const convs = (
      await pool.query(
        "SELECT * FROM conversations ORDER BY provider_thread_id",
      )
    ).rows;
    assert.equal(convs.length, 4);
    const uploads: { text: string; pdf: string }[] = [];
    for (let i = 0; i < 4; i++) {
      assert.equal(
        (
          await request(
            `/api/conversations/${convs[i].id}`,
            "PATCH",
            { expectedVersion: convs[i].version, assigneeId: staff[i].id },
            admin,
          )
        ).status,
        200,
      );
      const upload = async (name: string, mime: string, data: string) => {
        const r = await request(
          "/api/attachments",
          "POST",
          { name, mime, dataBase64: Buffer.from(data).toString("base64") },
          staff[i],
        );
        assert.equal(r.status, 200);
        return ((await r.json()) as any).id as string;
      };
      const text = await upload(
        "note.txt",
        "text/plain",
        `Synthetic file ${i}`,
      );
      const pdf = await upload(
        "paper.pdf",
        "application/pdf",
        `%PDF-1.7\nSynthetic ${i}`,
      );
      uploads.push({ text, pdf });
      assert.equal((await request(`/api/attachments/${text}`)).status, 401);
      assert.equal(
        (
          await request(
            `/api/attachments/${text}`,
            "GET",
            undefined,
            staff[(i + 1) % 4],
          )
        ).status,
        404,
      );
      const ownDownload = await request(
        `/api/attachments/${text}`,
        "GET",
        undefined,
        staff[i],
      );
      assert.equal(ownDownload.status, 200);
      assert.equal(await ownDownload.text(), `Synthetic file ${i}`);
    }
    const enqueue = (
      i: number,
      key: string,
      ids = [uploads[i].pdf, uploads[i].text],
    ) =>
      request(
        `/api/conversations/${convs[i].id}/messages`,
        "POST",
        { text: `Reply ${i}`, attachmentIds: ids },
        staff[i],
        key,
      );
    assert.equal(
      (await enqueue(0, randomUUID(), [uploads[1].text])).status,
      400,
    );
    assert.equal(
      (
        await request(
          "/api/users",
          "POST",
          {
            name: "Forbidden",
            email: `${randomUUID()}@example.test`,
            password: randomUUID(),
            role: "agent",
          },
          staff[0],
        )
      ).status,
      403,
    );
    const keys = staff.map(() => randomUUID());
    await Promise.all(
      staff.map(async (_, i) => {
        const retries = await Promise.all([
          enqueue(i, keys[i]),
          enqueue(i, keys[i]),
          enqueue(i, keys[i]),
        ]);
        for (const r of retries) assert.equal(r.status, 200);
        const bodies = await Promise.all(retries.map((r) => r.json()));
        assert.deepEqual(bodies[0], bodies[1]);
        assert.deepEqual(bodies[0], bodies[2]);
      }),
    );
    const provider = createSdkProvider(pool, transport);
    for (let i = 0; i < 5; i++) await runWorkerOnce(pool, provider);
    await transport.drain();
    assert.equal(calls.length, 12);
    for (let i = 0; i < 4; i++)
      assert.deepEqual(
        calls.filter((c) => c.peer === `media-peer-${i}`),
        [
          { peer: `media-peer-${i}`, kind: "text", body: `Reply ${i}` },
          {
            peer: `media-peer-${i}`,
            kind: "application/pdf",
            body: `%PDF-1.7\nSynthetic ${i}`,
          },
          {
            peer: `media-peer-${i}`,
            kind: "text/plain",
            body: `Synthetic file ${i}`,
          },
        ],
      );
    const outbound = (
      await pool.query(
        "SELECT m.id,m.actor_id,m.status,c.provider_thread_id FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE direction='outbound' ORDER BY c.provider_thread_id",
      )
    ).rows;
    assert.equal(
      outbound.length,
      4,
      "media self echoes must link to original app message",
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int n FROM provider_events WHERE direction='outbound' AND state='linked'",
        )
      ).rows[0].n,
      12,
    );
    for (let i = 0; i < 4; i++) {
      assert.equal(outbound[i].actor_id, staff[i].id);
      assert.equal(outbound[i].status, "sent");
      assert.equal((await enqueue(i, keys[i])).status, 200);
      const download = await request(
        `/api/attachments/${uploads[i].pdf}`,
        "GET",
        undefined,
        staff[i],
      );
      assert.equal(download.status, 200);
      assert.equal(await download.text(), `%PDF-1.7\nSynthetic ${i}`);
    }
    await runWorkerOnce(pool, provider);
    assert.equal(calls.length, 12);
    listener.emit("message", frame("media-peer-0", "native-media-id", true));
    await transport.drain();
    assert.deepEqual(
      (
        await pool.query(
          "SELECT actor_id,text FROM messages WHERE provider_id='native-media-id'",
        )
      ).rows[0],
      { actor_id: null, text: "[Unsupported Zalo message]" },
    );
    listener.emit("closed", 3000);
    await faultPersisted;
    assert.equal(transport.status, "expired");
    // Existing media cannot be reclaimed. A text-only new intent may queue while invalid.
    assert.equal(
      (
        await request(
          `/api/conversations/${convs[0].id}/messages`,
          "POST",
          { text: "Blocked" },
          staff[0],
          randomUUID(),
        )
      ).status,
      200,
    );
    await runWorkerOnce(pool, provider);
    assert.equal(calls.length, 12);
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int n FROM outbox WHERE status='pending'",
        )
      ).rows[0].n,
      1,
    );
  } finally {
    transport?.stop();
    await app?.close();
    await database.close();
  }
});
