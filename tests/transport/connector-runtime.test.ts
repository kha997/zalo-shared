import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createOwnedConnector } from "../../adapters/zalo/connector-runtime.js";
import { ACCOUNT } from "../../server/db.js";
import type { OwnershipHandle } from "../../server/connector-ownership.js";
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
function fixture() {
  let live = true,
    revoked = () => {},
    calls = 0,
    closed = 0,
    ownershipClosed = 0;
  const listener = new (class extends EventEmitter {
    start() {
      this.emit("connected");
    }
    stop() {}
  })();
  const owner: OwnershipHandle = {
    token: {
      accountId: ACCOUNT,
      ownerId: "00000000-0000-4000-8000-000000000002",
      epoch: "1",
    },
    get admitted() {
      return live;
    },
    async assertCurrent() {
      if (!live) throw Error("secret");
    },
    async markActive() {
      if (!live) throw Error("secret");
    },
    async invalidate() {
      live = false;
      revoked();
      ownershipClosed++;
    },
    async close() {
      live = false;
      revoked();
      ownershipClosed++;
    },
  };
  const options = {
    pool: {} as any,
    ownerLabel: "offline-test",
    acquireOwnership: async (_pool: any, o: { onRevoked: () => void }) => {
      revoked = o.onRevoked;
      return owner;
    },
    createFacade: () => {
      calls++;
      return {
        async createApi() {
          return {
            listener,
            async sendMessage() {
              return { message: { msgId: "synthetic" } };
            },
          };
        },
        close() {
          closed++;
        },
        async persistSession() {},
      };
    },
  };
  return {
    options,
    owner,
    listener,
    get calls() {
      return calls;
    },
    get closed() {
      return closed;
    },
    get ownershipClosed() {
      return ownershipClosed;
    },
    revoke() {
      live = false;
      revoked();
    },
  };
}
test("owned runtime refuses factories after failed admission and sanitizes errors", async () => {
  const f = fixture();
  const runtime = createOwnedConnector({
    ...f.options,
    acquireOwnership: async () => {
      throw Error("secret-cookie");
    },
  });
  await assert.rejects(
    runtime.start(),
    (e) => e instanceof Error && e.message === "Connector runtime unavailable",
  );
  assert.equal(f.calls, 0);
  assert.equal(runtime.status, "blocked");
});
test("owned runtime reserves before factories, start is single-flight and revoke is terminal", async () => {
  const f = fixture(),
    gate = deferred<OwnershipHandle>();
  let acquired = 0;
  const runtime = createOwnedConnector({
    ...f.options,
    acquireOwnership: async (...args) => {
      acquired++;
      await gate.promise;
      return f.options.acquireOwnership(...args);
    },
  });
  const first = runtime.start(),
    second = runtime.start();
  assert.equal(f.calls, 0);
  gate.resolve(f.owner);
  await Promise.all([first, second]);
  assert.equal(acquired, 1);
  assert.equal(f.calls, 1);
  assert.equal(runtime.status, "active");
  f.revoke();
  assert.equal(runtime.status, "blocked");
  assert.equal(f.closed, 1);
  await assert.rejects(runtime.runOnce());
  await assert.rejects(runtime.persistSession());
  await assert.rejects(runtime.start());
  await runtime.stop();
});
test("stop during a pending facade factory disposes the late result without starting API", async () => {
  const f = fixture(),
    gate = deferred<any>();
  let apiCalls = 0;
  const runtime = createOwnedConnector({
    ...f.options,
    createFacade: () => gate.promise,
  });
  const start = runtime.start();
  await new Promise((r) => setImmediate(r));
  await runtime.stop();
  await assert.rejects(start);
  gate.resolve({
    async createApi() {
      apiCalls++;
    },
    close() {
      apiCalls += 100;
    },
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(apiCalls, 100);
  assert.equal(runtime.status, "stopped");
  await runtime.stop();
  assert.equal(apiCalls, 100);
});
test("revocation before reconnect prevents another API factory and session refresh", async () => {
  const f = fixture();
  let apiCalls = 0,
    refresh = 0;
  const runtime = createOwnedConnector({
    ...f.options,
    transportOptions: { reconnectDelayMs: 1 },
    createFacade: () => ({
      async createApi() {
        apiCalls++;
        return { listener: f.listener, async sendMessage() {} };
      },
      async persistSession() {
        refresh++;
      },
      close() {},
    }),
  });
  await runtime.start();
  f.revoke();
  f.listener.emit("closed");
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(apiCalls, 1);
  await assert.rejects(runtime.persistSession());
  assert.equal(refresh, 0);
  await runtime.stop();
});

test("actual owned provider treats an SDK call completing after revoke as uncertain", async () => {
  const { createSdkProvider } = await import("../../adapters/zalo/provider.js");
  const { createZaloTransport } =
    await import("../../adapters/zalo/transport.js");
  const { ProviderNotDispatchedError } = await import("../../server/worker.js");
  const f = fixture(),
    result = deferred<unknown>();
  let calls = 0;
  const transport = createZaloTransport({
    approvedSdk: {
      async createApi() {
        return {
          listener: f.listener,
          async sendMessage() {
            calls++;
            return result.promise;
          },
        };
      },
    },
  });
  await transport.start();
  const db = {
    async query(sql: string) {
      return {
        rows: sql.includes("provider_state")
          ? [{ status: "connected", reconciliation_required: false }]
          : sql.includes("delivery_parts")
            ? [{ part: 0, attachment_id: null }]
            : [
                {
                  text: "synthetic",
                  provider_thread_id: "peer",
                  provider_thread_type: 0,
                  attachments: 0,
                },
              ],
      };
    },
  } as any;
  const provider = createSdkProvider(null as any, transport, f.owner);
  await provider.prepareMessage!("synthetic", db);
  const sending = provider.sendPart("synthetic", 0, db);
  while (!calls) await new Promise((r) => setImmediate(r));
  f.revoke();
  transport.stop();
  result.resolve({ message: { msgId: "accepted-before-loss" } });
  await assert.rejects(
    sending,
    (e) =>
      e instanceof Error &&
      !(e instanceof ProviderNotDispatchedError) &&
      e.message === "Provider execution uncertain",
  );
  assert.equal(calls, 1);
  assert.equal(await provider.connected(db), false);
  await assert.rejects(
    provider.sendPart("synthetic", 0, db),
    ProviderNotDispatchedError,
  );
  assert.equal(calls, 1);
});
test("runtime factory rejection and cleanup errors retain terminal state without exposing raw errors", async () => {
  const f = fixture();
  const runtime = createOwnedConnector({
    ...f.options,
    createFacade: () => {
      throw Error("private-session");
    },
  });
  await assert.rejects(
    runtime.start(),
    (e) => e instanceof Error && e.message === "Connector runtime unavailable",
  );
  assert.equal(runtime.status, "blocked");
  assert.ok(f.ownershipClosed);
  await assert.rejects(runtime.start());
  await runtime.stop();
});

test("fault observation blocks dispatch locally before pool acquisition and locks owner before durable gap write", async () => {
  const f = fixture(),
    gate = deferred<any>();
  let fault!: (reason: any) => void | Promise<void>,
    dispatchOwner!: OwnershipHandle;
  const sql: string[] = [];
  const { createZaloTransport } =
    await import("../../adapters/zalo/transport.js");
  const runtime = createOwnedConnector({
    ...f.options,
    pool: { connect: () => gate.promise } as any,
    createTransport(o) {
      fault = o.onFault!;
      return createZaloTransport(o);
    },
    createProvider(_pool, _transport, owner) {
      dispatchOwner = owner;
      return {
        async connected() {
          return false;
        },
        async sendPart() {
          throw Error("unused");
        },
      };
    },
  });
  await runtime.start();
  assert.equal(dispatchOwner.admitted, true);
  const observed = fault("connection-lost");
  assert.equal(dispatchOwner.admitted, false);
  await assert.rejects(dispatchOwner.assertCurrent());
  gate.resolve({
    async query(text: string) {
      sql.push(text);
      return {
        rowCount: 1,
        rows: [
          text.includes("current_setting")
            ? { marker: "active" }
            : text.includes("UPDATE provider_state")
              ? { gap_version: "1" }
              : {},
        ],
      };
    },
    release() {},
  });
  await observed;
  assert.equal(sql[0], "BEGIN");
  assert.match(sql[1], /statement_timeout/);
  assert.match(sql[2], /connector_ownership.*FOR SHARE/);
  const faultWrite = sql.findIndex((s) => s.includes("UPDATE provider_state"));
  assert.ok(faultWrite > 2);
  assert.match(sql[faultWrite], /gap_version/);
  assert.match(sql[faultWrite + 1], /INSERT INTO audit/);
  assert.equal(sql.at(-1), "COMMIT");
  assert.equal(dispatchOwner.admitted, false);
  await runtime.stop();
});
test("late transport factory never starts SDK after stop, and close errors are sanitized", async () => {
  const f = fixture(),
    gate = deferred<void>();
  let apiCalls = 0;
  const { createZaloTransport } =
    await import("../../adapters/zalo/transport.js");
  const runtime = createOwnedConnector({
    ...f.options,
    createFacade: () => ({
      async createApi() {
        apiCalls++;
        return { listener: f.listener, async sendMessage() {} };
      },
      close() {
        throw Error("secret-close");
      },
    }),
    async createTransport(o) {
      const t = createZaloTransport(o);
      await gate.promise;
      return t;
    },
  });
  const starting = runtime.start();
  await new Promise((r) => setImmediate(r));
  await runtime.stop();
  await assert.rejects(starting);
  gate.resolve();
  await new Promise((r) => setImmediate(r));
  assert.equal(apiCalls, 0);
  assert.equal(runtime.status, "stopped");
  await runtime.stop();
});
test("late API discarded during stop retains an error sink after listener cleanup", async () => {
  const f = fixture(),
    gate = deferred<any>();
  const runtime = createOwnedConnector({
    ...f.options,
    createFacade: () => ({ createApi: () => gate.promise, close() {} }),
  });
  const starting = runtime.start();
  await new Promise((r) => setImmediate(r));
  await runtime.stop();
  await assert.rejects(starting);
  gate.resolve({ listener: f.listener, async sendMessage() {} });
  await new Promise((r) => setImmediate(r));
  assert.doesNotThrow(() =>
    f.listener.emit("error", Error("private late sdk error")),
  );
});
