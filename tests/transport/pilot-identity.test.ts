import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createSdkFacade, createBoundSdkFacade } from "../../adapters/zalo/sdk-facade.js";

const UID = "synthetic-uid";
const credentials = () => ({
  imei: "synthetic-imei",
  userAgent: "synthetic-agent",
  cookie: [
    {
      key: "sid",
      value: "synthetic-secret",
      domain: "chat.zalo.me",
      path: "/",
    },
  ],
});
function fixture(
  config: {
    expectedAccountId?: unknown;
    uid?: () => unknown;
    omitUid?: boolean;
    loginTimeoutMs?: number;
  } = {},
) {
  let reads = 0,
    loads = 0,
    stops = 0,
    starts = 0,
    sends = 0,
    writes: unknown[] = [];
  let uid = config.uid ?? (() => UID);
  const listener = Object.assign(new EventEmitter(), {
    start: () => {
      starts++;
    },
    stop: () => {
      stops++;
    },
  });
  const api: Record<string, unknown> = {
    listener,
    getCookie: () => ({
      serializeSync: () => ({ cookies: credentials().cookie }),
    }),
    sendMessage: async () => {
      sends++;
      return { message: { msgId: 42 }, attachment: [] };
    },
  };
  if (!config.omitUid) api.getOwnId = () => uid();
  const facade = createSdkFacade({
    allowNetworkLogin: true,
    expectedAccountId: config.expectedAccountId as string | undefined,
    loginTimeoutMs: config.loginTimeoutMs,
    sessionStore: {
      read: async () => {
        reads++;
        return credentials();
      },
      write: async (value) => {
        writes.push(value);
      },
    },
    loader: async () => {
      loads++;
      return {
        Zalo: class {
          async login() {
            return api;
          }
        },
      };
    },
  });
  return {
    facade,
    api,
    listener,
    writes,
    setUid(next: () => unknown) {
      uid = next;
    },
    get reads() {
      return reads;
    },
    get loads() {
      return loads;
    },
    get stops() {
      return stops;
    },
    get starts() {
      return starts;
    },
    get sends() {
      return sends;
    },
  };
}
const safeError = (error: unknown) =>
  error instanceof Error &&
  error.message === "SDK facade unavailable" &&
  !("cause" in error);

test("matching exact UID binds before persistence and exposes no raw identity", async () => {
  const f = fixture({ expectedAccountId: UID });
  const api = await f.facade.createApi();
  assert.equal(f.reads, 1);
  assert.equal(f.loads, 1);
  assert.equal(f.writes.length, 1);
  assert.deepEqual(Object.keys(api).sort(), [
    "listener",
    "sendAttachment",
    "sendMessage",
  ]);
  assert.equal(JSON.stringify(api).includes(UID), false);
  assert.equal(JSON.stringify(f.writes).includes(UID), false);
  api.listener.start({ retryOnClose: false });
  assert.equal(f.starts, 1);
  assert.deepEqual(await api.sendMessage("hello", "peer"), {
    message: { msgId: 42 },
    attachment: [],
  });
  assert.equal(f.sends, 1);
  f.facade.close();
});

test("wrong, missing, coerced or thrown UID rejects before writes, start or send", async () => {
  const cases: Parameters<typeof fixture>[0][] = [
    { uid: () => "different-uid" },
    { uid: () => 123 },
    { uid: () => new String(UID) },
    { uid: () => "" },
    { uid: () => "x".repeat(201) },
    { uid: () => "bad uid" },
    { uid: () => "\0" },
    { omitUid: true },
    {
      uid: () => {
        throw Error("synthetic-secret");
      },
    },
  ];
  for (const config of cases) {
    const f = fixture({ ...config, expectedAccountId: UID });
    await assert.rejects(
      f.facade.createApi(),
      (error) =>
        safeError(error) &&
        !String(error).includes(UID) &&
        !String(error).includes("synthetic-secret"),
    );
    assert.equal(f.reads, 1);
    assert.equal(f.loads, 1);
    assert.equal(f.writes.length, 0);
    assert.equal(f.starts, 0);
    assert.equal(f.sends, 0);
    assert.equal(f.stops, 1);
  }
});

test("invalid expected account ID rejects before store access or SDK loading", async () => {
  for (const expected of [
    123,
    new String(UID),
    "",
    "bad uid",
    "a\nb",
    "\0",
    "x".repeat(201),
    {},
  ]) {
    let reads = 0,
      loads = 0;
    assert.throws(
      () =>
        createSdkFacade({
          allowNetworkLogin: true,
          expectedAccountId: expected as string,
          sessionStore: {
            read: async () => {
              reads++;
              return credentials();
            },
            write: async () => {},
          },
          loader: async () => {
            loads++;
            return { Zalo: class {} };
          },
        }),
      /SDK facade unavailable/,
    );
    assert.equal(reads, 0);
    assert.equal(loads, 0);
  }
});

test("changed UID blocks explicit session persistence and invalidates the API", async () => {
  const f = fixture({ expectedAccountId: UID });
  const api = await f.facade.createApi();
  assert.equal(f.writes.length, 1);
  f.setUid(() => "rotated-uid");
  await assert.rejects(f.facade.persistSession(), safeError);
  assert.equal(f.writes.length, 1);
  assert.throws(() => api.listener.start({ retryOnClose: false }), safeError);
  assert.equal(f.starts, 0);
  await assert.rejects(api.sendMessage("hello", "peer"), safeError);
  assert.equal(f.sends, 0);
  assert.equal(f.stops, 1);
});

test("changed UID blocks refreshed credential persistence on a fresh generation", async () => {
  const f = fixture({ expectedAccountId: UID });
  await f.facade.createApi();
  assert.equal(f.writes.length, 1);
  f.setUid(() => "different-uid");
  await assert.rejects(f.facade.createApi(), safeError);
  assert.equal(f.writes.length, 1);
  assert.equal(f.starts, 0);
  assert.equal(f.sends, 0);
  assert.ok(f.stops >= 1);
});

test("absent expected ID keeps backward-compatible offline fakes working", async () => {
  const f = fixture({ omitUid: true });
  const api = await f.facade.createApi();
  assert.equal(f.writes.length, 1);
  assert.deepEqual(Object.keys(api).sort(), [
    "listener",
    "sendAttachment",
    "sendMessage",
  ]);
  f.facade.close();
});

test("bound facade entrypoint refuses an absent or malformed binding before I/O", () => {
  for (const expectedAccountId of [
    undefined,
    "",
    "bad uid",
    "\0",
    123,
    new String(UID),
  ]) {
    let reads = 0,
      loads = 0;
    assert.throws(
      () =>
        createBoundSdkFacade({
          allowNetworkLogin: true,
          expectedAccountId: expectedAccountId as unknown as string,
          sessionStore: {
            read: async () => {
              reads++;
              return credentials();
            },
            write: async () => {},
          },
          loader: async () => {
            loads++;
            return { Zalo: class {} };
          },
        }),
      safeError,
    );
    assert.equal(reads, 0);
    assert.equal(loads, 0);
  }
});

test("late login after timeout is disposed before UID check, persistence or exposure", async () => {
  let resolve!: (value: unknown) => void;
  let reads = 0,
    writes = 0,
    stops = 0,
    uidChecks = 0;
  const listener = Object.assign(new EventEmitter(), {
    start: () => {},
    stop: () => {
      stops++;
    },
  });
  const api = {
    listener,
    getOwnId: () => {
      uidChecks++;
      return "wrong-uid";
    },
    getCookie: () => ({
      serializeSync: () => ({ cookies: credentials().cookie }),
    }),
    sendMessage: async () => ({ message: { msgId: 42 }, attachment: [] }),
  };
  const facade = createSdkFacade({
    allowNetworkLogin: true,
    expectedAccountId: UID,
    loginTimeoutMs: 5,
    sessionStore: {
      read: async () => {
        reads++;
        return credentials();
      },
      write: async () => {
        writes++;
      },
    },
    loader: async () => ({
      Zalo: class {
        login() {
          return new Promise((r) => {
            resolve = r;
          });
        }
      },
    }),
  });
  const pending = assert.rejects(facade.createApi(), safeError);
  await new Promise((r) => setImmediate(r));
  await pending;
  resolve(api);
  await new Promise((r) => setImmediate(r));
  assert.equal(reads, 1);
  assert.equal(writes, 0);
  assert.equal(stops, 1);
  assert.equal(uidChecks, 0);
});
