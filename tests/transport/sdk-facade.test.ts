import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createSdkFacade } from "../../adapters/zalo/sdk-facade.js";
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
function fixture(extra: Record<string, unknown> = {}) {
  let reads = 0,
    loads = 0,
    stops = 0,
    writes: unknown[] = [];
  const listener = Object.assign(new EventEmitter(), {
    start: () => {},
    stop: () => {
      stops++;
    },
  });
  const api = {
    listener,
    getCookie: () => ({
      serializeSync: () => ({ cookies: credentials().cookie }),
    }),
    sendMessage: async () => ({
      message: { msgId: 42 },
      secret: "synthetic-secret",
    }),
  };
  const inputs: unknown[] = [];
  const facade = createSdkFacade({
    allowNetworkLogin: true,
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
          constructor(options: unknown) {
            inputs.push(options);
          }
          async login(value: unknown) {
            inputs.push(value);
            return api;
          }
        },
      };
    },
    ...extra,
  });
  return {
    facade,
    api,
    listener,
    inputs,
    writes,
    get reads() {
      return reads;
    },
    get loads() {
      return loads;
    },
    get stops() {
      return stops;
    },
  };
}
test("default deny precedes all reads and SDK loading", async () => {
  const f = fixture({ allowNetworkLogin: false });
  await assert.rejects(f.facade.createApi(), /SDK facade unavailable/);
  assert.equal(f.reads, 0);
  assert.equal(f.loads, 0);
});
test("safe flags, restricted API and fresh generations persist before exposure", async () => {
  const f = fixture();
  const api = await f.facade.createApi();
  assert.deepEqual(f.inputs[0], {
    logging: false,
    selfListen: true,
    checkUpdate: false,
  });
  assert.equal(f.writes.length, 1);
  assert.deepEqual(Object.keys(api).sort(), ["listener", "sendMessage"]);
  assert.deepEqual(await api.sendMessage("hello", "peer"), {
    message: { msgId: 42 },
    attachment: [],
  });
  await f.facade.persistSession();
  assert.equal(f.writes.length, 2);
  await f.facade.createApi();
  assert.equal(f.loads, 2);
  assert.ok(f.stops >= 1);
  f.facade.close();
  await assert.rejects(api.sendMessage("hello", "peer"));
});
test("invalid, oversized and excessive cookies reject before loading", async () => {
  for (const value of [
    {},
    { ...credentials(), imei: "" },
    { ...credentials(), cookie: [] },
    { ...credentials(), cookie: Array(257).fill(credentials().cookie[0]) },
    { ...credentials(), userAgent: "x".repeat(65536) },
  ]) {
    const f = fixture({
      sessionStore: { read: async () => value, write: async () => {} },
    });
    await assert.rejects(f.facade.createApi(), /SDK facade unavailable/);
    assert.equal(f.loads, 0);
  }
});
test("sync and async SDK failures never expose secret or cause", async () => {
  for (const loader of [
    () => {
      throw Error("synthetic-secret");
    },
    async () => ({
      Zalo: class {
        login() {
          return Promise.reject(Error("synthetic-secret"));
        }
      },
    }),
  ]) {
    const f = fixture({ loader });
    await assert.rejects(
      f.facade.createApi(),
      (e) =>
        e instanceof Error &&
        e.message === "SDK facade unavailable" &&
        !("cause" in e),
    );
  }
});
test("persistence failure stops API and fails closed", async () => {
  const f = fixture({
    sessionStore: {
      read: async () => credentials(),
      write: async () => {
        throw Error("synthetic-secret");
      },
    },
  });
  await assert.rejects(f.facade.createApi(), /SDK facade unavailable/);
  assert.equal(f.stops, 1);
});
test("timeout and close dispose late login; concurrent create rejected", async () => {
  for (const close of [false, true]) {
    let resolve!: (v: unknown) => void;
    const f = fixture({
      loginTimeoutMs: 5,
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
    const pending = assert.rejects(f.facade.createApi());
    await new Promise((r) => setImmediate(r));
    await assert.rejects(f.facade.createApi());
    if (close) f.facade.close();
    await pending;
    resolve(f.api);
    await new Promise((r) => setImmediate(r));
    assert.equal(f.stops, 1);
    assert.equal(f.writes.length, 0);
  }
});

test("real encrypted vault, actual tough-cookie snapshot and mutation isolation (fake login)", async () => {
  const { CredentialVault } = await import("../../adapters/zalo/vault.js");
  const { CookieJar } = await import("tough-cookie");
  const { mkdtemp, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { randomBytes } = await import("node:crypto");
  const dir = await mkdtemp(join(tmpdir(), "facade-vault-"));
  try {
    const path = join(dir, "session");
    const vault = new CredentialVault(path, randomBytes(32));
    await vault.write(credentials());
    const original = await vault.read();
    const jar = new CookieJar();
    jar.setCookieSync(
      "sid=synthetic-refreshed; Domain=chat.zalo.me; Path=/",
      "https://chat.zalo.me",
    );
    const f = fixture({
      sessionStore: vault,
      loader: async () => ({
        Zalo: class {
          async login(input: any) {
            input.imei = "mutated";
            input.cookie[0].value = "mutated";
            return { ...f.api, getCookie: () => jar };
          }
        },
      }),
    });
    const api = await f.facade.createApi();
    assert.deepEqual(original, credentials());
    const saved = (await vault.read()) as ReturnType<typeof credentials>;
    assert.equal(saved.imei, "synthetic-imei");
    assert.equal(saved.cookie[0].value, "synthetic-refreshed");
    assert.equal((await readFile(path, "utf8")).includes("synthetic-"), false);
    assert.equal(JSON.stringify(api).includes("synthetic-"), false);
    jar.setCookieSync(
      "sid=synthetic-new; Domain=chat.zalo.me; Path=/",
      "https://chat.zalo.me",
    );
    await f.facade.persistSession();
    assert.equal(
      ((await vault.read()) as typeof saved).cookie[0].value,
      "synthetic-new",
    );
    f.facade.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("current jar validation fails closed; send and listener errors are sanitized", async () => {
  const f = fixture();
  const api = await f.facade.createApi();
  f.api.sendMessage = async () => {
    throw Error("synthetic-secret");
  };
  await assert.rejects(api.sendMessage("hi", "peer"), /SDK facade unavailable/);
  let message = "";
  api.listener.on("error", (error) => {
    message = String(error);
  });
  f.listener.emit("error", Error("synthetic-secret"));
  assert.equal(message, "Error: SDK facade unavailable");
  f.api.getCookie = () => ({ serializeSync: () => ({ cookies: [] }) });
  await assert.rejects(f.facade.persistSession());
  assert.ok(f.stops > 0);
  assert.equal(f.writes.length, 1);
});
test("timeout option bounds and synchronous store errors are sanitized", async () => {
  for (const loginTimeoutMs of [0, 60001, NaN])
    assert.throws(() => fixture({ loginTimeoutMs }), /SDK facade unavailable/);
  const f = fixture({
    sessionStore: {
      read() {
        throw Error("synthetic-secret");
      },
      async write() {},
    },
  });
  await assert.rejects(f.facade.createApi(), /SDK facade unavailable/);
  assert.equal(f.loads, 0);
});

test("timed-out persistence drains before newer generation can commit", async () => {
  let unblock!: () => void;
  const barrier = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  let entered!: () => void;
  const enteredWrite = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const commits: string[] = [];
  let writeCalls = 0,
    instance = 0;
  const f = fixture({
    loginTimeoutMs: 50,
    sessionStore: {
      read: async () => credentials(),
      write: async (session: ReturnType<typeof credentials>) => {
        const call = ++writeCalls;
        if (call === 1) {
          entered();
          await barrier;
        }
        commits.push(session.cookie[0].value);
      },
    },
    loader: async () => ({
      Zalo: class {
        async login() {
          const value = `generation-${++instance}`;
          return {
            ...f.api,
            getCookie: () => ({
              serializeSync: () => ({
                cookies: [{ ...credentials().cookie[0], value }],
              }),
            }),
          };
        }
      },
    }),
  });
  const first = assert.rejects(f.facade.createApi());
  await enteredWrite;
  await first;
  const second = f.facade.createApi();
  const settledSecond = second.then(
    (api) => ({ api }),
    (error) => ({ error }),
  );
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      writeCalls,
      1,
      "new writes must queue behind in-flight old write",
    );
  } finally {
    unblock();
  }
  const result = await settledSecond;
  assert.ok("api" in result);
  assert.deepEqual(commits, ["generation-1", "generation-2"]);
  f.facade.close();
});

test("text boundary rejects arbitrary message payloads and invalid peers/types before SDK invocation", async () => {
  const f = fixture();
  let calls = 0;
  f.api.sendMessage = async () => {
    calls++;
    return { message: { msgId: 42 }, secret: "" };
  };
  const api = await f.facade.createApi();
  const invalid: unknown[][] = [
    [{ msg: "", attachments: ["/private/example.txt"] }, "peer", 0],
    [{ msg: "", attachments: [Buffer.from("synthetic")] }, "peer", 0],
    [[], "peer", 0],
    [new String("hi"), "peer", 0],
    ["", "peer", 0],
    [" ".repeat(2), "peer", 0],
    ["x".repeat(10001), "peer", 0],
    ["hi", {}, 0],
    ["hi", "", 0],
    ["hi", " ".repeat(2), 0],
    ["hi", "x".repeat(201), 0],
    ["hi", "peer", 2],
    ["hi", "peer", "0"],
  ];
  for (const args of invalid)
    await assert.rejects(
      (api.sendMessage as Function)(...args),
      (error) =>
        error instanceof Error &&
        error.message === "SDK facade unavailable" &&
        !("cause" in error),
    );
  assert.equal(calls, 0);
  await api.sendMessage("x".repeat(10000), "p".repeat(200), 1);
  assert.equal(calls, 1);
  f.facade.close();
});

test("timed-out queued generation never writes when older write drains", async () => {
  let unblock!: () => void, entered!: () => void;
  const barrier = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  const firstEntered = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let writes = 0;
  const f = fixture({
    loginTimeoutMs: 20,
    sessionStore: {
      read: async () => credentials(),
      write: async () => {
        if (++writes === 1) {
          entered();
          await barrier;
        }
      },
    },
  });
  const first = assert.rejects(f.facade.createApi());
  await firstEntered;
  await first;
  await assert.rejects(f.facade.createApi());
  assert.equal(writes, 1);
  unblock();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes, 1);
  await f.facade.createApi();
  assert.equal(writes, 2);
  f.facade.close();
});

test("explicit refresh excludes recreate and overlapping refresh until its write settles", async () => {
  let unblock!: () => void, entered!: () => void;
  const barrier = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  const refreshEntered = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let writes = 0;
  const f = fixture({
    sessionStore: {
      read: async () => credentials(),
      write: async () => {
        if (++writes === 2) {
          entered();
          await barrier;
        }
      },
    },
  });
  await f.facade.createApi();
  const refresh = f.facade.persistSession();
  await refreshEntered;
  await assert.rejects(f.facade.createApi());
  await assert.rejects(f.facade.persistSession());
  assert.equal(writes, 2);
  unblock();
  await refresh;
  await f.facade.createApi();
  assert.equal(writes, 3);
  f.facade.close();
});
