import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { ACCOUNT } from "../../server/db.js";
import { createLocatorCipher } from "../../server/locator-cipher.js";
import { acquireConnectorOwnership } from "../../server/connector-ownership.js";
import { ingestProviderEvent } from "../../server/provider-store.js";
import { runMediaDownloadOnce } from "../../server/media-worker.js";
import { MediaDownloadError } from "../../server/private-media-download.js";
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
const input = (providerId: string) => ({
  threadType: 0 as const,
  threadId: "download-peer",
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
async function until(predicate: () => boolean) {
  const end = Date.now() + 3000;
  while (!predicate()) {
    assert.ok(Date.now() < end, "bounded synthetic download barrier timed out");
    await new Promise((r) => setImmediate(r));
  }
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(Error("bounded SQL test barrier timed out")),
          3000,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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

test("media GET materializes private bytes once, keeps native attribution and never changes send state", async () => {
  const { d, c, owner } = await ownedDatabase("ci-media-download");
  try {
    await owner.markActive();
    const event = await ingestProviderEvent(d.pool, input("one"), {
      owner: owner.token,
      mediaCipher: c,
    });
    let gets = 0;
    const options = {
      owner,
      cipher: c,
      policy,
      download: async () => {
        gets++;
        return {
          mime: "text/plain" as const,
          data: Buffer.from("synthetic private bytes"),
        };
      },
    };
    assert.deepEqual(await runMediaDownloadOnce(d.pool, options), {
      processed: true,
    });
    assert.deepEqual(await runMediaDownloadOnce(d.pool, options), {
      processed: false,
    });
    assert.equal(gets, 1);
    const job = (await d.pool.query("SELECT * FROM provider_media_jobs"))
      .rows[0];
    assert.equal(job.status, "ready");
    assert.equal(job.locator_envelope, null);
    const attachment = (await d.pool.query("SELECT * FROM attachments"))
      .rows[0];
    assert.equal(attachment.id, job.attachment_id);
    assert.equal(attachment.message_id, event.messageId);
    assert.equal(attachment.owner_id, null);
    assert.equal(attachment.data.toString(), "synthetic private bytes");
    assert.equal(
      (
        await d.pool.query("SELECT actor_id FROM messages WHERE id=$1", [
          event.messageId,
        ])
      ).rows[0].actor_id,
      null,
    );
    for (const table of ["outbox", "delivery_parts", "provider_ledger"])
      assert.equal(
        (await d.pool.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,
        0,
      );
    assert.equal(
      JSON.stringify((await d.pool.query("SELECT * FROM audit")).rows).includes(
        "synthetic=secret",
      ),
      false,
    );
  } finally {
    await owner.close();
    await d.close();
  }
});

test("media workers serialize one job, allow two distinct jobs and recover only unlocked processing work", async () => {
  const { d, c, owner } = await ownedDatabase("ci-media-parallel");
  let release!: () => void;
  const active: Promise<unknown>[] = [];
  const barrier = new Promise<void>((r) => {
    release = r;
  });
  try {
    await owner.markActive();
    await ingestProviderEvent(d.pool, input("first"), {
      owner: owner.token,
      mediaCipher: c,
    });
    let gets = 0;
    const options = {
      owner,
      cipher: c,
      policy,
      download: async () => {
        gets++;
        await barrier;
        return { mime: "text/plain" as const, data: Buffer.from("synthetic") };
      },
    };
    const first = runMediaDownloadOnce(d.pool, options);
    active.push(first);
    void first.catch(() => {});
    await until(() => gets >= 1);
    assert.deepEqual(await runMediaDownloadOnce(d.pool, options), {
      processed: false,
    });
    await ingestProviderEvent(d.pool, input("second"), {
      owner: owner.token,
      mediaCipher: c,
    });
    const second = runMediaDownloadOnce(d.pool, options);
    active.push(second);
    void second.catch(() => {});
    await until(() => gets >= 2);
    assert.deepEqual(await runMediaDownloadOnce(d.pool, options), {
      processed: false,
    });
    assert.equal(gets, 2);
    release();
    await Promise.all([first, second]);
    assert.equal(
      (await d.pool.query("SELECT count(*)::int n FROM attachments")).rows[0].n,
      2,
    );
    const recovery = await ingestProviderEvent(d.pool, input("crashed"), {
      owner: owner.token,
      mediaCipher: c,
    });
    await d.pool.query(
      "UPDATE provider_media_jobs SET status='processing',attempts=1,claimed_at=now() WHERE event_id=$1",
      [recovery.eventId],
    );
    await runMediaDownloadOnce(d.pool, {
      ...options,
      download: async () => ({
        mime: "text/plain",
        data: Buffer.from("recovered"),
      }),
    });
    const job = (
      await d.pool.query(
        "SELECT status,attempts FROM provider_media_jobs WHERE event_id=$1",
        [recovery.eventId],
      )
    ).rows[0];
    assert.deepEqual(job, { status: "ready", attempts: 2 });
  } finally {
    release?.();
    await Promise.allSettled(active);
    await owner.close();
    await d.close();
  }
});

test("media failures enforce expiry, missing-key, content, budget and three-attempt GET ceiling", async () => {
  const { d, c, owner } = await ownedDatabase("ci-media-failure");
  try {
    await owner.markActive();
    const expired = await ingestProviderEvent(d.pool, input("expired"), {
      owner: owner.token,
      mediaCipher: c,
    });
    await d.pool.query(
      "UPDATE provider_media_jobs SET created_at=now()-interval '25 hours' WHERE event_id=$1",
      [expired.eventId],
    );
    let gets = 0;
    const successful = async () => {
      gets++;
      return {
        mime: "text/plain" as const,
        data: Buffer.from("synthetic bytes"),
      };
    };
    await runMediaDownloadOnce(d.pool, {
      owner,
      cipher: c,
      policy,
      download: successful,
    });
    assert.equal(gets, 0);
    const expiredJob = (
      await d.pool.query(
        "SELECT status,error_code,locator_envelope FROM provider_media_jobs WHERE event_id=$1",
        [expired.eventId],
      )
    ).rows[0];
    assert.deepEqual(expiredJob, {
      status: "unavailable",
      error_code: "expired",
      locator_envelope: null,
    });
    await ingestProviderEvent(d.pool, input("wrong-key"), {
      owner: owner.token,
      mediaCipher: c,
    });
    await runMediaDownloadOnce(d.pool, {
      owner,
      cipher: cipher(),
      policy,
      download: successful,
    });
    assert.equal(gets, 0);
    await ingestProviderEvent(d.pool, input("oversize"), {
      owner: owner.token,
      mediaCipher: c,
    });
    await runMediaDownloadOnce(d.pool, {
      owner,
      cipher: c,
      policy,
      download: async () => ({
        mime: "text/plain",
        data: Buffer.alloc(5 * 1024 * 1024 + 1),
      }),
    });
    await ingestProviderEvent(d.pool, input("budget"), {
      owner: owner.token,
      mediaCipher: c,
    });
    await runMediaDownloadOnce(d.pool, {
      owner,
      cipher: c,
      policy,
      maxDownloadedBytes: 1,
      download: successful,
    });
    const retry = await ingestProviderEvent(d.pool, input("retry"), {
      owner: owner.token,
      mediaCipher: c,
    });
    for (let i = 0; i < 4; i++) {
      await d.pool.query(
        "UPDATE provider_media_jobs SET next_attempt_at=now() WHERE event_id=$1",
        [retry.eventId],
      );
      await runMediaDownloadOnce(d.pool, {
        owner,
        cipher: c,
        policy,
        download: async () => {
          gets++;
          throw new MediaDownloadError("network");
        },
      });
    }
    assert.equal(gets, 4); // one bounded-budget GET plus exactly three retry GETs
    assert.equal(
      (
        await d.pool.query(
          "SELECT attempts FROM provider_media_jobs WHERE event_id=$1",
          [retry.eventId],
        )
      ).rows[0].attempts,
      3,
    );
    assert.equal(
      (await d.pool.query("SELECT count(*)::int n FROM attachments")).rows[0].n,
      0,
    );
  } finally {
    await owner.close();
    await d.close();
  }
});

test("owner loss after GET cannot fabricate ready bytes", async () => {
  const { d, c, owner } = await ownedDatabase("ci-media-owner-loss");
  try {
    await owner.markActive();
    await ingestProviderEvent(d.pool, input("owner-loss"), {
      owner: owner.token,
      mediaCipher: c,
    });
    let gets = 0;
    await assert.rejects(
      runMediaDownloadOnce(d.pool, {
        owner,
        cipher: c,
        policy,
        download: async () => {
          gets++;
          await owner.invalidate("database-lost");
          return { mime: "text/plain", data: Buffer.from("must not persist") };
        },
      }),
      /Private media worker unavailable/,
    );
    assert.equal(gets, 1);
    assert.equal(
      (await d.pool.query("SELECT count(*)::int n FROM attachments")).rows[0].n,
      0,
    );
    assert.equal(
      (await d.pool.query("SELECT status FROM provider_media_jobs")).rows[0]
        .status,
      "processing",
    );
  } finally {
    await owner.close();
    await d.close();
  }
});

test("failed completion rolls back bytes, while a lost committed acknowledgement never redownloads", async () => {
  const { d, c, owner } = await ownedDatabase("ci-media-storage-loss");
  try {
    await owner.markActive();
    let gets = 0;
    const download = async () => {
      gets++;
      return {
        mime: "text/plain" as const,
        data: Buffer.from("atomic private bytes"),
      };
    };
    for (const afterCommit of [false, true]) {
      const event = await ingestProviderEvent(
        d.pool,
        input(afterCommit ? "commit-ack-loss" : "rollback"),
        { owner: owner.token, mediaCipher: c },
      );
      let injected = false;
      const failingPool = {
        async connect() {
          const client = await d.pool.connect();
          let inserted = false;
          return new Proxy(client, {
            get(target, property) {
              if (property === "query")
                return async (sql: string, values?: unknown[]) => {
                  if (/INSERT INTO attachments/.test(sql)) inserted = true;
                  if (sql === "COMMIT" && inserted && !injected) {
                    injected = true;
                    if (afterCommit) await target.query(sql);
                    throw Error("synthetic secret storage failure");
                  }
                  return target.query(sql, values);
                };
              const value = Reflect.get(target, property);
              return typeof value === "function" ? value.bind(target) : value;
            },
          });
        },
      } as any;
      await assert.rejects(
        runMediaDownloadOnce(failingPool, {
          owner,
          cipher: c,
          policy,
          download,
        }),
        /Private media worker unavailable/,
      );
      assert.equal(injected, true);
      const beforeRetryGets = gets;
      await runMediaDownloadOnce(d.pool, {
        owner,
        cipher: c,
        policy,
        download,
      });
      assert.equal(gets, beforeRetryGets + (afterCommit ? 0 : 1));
      const job = (
        await d.pool.query(
          "SELECT status,attachment_id FROM provider_media_jobs WHERE event_id=$1",
          [event.eventId],
        )
      ).rows[0];
      assert.equal(job.status, "ready");
      assert.ok(job.attachment_id);
    }
    assert.equal(
      (await d.pool.query("SELECT count(*)::int n FROM attachments")).rows[0].n,
      2,
    );
  } finally {
    await owner.close();
    await d.close();
  }
});

test("media completion and a different-conversation receipt share quota before provider locks", async () => {
  const { d, c, owner } = await ownedDatabase("ci-media-lock-order");
  let releaseGet!: () => void, releaseReceipt!: () => void;
  let getEntered!: () => void,
    quotaHeld!: () => void,
    completionQueued!: () => void;
  const getGate = new Promise<void>((r) => {
      releaseGet = r;
    }),
    receiptGate = new Promise<void>((r) => {
      releaseReceipt = r;
    });
  const sawGet = new Promise<void>((r) => {
      getEntered = r;
    }),
    sawQuota = new Promise<void>((r) => {
      quotaHeld = r;
    }),
    sawCompletion = new Promise<void>((r) => {
      completionQueued = r;
    });
  const active: Promise<unknown>[] = [];
  function wrapped(
    before: (sql: string) => Promise<void>,
    after?: (sql: string) => Promise<void>,
  ) {
    return {
      async connect() {
        const client = await d.pool.connect();
        return new Proxy(client, {
          get(target, property) {
            if (property === "query")
              return async (sql: string, values?: unknown[]) => {
                await before(sql);
                const result = await target.query(sql, values);
                await after?.(sql);
                return result;
              };
            const value = Reflect.get(target, property);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      },
    } as any;
  }
  try {
    await owner.markActive();
    await ingestProviderEvent(d.pool, input("completing"), {
      owner: owner.token,
      mediaCipher: c,
    });
    const workerPool = wrapped(async (sql) => {
      if (sql === "SELECT pg_advisory_xact_lock(73004,1)") completionQueued();
    });
    const receiptPool = wrapped(
      async () => {},
      async (sql) => {
        if (sql === "SELECT pg_advisory_xact_lock(73004,1)") {
          quotaHeld();
          await receiptGate;
        }
      },
    );
    const work = runMediaDownloadOnce(workerPool, {
      owner,
      cipher: c,
      policy,
      download: async () => {
        getEntered();
        await getGate;
        return { mime: "text/plain", data: Buffer.from("lock ordered bytes") };
      },
    });
    active.push(work);
    void work.catch(() => {});
    await bounded(sawGet);
    const receipt = ingestProviderEvent(
      receiptPool,
      { ...input("concurrent-receipt"), threadId: "different-conversation" },
      { owner: owner.token, mediaCipher: c },
    );
    active.push(receipt);
    void receipt.catch(() => {});
    await bounded(sawQuota);
    releaseGet();
    await bounded(sawCompletion);
    releaseReceipt();
    await bounded(Promise.all(active));
    assert.equal(
      (await d.pool.query("SELECT count(*)::int n FROM attachments")).rows[0].n,
      1,
    );
    assert.equal(
      (
        await d.pool.query(
          "SELECT count(*)::int n FROM provider_media_jobs WHERE status='pending'",
        )
      ).rows[0].n,
      1,
    );
  } finally {
    releaseGet?.();
    releaseReceipt?.();
    await Promise.allSettled(active);
    await owner.close();
    await d.close();
  }
});
