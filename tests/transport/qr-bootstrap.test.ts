import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { bootstrapPilotSession } from "../../adapters/zalo/qr-bootstrap.js";
import type { OwnershipHandle } from "../../server/connector-ownership.js";
import {
  ensurePrivateDirectory,
  PrivateQrFileView,
  PrivateSessionFile,
  readPrivateKeyFile,
  readPrivateTextFile,
  type PrivateQrView,
  type PrivateSessionStore,
} from "../../server/private-pilot-files.js";
import type { PilotGrant } from "../../server/pilot-policy.js";

const POSIX = process.platform !== "win32";
const sentinelUid = "zalo-uid-sentinel-1";
const sentinelCookie = "cookie-sentinel-value";
const eventCookie = "event-cookie-must-not-persist";

function pngBytes() {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(1, 16);
  bytes.writeUInt32BE(1, 20);
  return bytes;
}
const pngBase64 = pngBytes().toString("base64");

function grant(overrides: Partial<PilotGrant> = {}): PilotGrant {
  const now = Date.now();
  return {
    version: 1,
    grantId: "grant-synthetic-1",
    purpose: "enroll-session",
    sourceCommit: "a".repeat(40),
    lockSha256: "b".repeat(64),
    sdkIntegrity: "sha512-" + "c".repeat(64),
    issuedAt: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 60 * 60 * 1000).toISOString(),
    ownerConsentRef: "owner-consent-synthetic",
    dedicatedAccountAttested: true,
    unofficialClientRiskAccepted: true,
    expectedAccountId: sentinelUid,
    allowedPeerIds: [],
    maxPartsPerDay: 1,
    minIntervalMs: 2000,
    ...overrides,
  } as PilotGrant;
}

function fakeOwner() {
  let checks = 0;
  let fail = false;
  const handle: OwnershipHandle = {
    token: Object.freeze({
      accountId: "00000000-0000-4000-8000-000000000001",
      ownerId: "00000000-0000-4000-8000-000000000002",
      epoch: "1",
    }),
    get admitted() {
      return true;
    },
    async assertCurrent() {
      checks++;
      if (fail) throw new Error("ownership lost");
    },
    async markActive() {},
    async invalidate() {},
    async close() {},
  };
  return {
    handle,
    checks: () => checks,
    fail: () => {
      fail = true;
    },
  };
}

function fakeView(
  options: {
    show?: (bytes: Uint8Array) => Promise<void>;
    clear?: () => Promise<void>;
    confirm?: (value: { uid: string; displayLabel: string | null }) => Promise<boolean> | boolean;
  } = {},
) {
  const shown: Uint8Array[] = [];
  const values: { uid: string; displayLabel: string | null }[] = [];
  let clears = 0;
  const view: PrivateQrView = {
    async showPng(bytes) {
      shown.push(new Uint8Array(bytes));
      if (options.show) await options.show(bytes);
    },
    async clear() {
      clears++;
      if (options.clear) await options.clear();
    },
    async confirmIdentity(value) {
      values.push(value);
      return (options.confirm ? await options.confirm(value) : true) === true;
    },
  };
  return {
    view,
    shown,
    values,
    clears: () => clears,
  };
}

function fakeStore(
  options: {
    write?: (value: unknown) => Promise<void>;
  } = {},
) {
  const writes: unknown[] = [];
  let reads = 0;
  let quarantines = 0;
  const store: PrivateSessionStore = {
    async read() {
      reads++;
      return null;
    },
    async write(value) {
      writes.push(value);
      if (options.write) await options.write(value);
    },
    async quarantine() {
      quarantines++;
    },
  };
  return {
    store,
    writes,
    reads: () => reads,
    quarantines: () => quarantines,
  };
}

type Counters = {
  save: number;
  retry: number;
  abort: number;
  starts: number;
  sends: number;
  stops: number;
  cookies: number;
  loads: number;
  constructorOptions?: unknown;
  loginOptions?: unknown;
};

function counters(): Counters {
  return { save: 0, retry: 0, abort: 0, starts: 0, sends: 0, stops: 0, cookies: 0, loads: 0 };
}

function actions(state: Counters) {
  return {
    saveToFile: async () => {
      state.save++;
    },
    retry: () => {
      state.retry++;
      return new Promise(() => {});
    },
    abort: () => {
      state.abort++;
    },
  };
}

function qrEvent(state: Counters, image = pngBase64, extra?: Record<string, unknown>) {
  return {
    type: 0,
    data: { code: "synthetic-code", image, token: "synthetic-token", ...extra },
    actions: actions(state),
  };
}
const expiredEvent = (state: Counters) => ({
  type: 1,
  data: null,
  actions: actions(state),
});
const scannedEvent = (label = "Synthetic Display", state = counters()) => ({
  type: 2,
  data: { avatar: "https://example.invalid/avatar.png", display_name: label },
  actions: actions(state),
});
const declinedEvent = (state: Counters) => ({
  type: 3,
  data: { code: "synthetic-code" },
  actions: actions(state),
});
const infoEvent = (imei = "synthetic-imei", userAgent = "synthetic-user-agent") => ({
  type: 4,
  data: {
    cookie: [
      {
        key: "synthetic",
        value: eventCookie,
        domain: "example.invalid",
        path: "/",
      },
    ],
    imei,
    userAgent,
  },
  actions: null,
});

function fakeApi(
  state: Counters,
  options: {
    uid?: unknown;
    cookie?: unknown;
    serialized?: unknown;
    getOwnId?: () => unknown;
  } = {},
) {
  const listener = {
    on() {},
    off() {},
    start() {
      state.starts++;
    },
    stop() {
      state.stops++;
    },
  };
  return {
    listener,
    getOwnId: options.getOwnId ?? (() => options.uid ?? sentinelUid),
    getCookie() {
      state.cookies++;
      const jar = {
        serializeSync: () =>
          options.serialized ?? {
            cookies:
              options.cookie ?? [
                {
                  key: "synthetic",
                  value: sentinelCookie,
                  domain: "example.invalid",
                  path: "/",
                },
              ],
          },
      };
      return jar;
    },
    sendMessage() {
      state.sends++;
      return null;
    },
  };
}

function fakeLoader(
  script: (callback: (event: unknown) => void) => unknown,
  state: Counters,
) {
  return async () => {
    state.loads++;
    return {
      Zalo: class {
        constructor(options: unknown) {
          state.constructorOptions = options;
        }
        async loginQR(options: unknown, callback: (event: unknown) => void) {
          state.loginOptions = options;
          return script(callback);
        }
      },
    };
  };
}

async function withTimeout<T>(promise: Promise<T>, ms = 1000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("test timeout")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

test("successful bootstrap shows a bounded QR, confirms the UID and writes only the bound session", async () => {
  const state = counters();
  const owner = fakeOwner();
  const view = fakeView();
  const store = fakeStore();
  const loader = fakeLoader(async (callback) => {
    callback(qrEvent(state));
    callback(scannedEvent("Synthetic Label", state));
    callback(infoEvent());
    return fakeApi(state);
  }, state);

  const result = await bootstrapPilotSession({
    grant: grant(),
    owner: owner.handle,
    view: view.view,
    sessionStore: store.store,
    loader,
    signal: new AbortController().signal,
  });

  assert.deepEqual(result, { boundAccountId: sentinelUid });
  assert.equal(owner.checks() >= 2, true);
  assert.equal(view.shown.length, 1);
  assert.deepEqual(Buffer.from(view.shown[0]), pngBytes());
  assert.deepEqual(view.values, [
    { uid: sentinelUid, displayLabel: "Synthetic Label" },
  ]);
  assert.equal(view.clears() >= 1, true);
  assert.equal(store.reads(), 0);
  assert.equal(store.writes.length, 1);
  const record = store.writes[0] as any;
  assert.equal(record.version, 1);
  assert.equal(record.accountId, sentinelUid);
  assert.equal(record.session.imei, "synthetic-imei");
  assert.equal(record.session.userAgent, "synthetic-user-agent");
  assert.equal(record.session.cookie[0].value, sentinelCookie);
  assert.equal(JSON.stringify(record).includes(eventCookie), false);
  assert.deepEqual(state.constructorOptions, {
    logging: false,
    selfListen: true,
    checkUpdate: false,
  });
  assert.deepEqual(state.loginOptions, {});
  assert.equal(state.save, 0);
  assert.equal(state.retry, 0);
  assert.equal(state.abort, 0);
  assert.equal(state.starts, 0);
  assert.equal(state.sends, 0);
  assert.equal(state.stops, 1);
});

test("no callback or default qrPath is ever passed to the SDK", async () => {
  const state = counters();
  const loader = fakeLoader(async (callback) => {
    callback(qrEvent(state));
    callback(infoEvent());
    return fakeApi(state);
  }, state);
  const statefulLoader = async () => {
    const module = await loader();
    return {
      Zalo: class extends (module.Zalo as any) {
        async loginQR(options: unknown, callback?: unknown) {
          if (typeof callback !== "function") throw new Error("no-callback");
          if (!options || Object.keys(options as object).length !== 0)
            throw new Error("unsafe-options");
          return super.loginQR(options, callback);
        }
      },
    };
  };
  await bootstrapPilotSession({
    grant: grant(),
    owner: fakeOwner().handle,
    view: fakeView().view,
    sessionStore: fakeStore().store,
    loader: statefulLoader,
    signal: new AbortController().signal,
  });
  assert.equal(state.save, 0);
  assert.equal(state.retry, 0);
});

test("invalid, oversized and non-PNG images abort before any write", async () => {
  for (const image of [
    "not-base64",
    Buffer.alloc(1024 * 1024 + 1, 1).toString("base64"),
    Buffer.from("not a png at all").toString("base64"),
  ]) {
    const state = counters();
    const store = fakeStore();
    const loader = fakeLoader((callback) => {
      callback(qrEvent(state, image));
      return new Promise(() => {});
    }, state);
    await assert.rejects(
      withTimeout(
        bootstrapPilotSession({
          grant: grant(),
          owner: fakeOwner().handle,
          view: fakeView().view,
          sessionStore: store.store,
          loader,
          signal: new AbortController().signal,
        }),
      ),
      /SDK facade unavailable/,
    );
    assert.equal(state.abort, 1);
    assert.equal(state.retry, 0);
    assert.equal(store.writes.length, 0);
  }
});

test("view failure aborts the bootstrap and prevents confirmation or persistence", async () => {
  const state = counters();
  const store = fakeStore();
  const loader = fakeLoader(async (callback) => {
    callback(qrEvent(state));
    await new Promise((resolve) => setImmediate(resolve));
    callback(infoEvent());
    return fakeApi(state);
  }, state);
  const view = fakeView({
    show: async () => {
      throw new Error("private view failed");
    },
  });
  await assert.rejects(
    withTimeout(
      bootstrapPilotSession({
        grant: grant(),
        owner: fakeOwner().handle,
        view: view.view,
        sessionStore: store.store,
        loader,
        signal: new AbortController().signal,
      }),
    ),
    /SDK facade unavailable/,
  );
  assert.equal(state.abort, 1);
  assert.equal(view.values.length, 0);
  assert.equal(store.writes.length, 0);
  assert.equal(state.starts, 0);
  assert.equal(state.sends, 0);
});

test("expiry, decline and callback rejection abort promptly without retry", async () => {
  for (const kind of ["expired", "declined"] as const) {
    const state = counters();
    const loader = fakeLoader((callback) => {
      callback(kind === "expired" ? expiredEvent(state) : declinedEvent(state));
      return new Promise(() => {});
    }, state);
    await assert.rejects(
      withTimeout(
        bootstrapPilotSession({
          grant: grant(),
          owner: fakeOwner().handle,
          view: fakeView().view,
          sessionStore: fakeStore().store,
          loader,
          signal: new AbortController().signal,
        }),
      ),
      /SDK facade unavailable/,
    );
    assert.equal(state.abort, 1);
    assert.equal(state.retry, 0);
    assert.equal(state.save, 0);
  }
});

test("external abort disposes a late API without listener start or send", async () => {
  const state = counters();
  const controller = new AbortController();
  let release!: (api: unknown) => void;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const loader = fakeLoader((callback) => {
    callback(qrEvent(state));
    return gate;
  }, state);
  const running = bootstrapPilotSession({
    grant: grant(),
    owner: fakeOwner().handle,
    view: fakeView().view,
    sessionStore: fakeStore().store,
    loader,
    signal: controller.signal,
  });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(running, /SDK facade unavailable/);
  release(fakeApi(state));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(state.stops, 1);
  assert.equal(state.starts, 0);
  assert.equal(state.sends, 0);
});

test("an already-aborted signal or failed owner never loads the SDK", async () => {
  const state = counters();
  const loader = fakeLoader(async () => ({}), state);
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(
    bootstrapPilotSession({
      grant: grant(),
      owner: fakeOwner().handle,
      view: fakeView().view,
      sessionStore: fakeStore().store,
      loader,
      signal: aborted.signal,
    }),
  );
  assert.equal(state.loads, 0);

  const owner = fakeOwner();
  owner.fail();
  await assert.rejects(
    bootstrapPilotSession({
      grant: grant(),
      owner: owner.handle,
      view: fakeView().view,
      sessionStore: fakeStore().store,
      loader,
      signal: new AbortController().signal,
    }),
  );
  assert.equal(state.loads, 0);
});

test("unexpected, missing, numeric or changed UID never reaches confirmation or persistence", async () => {
  const builders = [
    (state: Counters) => fakeApi(state, { uid: "zalo-uid-other" }),
    (state: Counters) => fakeApi(state, { getOwnId: () => undefined }),
    (state: Counters) => fakeApi(state, { uid: 123 }),
    (state: Counters) =>
      fakeApi(state, {
        getOwnId: () => {
          throw new Error("raw");
        },
      }),
  ];
  for (const build of builders) {
    const state = counters();
    const store = fakeStore();
    const view = fakeView();
    const loader = fakeLoader(async (callback) => {
      callback(qrEvent(state));
      callback(infoEvent());
      return build(state);
    }, state);
    await assert.rejects(
      bootstrapPilotSession({
        grant: grant(),
        owner: fakeOwner().handle,
        view: view.view,
        sessionStore: store.store,
        loader,
        signal: new AbortController().signal,
      }),
      /SDK facade unavailable/,
    );
    assert.equal(view.values.length, 0);
    assert.equal(store.writes.length, 0);
    assert.equal(state.starts, 0);
    assert.equal(state.sends, 0);
    assert.equal(state.stops, 1);
  }
});

test("declined identity confirmation reads no cookie and writes nothing", async () => {
  for (const confirm of [
    async () => false,
    async () => {
      throw new Error("confirmation failed");
    },
  ]) {
    const state = counters();
    const store = fakeStore();
    const loader = fakeLoader(async (callback) => {
      callback(qrEvent(state));
      callback(infoEvent());
      return fakeApi(state);
    }, state);
    await assert.rejects(
      bootstrapPilotSession({
        grant: grant(),
        owner: fakeOwner().handle,
        view: fakeView({ confirm }).view,
        sessionStore: store.store,
        loader,
        signal: new AbortController().signal,
      }),
      /SDK facade unavailable/,
    );
    assert.equal(state.cookies, 0);
    assert.equal(store.writes.length, 0);
    assert.equal(state.starts, 0);
    assert.equal(state.sends, 0);
  }
});

test("missing login metadata or malformed final cookie jar fails closed", async () => {
  const missingInfo = counters();
  const loaderMissingInfo = fakeLoader(async (callback) => {
    callback(qrEvent(missingInfo));
    return fakeApi(missingInfo);
  }, missingInfo);
  await assert.rejects(
    bootstrapPilotSession({
      grant: grant(),
      owner: fakeOwner().handle,
      view: fakeView().view,
      sessionStore: fakeStore().store,
      loader: loaderMissingInfo,
      signal: new AbortController().signal,
    }),
  );

  for (const serialized of [
    {},
    { cookies: [] },
    { cookies: [{ key: "only" }] },
  ]) {
    const state = counters();
    const store = fakeStore();
    const loader = fakeLoader(async (callback) => {
      callback(qrEvent(state));
      callback(infoEvent());
      return fakeApi(state, { serialized });
    }, state);
    await assert.rejects(
      bootstrapPilotSession({
        grant: grant(),
        owner: fakeOwner().handle,
        view: fakeView().view,
        sessionStore: store.store,
        loader,
        signal: new AbortController().signal,
      }),
    );
    assert.equal(store.writes.length, 0);
  }
});

test("failed and interrupted writes leave the store quarantined and unpublished", async () => {
  const state = counters();
  const failing = fakeStore({
    write: async () => {
      throw new Error("write failed");
    },
  });
  const loader = fakeLoader(async (callback) => {
    callback(qrEvent(state));
    callback(infoEvent());
    return fakeApi(state);
  }, state);
  await assert.rejects(
    bootstrapPilotSession({
      grant: grant(),
      owner: fakeOwner().handle,
      view: fakeView().view,
      sessionStore: failing.store,
      loader,
      signal: new AbortController().signal,
    }),
  );
  assert.equal(failing.writes.length, 1);
  assert.equal(failing.quarantines(), 1);

  const owner = fakeOwner();
  const postWriteLoss = fakeStore({
    write: async () => {
      owner.fail();
    },
  });
  await assert.rejects(
    bootstrapPilotSession({
      grant: grant(),
      owner: owner.handle,
      view: fakeView().view,
      sessionStore: postWriteLoss.store,
      loader,
      signal: new AbortController().signal,
    }),
  );
  assert.equal(postWriteLoss.writes.length, 1);
  assert.equal(postWriteLoss.quarantines(), 1);

  const controller = new AbortController();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const interrupted = fakeStore({ write: () => pending });
  const running = bootstrapPilotSession({
    grant: grant(),
    owner: fakeOwner().handle,
    view: fakeView().view,
    sessionStore: interrupted.store,
    loader,
    signal: controller.signal,
  });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(running);
  release();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(interrupted.writes.length, 1);
  assert.equal(interrupted.quarantines() >= 1, true);
});

test("non-enrollment grants are rejected before loading the SDK", async () => {
  const state = counters();
  await assert.rejects(
    bootstrapPilotSession({
      grant: grant({ purpose: "send-test" }),
      owner: fakeOwner().handle,
      view: fakeView().view,
      sessionStore: fakeStore().store,
      loader: fakeLoader(async () => ({}), state),
      signal: new AbortController().signal,
    }),
  );
  assert.equal(state.loads, 0);
});

test("stale, future-issued, malformed or unattested grants never load the SDK", async () => {
  const now = new Date("2026-11-02T00:30:00.000Z");
  const base: PilotGrant = {
    ...grant(),
    issuedAt: "2026-11-02T00:00:00.000Z",
    expiresAt: "2026-11-02T01:00:00.000Z",
  };
  const cases: Array<{ now: Date; grant: PilotGrant }> = [
    { now: new Date("2026-11-02T01:00:00.000Z"), grant: base },
    { now, grant: { ...base, issuedAt: "2026-11-02T00:31:00.000Z" } },
    { now, grant: { ...base, expiresAt: "not-a-time" } },
    { now, grant: { ...base, expiresAt: base.issuedAt } },
    { now, grant: { ...base, dedicatedAccountAttested: false as true } },
    { now, grant: { ...base, unofficialClientRiskAccepted: false as true } },
  ];
  for (const item of cases) {
    const state = counters();
    await assert.rejects(
      bootstrapPilotSession({
        grant: item.grant,
        owner: fakeOwner().handle,
        view: fakeView().view,
        sessionStore: fakeStore().store,
        loader: fakeLoader(async () => ({}), state),
        signal: new AbortController().signal,
        now: item.now,
      }),
    );
    assert.equal(state.loads, 0);
  }
});

test("the bootstrap deadline aborts a login that never resolves", async () => {
  const state = counters();
  const loader = fakeLoader((callback) => {
    callback(qrEvent(state));
    return new Promise(() => {});
  }, state);
  const started = Date.now();
  await assert.rejects(
    withTimeout(
      bootstrapPilotSession({
        grant: grant(),
        owner: fakeOwner().handle,
        view: fakeView().view,
        sessionStore: fakeStore().store,
        loader,
        signal: new AbortController().signal,
        deadlineMs: 25,
      }),
    ),
  );
  assert.equal(state.abort, 1);
  assert.equal(state.retry, 0);
  assert.equal(Date.now() - started < 900, true);
});

test("the QR file is cleared only after an in-flight write settles", async () => {
  const state = counters();
  const order: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const view = fakeView({
    show: async () => {
      order.push("show-start");
      await gate;
      order.push("show-end");
    },
    clear: async () => {
      order.push("clear");
    },
  });
  const loader = fakeLoader(async (callback) => {
    callback(qrEvent(state));
    callback(infoEvent());
    return fakeApi(state);
  }, state);
  const running = bootstrapPilotSession({
    grant: grant(),
    owner: fakeOwner().handle,
    view: view.view,
    sessionStore: fakeStore().store,
    loader,
    signal: new AbortController().signal,
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  release();
  await withTimeout(running);
  assert.deepEqual(order, ["show-start", "show-end", "clear"]);
});

test("an unconfirmed quarantine is reported instead of silently accepted", async () => {
  const state = counters();
  const failing = fakeStore({
    write: async () => {
      throw new Error("write failed");
    },
  });
  failing.store.quarantine = async () => {
    throw new Error("quarantine failed");
  };
  const view = fakeView();
  const loader = fakeLoader(async (callback) => {
    callback(qrEvent(state));
    callback(infoEvent());
    return fakeApi(state);
  }, state);
  await assert.rejects(
    bootstrapPilotSession({
      grant: grant(),
      owner: fakeOwner().handle,
      view: view.view,
      sessionStore: failing.store,
      loader,
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      (error as { code?: unknown } | null)?.code === "quarantine-unconfirmed",
  );
  assert.equal(view.clears() >= 1, true);
  assert.equal(state.starts, 0);
  assert.equal(state.sends, 0);
});

test("synthetic UID, cookie and display label never reach the console", async () => {
  const state = counters();
  const output: string[] = [];
  const original = {
    log: console.log,
    error: console.error,
    warn: console.warn,
  };
  console.log = (...args: unknown[]) => output.push(args.join(" "));
  console.error = (...args: unknown[]) => output.push(args.join(" "));
  console.warn = (...args: unknown[]) => output.push(args.join(" "));
  try {
    const loader = fakeLoader(async (callback) => {
      callback(qrEvent(state));
      callback(scannedEvent("Label \u001b[31mInjected", state));
      callback(infoEvent());
      return fakeApi(state);
    }, state);
    await bootstrapPilotSession({
      grant: grant(),
      owner: fakeOwner().handle,
      view: fakeView().view,
      sessionStore: fakeStore().store,
      loader,
      signal: new AbortController().signal,
    });
  } finally {
    console.log = original.log;
    console.error = original.error;
    console.warn = original.warn;
  }
  const joined = output.join("\n");
  assert.equal(joined.includes(sentinelUid), false);
  assert.equal(joined.includes(sentinelCookie), false);
  assert.equal(joined.includes("\u001b"), false);
});

test("private directories, QR files, session files and keys reject unsafe inputs", async () => {
  const root = await mkdtemp(join(tmpdir(), "zalo-pilot-files-"));
  try {
    const viewDirectory = join(root, "view");
    await ensurePrivateDirectory(viewDirectory);
    if (POSIX) assert.equal((await stat(viewDirectory)).mode & 0o777, 0o700);

    const view = new PrivateQrFileView({ directory: viewDirectory });
    await view.showPng(pngBytes());
    const qrPath = join(viewDirectory, "qr.png");
    assert.deepEqual(await readFile(qrPath), pngBytes());
    if (POSIX) assert.equal((await stat(qrPath)).mode & 0o777, 0o600);
    await view.clear();
    await assert.rejects(readFile(qrPath));

    await assert.rejects(view.showPng(Buffer.alloc(1024 * 1024 + 1)));
    await assert.rejects(view.showPng(Buffer.from("not png")));
    await assert.rejects(async () => {
      await new PrivateQrFileView({ directory: "relative/path" }).showPng(
        pngBytes(),
      );
    });
    await assert.rejects(async () => {
      await new PrivateQrFileView({
        directory: `${root}${sep}view${sep}..${sep}escape`,
      }).showPng(pngBytes());
    });

    const keyDirectory = join(root, "keys");
    await ensurePrivateDirectory(keyDirectory);
    const keyPath = join(keyDirectory, "session.key");
    const key = Buffer.alloc(32, 7);
    await writeFile(keyPath, key, { mode: 0o600 });
    const loaded = await readPrivateKeyFile(keyPath);
    assert.deepEqual(Buffer.from(loaded), key);
    if (POSIX) {
      await writeFile(join(keyDirectory, "wide.key"), key, { mode: 0o644 });
      await assert.rejects(
        readPrivateKeyFile(join(keyDirectory, "wide.key")),
      );
    }

    const sessionDirectory = join(root, "session");
    await ensurePrivateDirectory(sessionDirectory);
    const sessionPath = join(sessionDirectory, "session.enc");
    const store = new PrivateSessionFile({ path: sessionPath, key });
    await store.write({ version: 1, accountId: sentinelUid });
    assert.deepEqual(await store.read(), {
      version: 1,
      accountId: sentinelUid,
    });
    const stale = join(sessionDirectory, "session.enc.stale.tmp");
    await writeFile(stale, "stale");
    await store.write({ version: 1, accountId: sentinelUid });
    assert.equal(
      (await readdir(sessionDirectory)).includes("session.enc.stale.tmp"),
      false,
    );
    const manifestPath = join(keyDirectory, "manifest.json");
    await writeFile(manifestPath, "{}", { mode: 0o600 });
    assert.equal(await readPrivateTextFile(manifestPath, 1024), "{}");
    await assert.rejects(readPrivateTextFile(manifestPath, 1));
    if (POSIX) assert.equal((await stat(sessionPath)).mode & 0o777, 0o600);
    const wrong = new PrivateSessionFile({
      path: sessionPath,
      key: Buffer.alloc(32, 8),
    });
    await assert.rejects(wrong.read());
    await store.quarantine();
    await assert.rejects(store.read());
    assert.equal(
      (await readdir(sessionDirectory)).some((name) =>
        name.startsWith("session.enc.quarantine-"),
      ),
      true,
    );

    if (POSIX) {
      await writeFile(join(keyDirectory, "wide.json"), "{}", { mode: 0o644 });
      await assert.rejects(
        readPrivateTextFile(join(keyDirectory, "wide.json"), 1024),
      );

      const target = join(root, "target");
      await writeFile(target, pngBytes());
      await symlink(manifestPath, join(keyDirectory, "linked.json"));
      await assert.rejects(
        readPrivateTextFile(join(keyDirectory, "linked.json"), 1024),
      );
      const linkDirectory = join(root, "links");
      await ensurePrivateDirectory(linkDirectory);
      await symlink(target, join(viewDirectory, "qr.png")).catch(() => undefined);
      await assert.rejects(view.showPng(pngBytes()));

      const linkedDirectory = join(root, "linked-view");
      await symlink(viewDirectory, linkedDirectory).catch(() => undefined);
      await assert.rejects(
        new PrivateQrFileView({ directory: linkedDirectory }).showPng(
          pngBytes(),
        ),
      );

      const realView = join(root, "real-view");
      await ensurePrivateDirectory(realView);
      await symlink(realView, join(root, "ancestor"));
      await assert.rejects(
        new PrivateQrFileView({
          directory: join(root, "ancestor", "nested"),
        }).showPng(pngBytes()),
      );

      const linkedSession = join(sessionDirectory, "linked.enc");
      await symlink(target, linkedSession).catch(() => undefined);
      await assert.rejects(
        new PrivateSessionFile({ path: linkedSession, key }).read(),
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
