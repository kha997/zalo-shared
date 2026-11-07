import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  acquireConnectorOwnership,
  acknowledgeConnectorFence,
} from "../../server/connector-ownership.js";
import { ACCOUNT, migrate } from "../../server/db.js";
import { isolatedDatabase } from "./isolation.js";

class Client extends EventEmitter {
  released = 0;
  destroyed = false;
  queries: string[] = [];
  phase = "idle";
  epoch = "9007199254740993";
  owner: string | null = null;
  fail = false;
  hang = false;
  locked = true;
  late: (() => void) | undefined;
  async query(sql: string, values?: any[]) {
    this.queries.push(sql);
    if (this.fail) throw new Error("SECRET database detail");
    if (this.hang && sql.includes("heartbeat_at"))
      return new Promise<any>((resolve) => {
        this.late = () =>
          resolve({ rows: [{ epoch: this.epoch }], rowCount: 1 });
      });
    if (sql.includes("pg_try_advisory_lock"))
      return { rows: [{ locked: this.locked }], rowCount: 1 };
    if (sql.includes("FOR UPDATE"))
      return { rows: [{ phase: this.phase }], rowCount: 1 };
    if (sql.includes("SET phase='reserved'")) {
      this.phase = "reserved";
      this.owner = values![1];
      return { rows: [{ epoch: this.epoch }], rowCount: 1 };
    }
    if (sql.includes("SET phase='active'")) this.phase = "active";
    if (sql.includes("SET phase='uncertain'")) this.phase = "uncertain";
    return { rows: [{ epoch: this.epoch, marker: "active" }], rowCount: 1 };
  }
  release(destroy?: boolean) {
    this.released++;
    this.destroyed = !!destroy;
  }
}
const pool = (c: Client) => ({ connect: async () => c }) as any;

test("ownership reserves before admission, retains bigint string and closes uncertain once", async () => {
  const c = new Client();
  let revoked = 0;
  const owner = await acquireConnectorOwnership(pool(c), {
    ownerLabel: "synthetic-worker",
    onRevoked: () => {
      revoked++;
    },
  });
  assert.equal(owner.admitted, true);
  assert.equal(owner.token.epoch, "9007199254740993");
  assert.ok(c.queries.includes("COMMIT"));
  await owner.markActive();
  await owner.assertCurrent();
  const ending = owner.close();
  assert.equal(owner.admitted, false);
  await ending;
  await owner.close();
  assert.equal(revoked, 1);
  assert.equal(c.phase, "uncertain");
  assert.equal(c.released, 1);
  assert.equal(c.destroyed, true);
  await assert.rejects(
    owner.assertCurrent(),
    /^Error: Connector ownership unavailable$/,
  );
});
test("ownership errors are terminal, sanitized and cannot be revived by later success", async () => {
  for (const event of ["error", "end"]) {
    const c = new Client();
    let revoked = 0;
    const owner = await acquireConnectorOwnership(pool(c), {
      ownerLabel: "synthetic",
      onRevoked: () => {
        revoked++;
      },
    });
    c.emit(event, new Error("SECRET session"));
    assert.equal(owner.admitted, false);
    assert.equal(revoked, 1);
    await assert.rejects(owner.markActive(), /Connector ownership unavailable/);
    await owner.close();
    assert.equal(c.released, 1);
    assert.equal(c.destroyed, true);
  }
  const c = new Client();
  const owner = await acquireConnectorOwnership(pool(c), {
    ownerLabel: "synthetic",
    onRevoked: () => {},
  });
  c.fail = true;
  await assert.rejects(
    owner.assertCurrent(),
    /^Error: Connector ownership unavailable$/,
  );
  c.fail = false;
  await assert.rejects(owner.assertCurrent(), /unavailable/);
  await owner.close();
});
test("heartbeat timeout destroys its dedicated client without queuing writes on a hung query", async () => {
  const c = new Client();
  let revoke!: () => void;
  const revoked = new Promise<void>((r) => {
    revoke = r;
  });
  const owner = await acquireConnectorOwnership(pool(c), {
    ownerLabel: "synthetic",
    onRevoked: revoke,
    heartbeatMs: 100,
    queryTimeoutMs: 100,
  });
  c.hang = true;
  await Promise.race([
    revoked,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("heartbeat not revoked")), 1000),
    ),
  ]);
  assert.equal(owner.admitted, false);
  c.late?.();
  await Promise.resolve();
  assert.equal(owner.admitted, false);
  await owner.close();
  assert.equal(c.released, 1);
  assert.equal(
    c.queries.filter((s) => s.includes("SET phase='uncertain'")).length,
    0,
  );
});
test("late pool acquisition after deadline is discarded without reserving ownership", async () => {
  const c = new Client();
  let release!: (c: Client) => void;
  const pending = new Promise<Client>((resolve) => {
    release = resolve;
  });
  const acquisition = acquireConnectorOwnership(
    { connect: () => pending } as any,
    { ownerLabel: "synthetic", onRevoked: () => {}, queryTimeoutMs: 100 },
  );
  await assert.rejects(acquisition, /^Error: Connector ownership unavailable$/);
  release(c);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(c.released, 1);
  assert.equal(c.destroyed, true);
  assert.equal(c.queries.length, 0);
});
test("non-idle state blocks a new owner despite an available database lock", async () => {
  const c = new Client();
  c.phase = "reserved";
  let revoked = 0;
  await assert.rejects(
    acquireConnectorOwnership(pool(c), {
      ownerLabel: "synthetic",
      onRevoked: () => {
        revoked++;
      },
    }),
    /Connector ownership unavailable/,
  );
  assert.equal(c.owner, null);
  assert.equal(c.destroyed, true);
  assert.equal(c.released, 1);
});
test("lock contention and unknown reservation commit never return an admitted handle", async () => {
  const c = new Client();
  c.locked = false;
  await assert.rejects(
    acquireConnectorOwnership(pool(c), {
      ownerLabel: "synthetic",
      onRevoked: () => {},
    }),
  );
  assert.equal(
    c.queries.some((s) => s.includes("SET phase='reserved'")),
    false,
  );
  const unknown = new Client();
  const original = unknown.query.bind(unknown);
  unknown.query = async (sql, values) => {
    if (sql === "COMMIT") throw new Error("SECRET commit uncertainty");
    return original(sql, values);
  };
  await assert.rejects(
    acquireConnectorOwnership(pool(unknown), {
      ownerLabel: "synthetic",
      onRevoked: () => {},
    }),
    /^Error: Connector ownership unavailable$/,
  );
  assert.equal(unknown.phase, "reserved");
  assert.equal(unknown.destroyed, true);
});
test("invalid ownership/fence inputs reject before opening or querying a database", async () => {
  await assert.rejects(
    acquireConnectorOwnership(null as any, {
      ownerLabel: "https://user:secret@host",
      onRevoked: () => {},
    }),
    /unavailable/,
  );
  await assert.rejects(
    acquireConnectorOwnership(null as any, {
      ownerLabel: "ok",
      onRevoked: () => {},
      heartbeatMs: 99,
    }),
    /unavailable/,
  );
  await assert.rejects(
    acknowledgeConnectorFence(
      null as any,
      { id: "no" },
      {
        expectedOwnerId: "no",
        expectedEpoch: "1",
        evidenceRef: "https://secret",
        acknowledgeExternalFence: true,
      },
    ),
    /unavailable/,
  );
});
test("real PostgreSQL ownership contention, durable crash guard and admin fencing retain quarantine", async () => {
  const database = await isolatedDatabase();
  let owner: Awaited<ReturnType<typeof acquireConnectorOwnership>> | undefined;
  try {
    const contenders = await Promise.allSettled([
      acquireConnectorOwnership(database.pool, {
        ownerLabel: "synthetic-worker",
        onRevoked: () => {},
      }),
      acquireConnectorOwnership(database.pool, {
        ownerLabel: "second",
        onRevoked: () => {},
      }),
    ]);
    const winners = contenders.filter(
      (
        r,
      ): r is PromiseFulfilledResult<
        Awaited<ReturnType<typeof acquireConnectorOwnership>>
      > => r.status === "fulfilled",
    );
    assert.equal(winners.length, 1);
    owner = winners[0].value;
    await owner.markActive();
    const old = owner.token;
    await migrate(database.pool);
    await owner.assertCurrent();
    await owner.close();
    await assert.rejects(
      acquireConnectorOwnership(database.pool, {
        ownerLabel: "second",
        onRevoked: () => {},
      }),
    );
    const admin = (
      await database.pool.query(
        "INSERT INTO users(name,email,password_hash,role) VALUES('Admin','owner@example.test','unused','admin') RETURNING id",
      )
    ).rows[0];
    const agent = (
      await database.pool.query(
        "INSERT INTO users(name,email,password_hash,role) VALUES('Agent','agent@example.test','unused','agent') RETURNING id",
      )
    ).rows[0];
    const supervisor = (
      await database.pool.query(
        "INSERT INTO users(name,email,password_hash,role) VALUES('Supervisor','supervisor@example.test','unused','supervisor') RETURNING id",
      )
    ).rows[0];
    const inactive = (
      await database.pool.query(
        "INSERT INTO users(name,email,password_hash,role,active) VALUES('Inactive','inactive@example.test','unused','admin',false) RETURNING id",
      )
    ).rows[0];
    const db = await database.pool.connect();
    const ack = {
      expectedOwnerId: old.ownerId,
      expectedEpoch: old.epoch,
      evidenceRef: "synthetic-fence-1",
      acknowledgeExternalFence: true as const,
    };
    try {
      await assert.rejects(acknowledgeConnectorFence(db, admin, ack)); // explicit transaction mandatory
      for (const [actor, input] of [
        [agent, ack],
        [supervisor, ack],
        [inactive, ack],
        [admin, { ...ack, expectedEpoch: "999" }],
        [admin, { ...ack, acknowledgeExternalFence: false }],
      ] as any[]) {
        await db.query("BEGIN");
        await assert.rejects(acknowledgeConnectorFence(db, actor, input));
        await db.query("ROLLBACK");
      }
      await db.query("BEGIN");
      await acknowledgeConnectorFence(db, admin, ack);
      await db.query("COMMIT");
      await db.query("BEGIN");
      await assert.rejects(acknowledgeConnectorFence(db, admin, ack));
      await db.query("ROLLBACK");
      const state = (
        await db.query("SELECT * FROM provider_state WHERE account_id=$1", [
          ACCOUNT,
        ])
      ).rows[0];
      assert.equal(state.status, "disconnected");
      assert.equal(state.reconciliation_required, true);
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int n FROM audit WHERE action='connector.external_fence_ack'",
          )
        ).rows[0].n,
        1,
      );
    } finally {
      db.release();
    }
    owner = await acquireConnectorOwnership(database.pool, {
      ownerLabel: "second",
      onRevoked: () => {},
    });
    assert.equal(BigInt(owner.token.epoch), BigInt(old.epoch) + 1n);
    const heldDb = await database.pool.connect();
    try {
      await heldDb.query("BEGIN");
      await assert.rejects(
        acknowledgeConnectorFence(heldDb, admin, {
          expectedOwnerId: owner.token.ownerId,
          expectedEpoch: owner.token.epoch,
          evidenceRef: "synthetic-must-refuse-live-lock",
          acknowledgeExternalFence: true,
        }),
      );
      await heldDb.query("ROLLBACK");
    } finally {
      heldDb.release();
    }
    await owner.assertCurrent();
  } finally {
    await owner?.close();
    await database.close();
  }
});
