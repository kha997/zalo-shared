import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type pg from "pg";
import { isolatedDatabase } from "./isolation.js";
import { ACCOUNT, migrate } from "../../server/db.js";
import {
  acquireConnectorOwnership,
  acknowledgeConnectorFence,
  type OwnerToken,
} from "../../server/connector-ownership.js";
import { createOwnedConnector } from "../../adapters/zalo/connector-runtime.js";
import { ingestProviderEvent } from "../../server/provider-store.js";
const frame = (providerId: string, threadId = "peer") => ({
  threadType: 0 as const,
  threadId,
  providerId,
  senderId: "synthetic-peer",
  isSelf: false,
  kind: "text" as const,
  text: "synthetic inbound",
});

test("owned ingestion rejects stale epochs and persists valid events under the owner row lock", async () => {
  const database = await isolatedDatabase();
  const { pool } = database;
  let owner: Awaited<ReturnType<typeof acquireConnectorOwnership>> | undefined;
  try {
    owner = await acquireConnectorOwnership(pool, {
      ownerLabel: "ci-owned-ingress",
      onRevoked() {},
    });
    await owner.markActive();
    const first = await ingestProviderEvent(pool, frame("valid"), {
      owner: owner.token,
    });
    assert.equal(first.duplicate, false);
    await assert.rejects(
      ingestProviderEvent(pool, frame("stale"), {
        owner: {
          ...owner.token,
          epoch: String(BigInt(owner.token.epoch) + 1n),
        },
      }),
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int n FROM provider_events WHERE provider_id='stale'",
        )
      ).rows[0].n,
      0,
    );
    await owner.close();
    await assert.rejects(
      ingestProviderEvent(pool, frame("after-close"), { owner: owner.token }),
    );
    await migrate(pool);
    assert.equal(
      (await pool.query("SELECT phase FROM connector_ownership")).rows[0].phase,
      "uncertain",
    );
  } finally {
    await owner?.close();
    await database.close();
  }
});

test("one owned runtime dispatches four staff intents and DB-loss blocks replacement and quarantines acceptance", async () => {
  const database = await isolatedDatabase();
  const { pool } = database;
  let runtime: ReturnType<typeof createOwnedConnector> | undefined,
    replacement: ReturnType<typeof createOwnedConnector> | undefined,
    next: ReturnType<typeof createOwnedConnector> | undefined;
  let backendPid: number | undefined,
    token: OwnerToken | undefined,
    calls = 0,
    factories = 0;
  let revokedResolve!: () => void;
  const revoked = new Promise<void>((r) => (revokedResolve = r));
  class Listener extends EventEmitter {
    start() {
      this.emit("connected");
    }
    stop() {}
  }
  try {
    const actor = (
      await pool.query(
        "INSERT INTO users(name,email,password_hash,role) VALUES('Admin','owned-admin@example.test','unused','admin') RETURNING id",
      )
    ).rows[0].id;
    const lifetimePool = {
      async connect() {
        const client = await pool.connect();
        backendPid = (await client.query("SELECT pg_backend_pid() pid")).rows[0]
          .pid;
        return client;
      },
    } as pg.Pool;
    const options = {
      pool,
      ownerLabel: "ci-owned-worker",
      async acquireOwnership(
        _pool: pg.Pool,
        o: Parameters<typeof acquireConnectorOwnership>[1],
      ) {
        let wasAdmitted = false;
        const handle = await acquireConnectorOwnership(lifetimePool, {
          ...o,
          onRevoked() {
            o.onRevoked();
            if (wasAdmitted) revokedResolve();
          },
        });
        wasAdmitted = true;
        token = handle.token;
        return handle;
      },
      createFacade() {
        factories++;
        return {
          async createApi() {
            return {
              listener: new Listener(),
              async sendMessage() {
                calls++;
                return { message: { msgId: "owned-" + calls } };
              },
            };
          },
          close() {},
        };
      },
    };
    runtime = createOwnedConnector(options);
    await runtime.start();
    const activeBackendPid = backendPid;
    replacement = createOwnedConnector({
      ...options,
      ownerLabel: "ci-replacement",
    });
    await assert.rejects(replacement.start());
    assert.equal(factories, 1);
    await pool.query(
      "UPDATE provider_state SET status='connected',reconciliation_required=false",
    );
    for (let i = 0; i < 4; i++) {
      const staff = (
        await pool.query(
          "INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,'unused','agent') RETURNING id",
          ["Staff " + i, `owned-${i}@example.test`],
        )
      ).rows[0].id;
      await ingestProviderEvent(pool, frame("in-" + i, "peer-" + i), {
        owner: token!,
      });
      const cid = (
        await pool.query(
          "SELECT id FROM conversations WHERE provider_thread_id=$1",
          ["peer-" + i],
        )
      ).rows[0].id;
      const mid = (
        await pool.query(
          "INSERT INTO messages(conversation_id,direction,text,status,actor_id) VALUES($1,'outbound','synthetic staff intent','pending',$2) RETURNING id",
          [cid, staff],
        )
      ).rows[0].id;
      await pool.query("INSERT INTO outbox(message_id) VALUES($1)", [mid]);
      await pool.query(
        "INSERT INTO delivery_parts(message_id,part) VALUES($1,0)",
        [mid],
      );
      await runtime.runOnce();
    }
    assert.equal(calls, 4);
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int n FROM messages WHERE direction='outbound' AND status='sent' AND actor_id IS NOT NULL",
        )
      ).rows[0].n,
      4,
    );
    const oldToken = { ...token! };
    await pool.query("SELECT pg_terminate_backend($1)", [activeBackendPid]);
    await revoked;
    assert.equal(runtime.status, "blocked");
    await assert.rejects(runtime.runOnce());
    next = createOwnedConnector(options);
    await assert.rejects(next.start());
    assert.equal(factories, 1);
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      await acknowledgeConnectorFence(
        db,
        { id: actor },
        {
          expectedOwnerId: oldToken.ownerId,
          expectedEpoch: oldToken.epoch,
          evidenceRef: "ci-synthetic-external-fence",
          acknowledgeExternalFence: true,
        },
      );
      await db.query("COMMIT");
    } finally {
      db.release();
    }
    await assert.rejects(
      ingestProviderEvent(pool, frame("stale-callback"), { owner: oldToken }),
    );
    next = createOwnedConnector(options);
    await next.start();
    assert.equal(BigInt(token!.epoch), BigInt(oldToken.epoch) + 1n);
    assert.equal(factories, 2);
    assert.equal(
      (await pool.query("SELECT reconciliation_required FROM provider_state"))
        .rows[0].reconciliation_required,
      true,
    );
    assert.deepEqual(await next.runOnce(), { processed: false });
    assert.equal(calls, 4);
  } finally {
    await next?.stop();
    await replacement?.stop();
    await runtime?.stop();
    await database.close();
  }
});

test("SDK acceptance after lifetime DB loss is unknown and is never resent", async () => {
  const database = await isolatedDatabase();
  const { pool } = database;
  let runtime: ReturnType<typeof createOwnedConnector> | undefined;
  let backendPid: number,
    token: OwnerToken | undefined,
    calls = 0;
  let revokeResolve!: () => void;
  const revoked = new Promise<void>((r) => (revokeResolve = r));
  class Listener extends EventEmitter {
    start() {
      this.emit("connected");
    }
    stop() {}
  }
  try {
    const lifetimePool = {
      async connect() {
        const client = await pool.connect();
        backendPid = (await client.query("SELECT pg_backend_pid() pid")).rows[0]
          .pid;
        return client;
      },
    } as pg.Pool;
    runtime = createOwnedConnector({
      pool,
      ownerLabel: "ci-acceptance-loss",
      async acquireOwnership(_p, o) {
        const owner = await acquireConnectorOwnership(lifetimePool, {
          ...o,
          onRevoked() {
            o.onRevoked();
            revokeResolve();
          },
        });
        token = owner.token;
        return owner;
      },
      createFacade() {
        return {
          async createApi() {
            return {
              listener: new Listener(),
              async sendMessage() {
                calls++;
                await pool.query("SELECT pg_terminate_backend($1)", [
                  backendPid,
                ]);
                await revoked;
                return { message: { msgId: "accepted-but-owner-lost" } };
              },
            };
          },
          close() {},
        };
      },
    });
    await runtime.start();
    await pool.query(
      "UPDATE provider_state SET status='connected',reconciliation_required=false",
    );
    await ingestProviderEvent(pool, frame("initial"), { owner: token! });
    const cid = (await pool.query("SELECT id FROM conversations")).rows[0].id;
    const mid = (
      await pool.query(
        "INSERT INTO messages(conversation_id,direction,text,status) VALUES($1,'outbound','synthetic unknown','pending') RETURNING id",
        [cid],
      )
    ).rows[0].id;
    await pool.query("INSERT INTO outbox(message_id) VALUES($1)", [mid]);
    await pool.query(
      "INSERT INTO delivery_parts(message_id,part) VALUES($1,0)",
      [mid],
    );
    await runtime.runOnce();
    assert.equal(calls, 1);
    assert.equal(
      (await pool.query("SELECT status FROM outbox WHERE message_id=$1", [mid]))
        .rows[0].status,
      "unknown",
    );
    await assert.rejects(runtime.runOnce());
    assert.equal(calls, 1);
  } finally {
    await runtime?.stop();
    await database.close();
  }
});

test("a retained old fault callback cannot disconnect or audit against a newer owner epoch", async () => {
  const { createZaloTransport } =
    await import("../../adapters/zalo/transport.js");
  const database = await isolatedDatabase();
  const { pool } = database;
  let runtime: ReturnType<typeof createOwnedConnector> | undefined,
    next: ReturnType<typeof createOwnedConnector> | undefined;
  let token: OwnerToken | undefined,
    fault: ((reason: "connection-lost") => void | Promise<void>) | undefined;
  class Listener extends EventEmitter {
    start() {
      this.emit("connected");
    }
    stop() {}
  }
  const options = {
    pool,
    ownerLabel: "ci-fault-epoch",
    async acquireOwnership(
      p: pg.Pool,
      o: Parameters<typeof acquireConnectorOwnership>[1],
    ) {
      const owner = await acquireConnectorOwnership(p, o);
      token = owner.token;
      return owner;
    },
    createFacade() {
      return {
        async createApi() {
          return {
            listener: new Listener(),
            async sendMessage() {
              return { message: { msgId: "unused" } };
            },
          };
        },
        close() {},
      };
    },
    createTransport(o: Parameters<typeof createZaloTransport>[0]) {
      fault = o.onFault;
      return createZaloTransport(o);
    },
  };
  try {
    const actor = (
      await pool.query(
        "INSERT INTO users(name,email,password_hash,role) VALUES('Admin','fault-admin@example.test','unused','admin') RETURNING id",
      )
    ).rows[0].id;
    runtime = createOwnedConnector(options);
    await runtime.start();
    const prior = { ...token! },
      oldFault = fault!;
    await runtime.stop();
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      await acknowledgeConnectorFence(
        db,
        { id: actor },
        {
          expectedOwnerId: prior.ownerId,
          expectedEpoch: prior.epoch,
          evidenceRef: "ci-confirmed-fence",
          acknowledgeExternalFence: true,
        },
      );
      await db.query("COMMIT");
    } finally {
      db.release();
    }
    next = createOwnedConnector(options);
    await next.start();
    await pool.query(
      "UPDATE provider_state SET status='connected',reconciliation_required=false,fault_code=NULL",
    );
    const count = (
      await pool.query(
        "SELECT count(*)::int n FROM audit WHERE action='connector.gap'",
      )
    ).rows[0].n;
    await oldFault("connection-lost");
    assert.deepEqual(
      (
        await pool.query(
          "SELECT status,reconciliation_required,fault_code FROM provider_state",
        )
      ).rows[0],
      { status: "connected", reconciliation_required: false, fault_code: null },
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int n FROM audit WHERE action='connector.gap'",
        )
      ).rows[0].n,
      count,
    );
  } finally {
    await next?.stop();
    await runtime?.stop();
    await database.close();
  }
});
