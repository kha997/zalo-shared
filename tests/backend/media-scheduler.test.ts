import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createLocatorCipher } from "../../server/locator-cipher.js";
import {
  acquireConnectorOwnership,
  type OwnershipHandle,
} from "../../server/connector-ownership.js";
import { ingestProviderEvent } from "../../server/provider-store.js";
import { expireMediaLocators } from "../../server/media-retention.js";
import { runMediaScheduler } from "../../server/media-scheduler.js";
import { isolatedDatabase } from "./isolation.js";

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
const input = (providerId: string, threadId = "media-retention-peer") => ({
  threadType: 0 as const,
  threadId,
  providerId,
  senderId: "peer",
  isSelf: false,
  kind: "unsupported" as const,
  media: [
    {
      index: 0,
      name: "private.txt",
      category: "file" as const,
      url: "https://cdn.example.test/private?synthetic=secret",
    },
  ],
});
async function ownedDatabase(ownerLabel: string) {
  const d = await isolatedDatabase();
  try {
    const owner = await acquireConnectorOwnership(d.pool, {
      ownerLabel,
      onRevoked() {},
    });
    return { d, c: cipher(), owner };
  } catch (error) {
    await d.close();
    throw error;
  }
}
const fakeDownload = () => {
  let gets = 0;
  return {
    get calls() {
      return gets;
    },
    download: async () => {
      gets++;
      return {
        mime: "text/plain" as const,
        data: Buffer.from("synthetic scheduled media"),
      };
    },
  };
};
const jobFor = async (db: any, eventId: string) =>
  (
    await db.query("SELECT * FROM provider_media_jobs WHERE event_id=$1", [
      eventId,
    ])
  ).rows[0];

test("retention erases only expired encrypted locators and leaves delivery state untouched", async () => {
  const { d, c, owner } = await ownedDatabase("ci-retention");
  try {
    await owner.markActive();
    const aged = await ingestProviderEvent(d.pool, input("aged"), {
      owner: owner.token,
      mediaCipher: c,
    });
    const fresh = await ingestProviderEvent(d.pool, input("fresh"), {
      owner: owner.token,
      mediaCipher: c,
    });
    const conversation = (
      await d.pool.query("SELECT conversation_id FROM messages WHERE id=$1", [
        aged.messageId,
      ])
    ).rows[0].conversation_id;
    const control = (
      await d.pool.query(
        "INSERT INTO messages(conversation_id,direction,text,status) VALUES($1,'outbound','synthetic retention control','pending') RETURNING id",
        [conversation],
      )
    ).rows[0].id;
    await d.pool.query(
      "INSERT INTO outbox(message_id,status) VALUES($1,'pending')",
      [control],
    );
    const outboxBefore = (await d.pool.query("SELECT * FROM outbox")).rows;
    await d.pool.query(
      "UPDATE provider_media_jobs SET created_at=now()-interval '25 hours' WHERE event_id=$1",
      [aged.eventId],
    );
    const result = await expireMediaLocators(d.pool, { owner });
    assert.deepEqual(result, { expired: 1 });
    const expired = await jobFor(d.pool, aged.eventId);
    assert.equal(expired.status, "unavailable");
    assert.equal(expired.error_code, "expired");
    assert.equal(expired.locator_envelope, null);
    assert.equal(expired.claimed_at, null);
    assert.ok(BigInt(expired.version) >= 1n);
    const kept = await jobFor(d.pool, fresh.eventId);
    assert.notEqual(kept.locator_envelope, null);
    assert.ok(["held", "pending"].includes(kept.status));
    assert.deepEqual(
      (
        await d.pool.query(
          "SELECT action,target_id FROM audit WHERE action='media.locator_expired'",
        )
      ).rows,
      [{ action: "media.locator_expired", target_id: expired.id }],
    );
    assert.deepEqual((await d.pool.query("SELECT * FROM outbox")).rows, outboxBefore);
    assert.equal(
      (
        await d.pool.query("SELECT status FROM messages WHERE id=$1", [control])
      ).rows[0].status,
      "pending",
    );
  } finally {
    await owner.close().catch(() => {});
    await d.close();
  }
});

test("retention fails closed on stale or revoked ownership", async () => {
  const { d, c, owner } = await ownedDatabase("ci-retention-owner");
  try {
    await owner.markActive();
    const event = await ingestProviderEvent(d.pool, input("owned"), {
      owner: owner.token,
      mediaCipher: c,
    });
    await d.pool.query(
      "UPDATE provider_media_jobs SET created_at=now()-interval '25 hours' WHERE event_id=$1",
      [event.eventId],
    );
    const stale: OwnershipHandle = {
      ...owner,
      token: { ...owner.token, ownerId: randomUUID() },
      admitted: true,
      assertCurrent: async () => {},
    };
    await assert.rejects(
      () => expireMediaLocators(d.pool, { owner: stale }),
      /unavailable/,
    );
    assert.notEqual((await jobFor(d.pool, event.eventId)).locator_envelope, null);
    await owner.invalidate("shutdown");
    await assert.rejects(
      () => expireMediaLocators(d.pool, { owner }),
      /unavailable/,
    );
    assert.notEqual((await jobFor(d.pool, event.eventId)).locator_envelope, null);
  } finally {
    await owner.close().catch(() => {});
    await d.close();
  }
});

test("retention is bounded per run", async () => {
  const { d, c, owner } = await ownedDatabase("ci-retention-bound");
  try {
    await owner.markActive();
    for (const providerId of ["bound-a", "bound-b", "bound-c"])
      await ingestProviderEvent(d.pool, input(providerId), {
        owner: owner.token,
        mediaCipher: c,
      });
    await d.pool.query(
      "UPDATE provider_media_jobs SET created_at=now()-interval '25 hours'",
    );
    assert.deepEqual(await expireMediaLocators(d.pool, { owner, maxJobs: 2 }), {
      expired: 2,
    });
    assert.equal(
      (
        await d.pool.query(
          "SELECT count(*)::int n FROM provider_media_jobs WHERE locator_envelope IS NOT NULL",
        )
      ).rows[0].n,
      1,
    );
    assert.deepEqual(await expireMediaLocators(d.pool, { owner, maxJobs: 2 }), {
      expired: 1,
    });
  } finally {
    await owner.close().catch(() => {});
    await d.close();
  }
});

test("scheduler is bounded, maintains locators and never dispatches outbox work", async () => {
  const { d, c, owner } = await ownedDatabase("ci-media-scheduler");
  try {
    await owner.markActive();
    const due = await ingestProviderEvent(d.pool, input("scheduled"), {
      owner: owner.token,
      mediaCipher: c,
    });
    const aged = await ingestProviderEvent(d.pool, input("scheduled-aged"), {
      owner: owner.token,
      mediaCipher: c,
    });
    await d.pool.query(
      "UPDATE provider_media_jobs SET created_at=now()-interval '25 hours' WHERE event_id=$1",
      [aged.eventId],
    );
    const conversation = (
      await d.pool.query("SELECT conversation_id FROM messages WHERE id=$1", [
        due.messageId,
      ])
    ).rows[0].conversation_id;
    const control = (
      await d.pool.query(
        "INSERT INTO messages(conversation_id,direction,text,status) VALUES($1,'outbound','synthetic scheduler control','pending') RETURNING id",
        [conversation],
      )
    ).rows[0].id;
    await d.pool.query(
      "INSERT INTO outbox(message_id,status) VALUES($1,'pending')",
      [control],
    );
    const outboxBefore = (await d.pool.query("SELECT * FROM outbox")).rows;
    const fake = fakeDownload();
    const result = await runMediaScheduler({
      pool: d.pool,
      worker: { owner, cipher: c, policy, download: fake.download },
      maxIterations: 3,
      maintenanceEvery: 1,
      idleDelayMs: 0,
      sleep: async () => {},
    });
    assert.deepEqual(result, {
      iterations: 3,
      downloads: 1,
      expired: 1,
      stopped: "bounded",
    });
    assert.equal(fake.calls, 1);
    assert.equal((await jobFor(d.pool, due.eventId)).status, "ready");
    assert.equal((await jobFor(d.pool, aged.eventId)).status, "unavailable");
    assert.deepEqual((await d.pool.query("SELECT * FROM outbox")).rows, outboxBefore);
    assert.equal(
      (
        await d.pool.query("SELECT status FROM messages WHERE id=$1", [control])
      ).rows[0].status,
      "pending",
    );
    await owner.invalidate("shutdown");
    const stopped = await runMediaScheduler({
      pool: d.pool,
      worker: { owner, cipher: c, policy, download: fake.download },
      maxIterations: 1,
      idleDelayMs: 0,
      sleep: async () => {},
    });
    assert.deepEqual(stopped, {
      iterations: 0,
      downloads: 0,
      expired: 0,
      stopped: "owner-lost",
    });
    assert.equal(fake.calls, 1);
  } finally {
    await owner.close().catch(() => {});
    await d.close();
  }
});

test("scheduler refuses downloads when the keyring lacks an envelope key", async () => {
  const { d, c, owner } = await ownedDatabase("ci-media-keyring");
  try {
    await owner.markActive();
    const event = await ingestProviderEvent(d.pool, input("key-missing"), {
      owner: owner.token,
      mediaCipher: c,
    });
    const otherKey = createLocatorCipher({
      activeKeyId: "replacement",
      keys: new Map([["replacement", randomBytes(32)]]),
      fingerprintKey: randomBytes(32),
    });
    const fake = fakeDownload();
    const result = await runMediaScheduler({
      pool: d.pool,
      worker: { owner, cipher: otherKey, policy, download: fake.download },
      maxIterations: 1,
      maintenanceEvery: 1,
      idleDelayMs: 0,
      sleep: async () => {},
    });
    assert.deepEqual(result, {
      iterations: 1,
      downloads: 0,
      expired: 0,
      stopped: "key-missing",
    });
    assert.equal(fake.calls, 0);
    assert.notEqual((await jobFor(d.pool, event.eventId)).locator_envelope, null);
  } finally {
    await owner.close().catch(() => {});
    await d.close();
  }
});

test("migration provides the message-scoped media lookup index", async () => {
  const d = await isolatedDatabase();
  try {
    const row = await d.pool.query(
      "SELECT indexname FROM pg_indexes WHERE schemaname=current_schema() AND tablename='provider_media_jobs' AND indexname='provider_media_jobs_message'",
    );
    assert.equal(row.rowCount, 1);
  } finally {
    await d.close();
  }
});
