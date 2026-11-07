import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { randomBytes } from "node:crypto";
import { isolatedDatabase } from "./isolation.js";
import { createLocatorCipher } from "../../server/locator-cipher.js";
import {
  acquireConnectorOwnership,
  type OwnershipHandle,
} from "../../server/connector-ownership.js";
import { ingestProviderEvent } from "../../server/provider-store.js";
import { createOwnedConnector } from "../../adapters/zalo/connector-runtime.js";

const policy = {
  approvedHosts: new Set(["cdn.example.test"]),
  maxBytes: 5 * 1024 * 1024,
};
const cipher = () =>
  createLocatorCipher({
    activeKeyId: "synthetic",
    keys: new Map([["synthetic", randomBytes(32)]]),
    fingerprintKey: randomBytes(32),
  });
class Listener extends EventEmitter {
  start() {
    this.emit("connected");
  }
  stop() {}
}
const facade = () => ({
  async createApi() {
    return {
      listener: new Listener(),
      async sendMessage() {
        throw new Error("media seam must never send");
      },
    };
  },
  close() {},
});
const mediaInput = (providerId: string) => ({
  threadType: 0 as const,
  threadId: "runtime-media-peer",
  providerId,
  senderId: "synthetic-peer",
  isSelf: false,
  kind: "unsupported" as const,
  media: [
    {
      index: 0,
      name: "synthetic-runtime.txt",
      category: "file" as const,
      url: "https://cdn.example.test/synthetic?ref=private",
    },
  ],
});

test("owned runtime runs one bounded media step under the fence and never dispatches mail", async () => {
  const database = await isolatedDatabase();
  const { pool } = database;
  const c = cipher();
  let runtime: ReturnType<typeof createOwnedConnector> | undefined;
  let token: OwnershipHandle["token"] | undefined,
    gets = 0;
  try {
    runtime = createOwnedConnector({
      pool,
      ownerLabel: "ci-runtime-media",
      mediaCipher: c,
      media: {
        policy,
        async download() {
          gets++;
          return {
            mime: "text/plain" as const,
            data: Buffer.from("synthetic runtime media fixture"),
          };
        },
      },
      async acquireOwnership(p, o) {
        const owner = await acquireConnectorOwnership(p, o);
        token = owner.token;
        return owner;
      },
      createFacade: facade,
    });
    await runtime.start();
    const event = await ingestProviderEvent(pool, mediaInput("runtime-media"), {
      owner: token!,
      mediaCipher: c,
    });
    const conversation = (
      await pool.query("SELECT conversation_id FROM messages WHERE id=$1", [
        event.messageId,
      ])
    ).rows[0].conversation_id;
    const control = (
      await pool.query(
        "INSERT INTO messages(conversation_id,direction,text,status) VALUES($1,'outbound','synthetic media seam control','pending') RETURNING id",
        [conversation],
      )
    ).rows[0].id;
    await pool.query("INSERT INTO outbox(message_id,status) VALUES($1,'pending')", [
      control,
    ]);
    const outboxBefore = (await pool.query("SELECT * FROM outbox")).rows;
    assert.deepEqual(await runtime.runMediaOnce(), {
      iterations: 1,
      downloads: 1,
      expired: 0,
      stopped: "bounded",
    });
    assert.equal(gets, 1);
    const job = (
      await pool.query("SELECT * FROM provider_media_jobs WHERE event_id=$1", [
        event.eventId,
      ])
    ).rows[0];
    assert.equal(job.status, "ready");
    assert.ok(job.attachment_id);
    assert.equal(job.locator_envelope, null);
    assert.deepEqual((await pool.query("SELECT * FROM outbox")).rows, outboxBefore);
    assert.equal(
      (
        await pool.query("SELECT status FROM messages WHERE id=$1", [control])
      ).rows[0].status,
      "pending",
    );
    await runtime.stop();
    await assert.rejects(runtime.runMediaOnce(), /unavailable/);
  } finally {
    await runtime?.stop().catch(() => {});
    await database.close();
  }
});

test("media seam is opt-in and stops at the owner fence", async () => {
  const database = await isolatedDatabase();
  const { pool } = database;
  const c = cipher();
  let runtime: ReturnType<typeof createOwnedConnector> | undefined,
    owner: OwnershipHandle | undefined,
    token: OwnershipHandle["token"] | undefined;
  try {
    runtime = createOwnedConnector({
      pool,
      ownerLabel: "ci-runtime-media-fence",
      mediaCipher: c,
      async acquireOwnership(p, o) {
        owner = await acquireConnectorOwnership(p, o);
        token = owner.token;
        return owner;
      },
      createFacade: facade,
    });
    await runtime.start();
    await assert.rejects(runtime.runMediaOnce(), /unavailable/);
    const event = await ingestProviderEvent(
      pool,
      mediaInput("runtime-media-fence"),
      { owner: token!, mediaCipher: c },
    );
    await owner!.invalidate("shutdown");
    await assert.rejects(runtime.runMediaOnce(), /unavailable/);
    const job = (
      await pool.query("SELECT status,locator_envelope FROM provider_media_jobs WHERE event_id=$1", [
        event.eventId,
      ])
    ).rows[0];
    assert.notEqual(job.status, "ready");
    assert.notEqual(job.locator_envelope, null);
  } finally {
    await runtime?.stop().catch(() => {});
    await database.close();
  }
});
