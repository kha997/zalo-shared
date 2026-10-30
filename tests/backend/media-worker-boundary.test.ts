import test from "node:test";
import assert from "node:assert/strict";
import { runMediaDownloadOnce } from "../../server/media-worker.js";
import { ACCOUNT } from "../../server/db.js";
import { MediaDownloadError } from "../../server/private-media-download.js";

const token = {
  accountId: ACCOUNT,
  ownerId: "00000000-0000-4000-8000-000000000099",
  epoch: "1",
};
function options() {
  return {
    owner: {
      token,
      admitted: true,
      async assertCurrent() {},
      async markActive() {},
      async invalidate() {},
      async close() {},
    },
    cipher: {
      seal() {
        throw Error("unused");
      },
      open() {
        throw Error("unused");
      },
      fingerprint() {
        throw Error("unused");
      },
    },
    policy: { approvedHosts: new Set<string>(), maxBytes: 5 * 1024 * 1024 },
  };
}
test("download worker refuses invalid admission and budgets before any database or GET access", async () => {
  let connections = 0,
    gets = 0;
  const pool = {
    async connect() {
      connections++;
      throw Error("private-database");
    },
  } as any;
  const download = async () => {
    gets++;
    return { mime: "text/plain" as const, data: Buffer.from("synthetic") };
  };
  for (const o of [
    { ...options(), owner: { ...options().owner, admitted: false } },
    { ...options(), maxDownloadedBytes: 0 },
    { ...options(), maxDownloadedBytes: Number.MAX_SAFE_INTEGER },
    {
      ...options(),
      owner: {
        ...options().owner,
        token: { ...token, accountId: "00000000-0000-4000-8000-000000000002" },
      },
    },
  ])
    await assert.rejects(
      runMediaDownloadOnce(pool, { ...o, download }),
      /Private media worker unavailable/,
    );
  assert.equal(connections, 0);
  assert.equal(gets, 0);
});
test("download worker returns idle under lane contention without touching receipt or GET", async () => {
  let queries = 0,
    released = 0,
    gets = 0;
  const pool = {
    async connect() {
      return {
        async query(sql: string) {
          queries++;
          assert.match(sql, /pg_try_advisory_lock/);
          return { rows: [{ locked: false }], rowCount: 1 };
        },
        release() {
          released++;
        },
      };
    },
  } as any;
  assert.deepEqual(
    await runMediaDownloadOnce(pool, {
      ...options(),
      download: async () => {
        gets++;
        throw Error("must not GET");
      },
    }),
    { processed: false },
  );
  assert.equal(queries, 2);
  assert.equal(released, 1);
  assert.equal(gets, 0);
});
test("download worker sanitizes acquisition failure and never performs a GET", async () => {
  let gets = 0;
  await assert.rejects(
    runMediaDownloadOnce(
      {
        connect: async () => {
          throw Error("secret://database-password");
        },
      } as any,
      {
        ...options(),
        download: async () => {
          gets++;
          throw Error("must not GET");
        },
      },
    ),
    (e: unknown) =>
      e instanceof Error &&
      e.message === "Private media worker unavailable" &&
      e.cause === undefined,
  );
  assert.equal(gets, 0);
});

function controlledReceipt() {
  const id = "00000000-0000-4000-8000-000000000001",
    eventId = "00000000-0000-4000-8000-000000000002",
    messageId = "00000000-0000-4000-8000-000000000003";
  const descriptor = {
    index: 0,
    name: "private.txt",
    category: "file",
    locatorFingerprint: "a".repeat(64),
  };
  let live = true,
    gap = false;
  let job: any = {
    id,
    event_id: eventId,
    account_id: ACCOUNT,
    item_index: 0,
    category: "file",
    name: descriptor.name,
    locator_fingerprint: descriptor.locatorFingerprint,
    locator_envelope: {},
    message_id: messageId,
    status: "pending",
    attempts: 0,
    version: "1",
    age_seconds: 0,
  };
  const event = {
    id: eventId,
    conversation_id: id,
    message_id: messageId,
    provider_id: "synthetic",
    conflict: false,
    media_descriptor: [descriptor],
  };
  const attachments: unknown[] = [],
    audit: unknown[] = [];
  const listeners = new Map<string, Set<() => void>>();
  let snapshot: any;
  const bump = () =>
    String(
      BigInt(job.version) < 9223372036854775807n
        ? BigInt(job.version) + 1n
        : BigInt(job.version),
    );
  const db = {
    on(name: string, fn: () => void) {
      const set = listeners.get(name) ?? new Set();
      set.add(fn);
      listeners.set(name, set);
    },
    off(name: string, fn: () => void) {
      listeners.get(name)?.delete(fn);
    },
    release() {},
    async query(sql: string, values: any[] = []) {
      const result = (rows: any[] = [], rowCount = rows.length) => ({
        rows,
        rowCount,
      });
      if (sql.includes("pg_try_advisory_lock"))
        return result([{ locked: true }]);
      if (
        sql.includes("pg_advisory_unlock") ||
        sql.includes("pg_advisory_xact_lock")
      )
        return result([{}]);
      if (sql === "BEGIN") {
        snapshot = structuredClone({
          job,
          attachmentCount: attachments.length,
          auditCount: audit.length,
        });
        return result();
      }
      if (sql === "COMMIT") {
        snapshot = undefined;
        return result();
      }
      if (sql === "ROLLBACK") {
        if (snapshot) {
          job = snapshot.job;
          attachments.length = snapshot.attachmentCount;
          audit.length = snapshot.auditCount;
        }
        snapshot = undefined;
        return result();
      }
      if (sql.startsWith("SELECT j.id FROM"))
        return result(
          ["pending", "processing", "held"].includes(job.status)
            ? [{ id }]
            : [],
        );
      if (sql.includes("FROM connector_ownership"))
        return result([{ account_id: ACCOUNT }]);
      if (sql.startsWith("SELECT e.id AS event_id"))
        return result([{ event_id: eventId, conversation_id: id }]);
      if (sql.startsWith("SELECT conversation_id FROM provider_events"))
        return result([{ conversation_id: id }]);
      if (sql.startsWith("SELECT id FROM conversations"))
        return result([{ id }]);
      if (sql.startsWith("SELECT * FROM provider_events"))
        return result([event]);
      if (sql.startsWith("SELECT *,extract")) return result([{ ...job }]);
      if (sql.includes("set_config")) return result([{}]);
      if (sql.includes("current_setting"))
        return result([{ marker: "active" }]);
      if (sql.startsWith("SELECT id FROM messages"))
        return result([{ id: messageId }]);
      if (sql.startsWith("SELECT p.attachment_id")) return result([]);
      if (sql.startsWith("UPDATE provider_media_jobs SET message_id="))
        return result([], 0);
      if (sql.startsWith("SELECT reconciliation_required"))
        return result([{ reconciliation_required: gap }]);
      if (
        sql.startsWith("UPDATE provider_media_jobs SET status='processing'")
      ) {
        job = {
          ...job,
          status: "processing",
          attempts: job.attempts + 1,
          version: bump(),
        };
        return result([{ ...job }]);
      }
      if (
        sql.startsWith("UPDATE provider_media_jobs SET status='unavailable'")
      ) {
        job = {
          ...job,
          status: "unavailable",
          error_code: values[2],
          locator_envelope: values[3] ? null : job.locator_envelope,
          version: bump(),
        };
        return result([], 1);
      }
      if (sql.startsWith("UPDATE provider_media_jobs SET status=$3")) {
        job = {
          ...job,
          status: values[2],
          error_code: values[3],
          version: bump(),
        };
        return result([], 1);
      }
      if (sql.startsWith("SELECT coalesce(sum"))
        return result([{ bytes: "0" }]);
      if (sql.startsWith("INSERT INTO attachments")) {
        attachments.push(values[3]);
        return result([{ id: "00000000-0000-4000-8000-000000000004" }]);
      }
      if (sql.startsWith("UPDATE provider_media_jobs SET status='ready'")) {
        job = {
          ...job,
          status: "ready",
          locator_envelope: null,
          attachment_id: values[2],
          version: bump(),
        };
        return result([], 1);
      }
      if (sql.startsWith("INSERT INTO audit")) {
        audit.push(values);
        return result([], 1);
      }
      throw Error("unexpected controlled SQL");
    },
  };
  return {
    pool: { connect: async () => db } as any,
    options: {
      ...options(),
      owner: {
        ...options().owner,
        get admitted() {
          return live;
        },
        async assertCurrent() {
          if (!live) throw Error("private-owner");
        },
      },
      policy: {
        approvedHosts: new Set(["cdn.example.test"]),
        maxBytes: 5 * 1024 * 1024,
      },
      cipher: {
        seal() {
          throw Error("unused");
        },
        open() {
          return "https://cdn.example.test/private?synthetic=secret";
        },
        fingerprint() {
          return descriptor.locatorFingerprint;
        },
      },
    },
    get job() {
      return job;
    },
    attachments,
    audit,
    revoke() {
      live = false;
    },
    setGap() {
      gap = true;
    },
    endDatabase() {
      for (const fn of listeners.get("end") ?? []) fn();
    },
  };
}
test("controlled worker commits ready bytes once and treats malformed content as permanent", async () => {
  const f = controlledReceipt();
  let gets = 0;
  const download = async () => {
    gets++;
    return { mime: "text/plain" as const, data: Buffer.from("private bytes") };
  };
  assert.deepEqual(
    await runMediaDownloadOnce(f.pool, { ...f.options, download }),
    { processed: true },
  );
  assert.equal(f.job.status, "ready");
  assert.equal(f.job.locator_envelope, null);
  assert.equal(f.attachments.length, 1);
  await runMediaDownloadOnce(f.pool, { ...f.options, download });
  assert.equal(gets, 1);
  const malformed = controlledReceipt();
  await runMediaDownloadOnce(malformed.pool, {
    ...malformed.options,
    download: async () => ({ mime: "text/plain", data: Buffer.from([255]) }),
  });
  assert.equal(malformed.job.status, "unavailable");
  assert.equal(malformed.job.error_code, "content");
  assert.equal(malformed.attachments.length, 0);
});
test("controlled owner or gap loss during GET cannot materialize late bytes", async () => {
  for (const revoke of [true, false]) {
    const f = controlledReceipt();
    const work = runMediaDownloadOnce(f.pool, {
      ...f.options,
      download: async () => {
        if (revoke) f.revoke();
        else f.setGap();
        return { mime: "text/plain", data: Buffer.from("late private bytes") };
      },
    });
    if (revoke) await assert.rejects(work, /Private media worker unavailable/);
    else assert.deepEqual(await work, { processed: true });
    assert.equal(f.job.status, "processing");
    assert.equal(f.attachments.length, 0);
  }
});
test("controlled retry and audit expose only fixed download error codes", async () => {
  const f = controlledReceipt();
  await runMediaDownloadOnce(f.pool, {
    ...f.options,
    download: async () => {
      throw new MediaDownloadError("secret-token-url" as any);
    },
  });
  assert.equal(f.job.status, "pending");
  assert.equal(f.job.error_code, "network");
  assert.equal(JSON.stringify(f.audit).includes("secret-token-url"), false);
});

test("two in-process GET slots stay held after database loss until late GETs settle", async () => {
  const first = controlledReceipt(),
    second = controlledReceipt(),
    third = controlledReceipt();
  let release!: () => void,
    gets = 0;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const download = async () => {
    gets++;
    await gate;
    return {
      mime: "text/plain" as const,
      data: Buffer.from("bounded private bytes"),
    };
  };
  const tasks = [
    runMediaDownloadOnce(first.pool, { ...first.options, download }),
    runMediaDownloadOnce(second.pool, { ...second.options, download }),
  ];
  for (const task of tasks) void task.catch(() => {});
  try {
    const end = Date.now() + 2000;
    while (gets < 2) {
      assert.ok(Date.now() < end);
      await new Promise((r) => setImmediate(r));
    }
    first.endDatabase();
    assert.deepEqual(
      await runMediaDownloadOnce(third.pool, { ...third.options, download }),
      { processed: false },
    );
    assert.equal(gets, 2);
    release();
    const results = await Promise.allSettled(tasks);
    assert.equal(results[0].status, "rejected");
    assert.equal(results[1].status, "fulfilled");
    assert.equal(first.attachments.length, 0);
    assert.equal(second.attachments.length, 1);
    await runMediaDownloadOnce(third.pool, { ...third.options, download });
    assert.equal(gets, 3);
    assert.equal(third.attachments.length, 1);
  } finally {
    release?.();
    await Promise.allSettled(tasks);
  }
});

test("terminal job versions cannot wrap or start a GET", async () => {
  for (const initial of ["9223372036854775806", "9223372036854775807"]) {
    const f = controlledReceipt();
    f.job.version = initial;
    let gets = 0;
    await runMediaDownloadOnce(f.pool, {
      ...f.options,
      download: async () => {
        gets++;
        return { mime: "text/plain", data: Buffer.from("must not GET") };
      },
    });
    assert.equal(gets, 0);
    assert.equal(f.job.version, "9223372036854775807");
    assert.equal(f.job.status, "unavailable");
    assert.equal(f.job.error_code, "version-exhausted");
  }
});

test(
  "worker acquisition deadline discards a late client without issuing SQL",
  { timeout: 5000 },
  async () => {
    let finish!: (client: any) => void,
      released = 0,
      queries = 0;
    const acquired = new Promise<any>((resolve) => {
      finish = resolve;
    });
    await assert.rejects(
      runMediaDownloadOnce({ connect: () => acquired } as any, options()),
      /Private media worker unavailable/,
    );
    finish({
      release(destroy: boolean) {
        assert.equal(destroy, true);
        released++;
      },
      query() {
        queries++;
      },
    });
    await new Promise((r) => setImmediate(r));
    assert.equal(released, 1);
    assert.equal(queries, 0);
  },
);

test(
  "worker SQL deadline discards its session and cannot resurrect late advisory acquisition",
  { timeout: 5000 },
  async () => {
    let finish!: (result: any) => void,
      queries = 0,
      released = 0;
    const answer = new Promise<any>((resolve) => {
      finish = resolve;
    });
    const client = {
      on() {},
      release(destroy: boolean) {
        assert.equal(destroy, true);
        released++;
      },
      query() {
        queries++;
        return answer;
      },
    };
    await assert.rejects(
      runMediaDownloadOnce({ connect: async () => client } as any, options()),
      /Private media worker unavailable/,
    );
    finish({ rows: [{ locked: true }], rowCount: 1 });
    await new Promise((r) => setImmediate(r));
    assert.equal(released, 1);
    assert.equal(queries, 1);
  },
);
