import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createZaloTransport } from "../../adapters/zalo/transport.js";

class Listener extends EventEmitter {
  starts = 0;
  stops = 0;
  start() {
    this.starts++;
  }
  stop() {
    this.stops++;
  }
}
const event = (id: string) => ({
  threadId: "peer",
  type: 0,
  isSelf: false,
  data: { msgId: id, uidFrom: "peer", msgType: "webchat", content: id },
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, "condition did not settle");
    await new Promise((r) => setTimeout(r, 2));
  }
}
function setup(options: Record<string, unknown> = {}) {
  const listeners: Listener[] = [];
  const transport = createZaloTransport({
    approvedSdk: {
      createApi: async () => {
        const listener = new Listener();
        listeners.push(listener);
        return {
          listener,
          sendMessage: async () => ({ message: { msgId: "sent" } }),
        };
      },
    },
    reconnectDelayMs: 1,
    ...options,
  });
  return { transport, listeners };
}

test("reconnect creates an independent API and late old-socket closure cannot expire it", async () => {
  const { transport: t, listeners } = setup();
  try {
    await t.start();
    listeners[0].emit("connected");
    const oldCallback = listeners[0].listeners("closed")[0];
    listeners[0].emit("closed", 1006);
    await until(() => listeners.length === 2);
    assert.equal(listeners[0].starts, 1);
    assert.equal(listeners[1].starts, 1);
    listeners[1].emit("connected");
    listeners[0].emit("closed", 3000);
    oldCallback(3003);
    assert.equal(t.status, "connected");
    assert.deepEqual(await t.sendText("peer", "hello"), {
      status: "sent",
      providerId: "sent",
    });
  } finally {
    t.stop();
  }
});

test("a factory returning an already-used listener is refused without restarting it", async () => {
  const listener = new Listener();
  let creations = 0;
  const t = createZaloTransport({
    approvedSdk: {
      createApi: async () => {
        creations++;
        return { listener, sendMessage: async () => ({}) };
      },
    },
    reconnectDelayMs: 1,
  });
  try {
    await t.start();
    listener.emit("connected");
    listener.emit("closed", 1006);
    await until(() => creations === 2);
    assert.equal(listener.starts, 1);
    assert.equal(t.status, "disconnected");
  } finally {
    t.stop();
  }
});

test("accepted inbound work is serial and drains after stop; new events are fenced", async () => {
  const first = deferred(),
    second = deferred();
  const started: string[] = [],
    completed: string[] = [];
  const { transport: t, listeners } = setup({
    onInbound: async (m: { providerId: string }) => {
      started.push(m.providerId);
      if (m.providerId === "1") await first.promise;
      if (m.providerId === "2") await second.promise;
      completed.push(m.providerId);
    },
  });
  try {
    await t.start();
    const l = listeners[0];
    l.emit("connected");
    l.emit("message", event("1"));
    l.emit("message", event("2"));
    l.emit("message", event("3"));
    await until(() => started.length > 0);
    assert.deepEqual(started, ["1"]);
    t.stop();
    l.emit("message", event("4"));
    first.resolve();
    await until(() => started.length === 2);
    assert.deepEqual(completed, ["1"]);
    second.resolve();
    await t.drain();
    assert.deepEqual(completed, ["1", "2", "3"]);
  } finally {
    first.resolve();
    second.resolve();
    t.stop();
  }
});

test("async persistence rejection is observed, sanitized, fail-closed and never retried", async () => {
  const faults: string[] = [];
  const { transport: t, listeners } = setup({
    onInbound: async () => {
      throw new Error("private-cookie-sentinel");
    },
    onFault: async (reason: string) => {
      faults.push(reason);
    },
  });
  try {
    assert.equal(typeof t.drain, "function");
    await t.start();
    listeners[0].emit("connected");
    listeners[0].emit("message", event("1"));
    await until(() => faults.length > 0);
    assert.equal(t.status, "disconnected");
    await assert.rejects(
      t.drain(),
      (e: Error) => !e.message.includes("private-cookie"),
    );
    await assert.rejects(t.start());
    assert.equal(listeners.length, 1);
    assert.deepEqual(faults, ["ingress-failed"]);
  } finally {
    t.stop();
  }
});

test("overflow stops new delivery while draining already accepted bounded work", async () => {
  const gate = deferred();
  const received: string[] = [],
    faults: string[] = [];
  const { transport: t, listeners } = setup({
    maxPendingInbound: 2,
    onInbound: async (m: { providerId: string }) => {
      received.push(m.providerId);
      await gate.promise;
    },
    onFault: (reason: string) => {
      faults.push(reason);
    },
  });
  try {
    assert.equal(typeof t.drain, "function");
    await t.start();
    const l = listeners[0];
    l.emit("connected");
    l.emit("message", event("1"));
    l.emit("message", event("2"));
    l.emit("message", event("3"));
    assert.equal(t.status, "disconnected");
    gate.resolve();
    await assert.rejects(t.drain());
    assert.deepEqual(received, ["1", "2"]);
    assert.deepEqual(faults, ["ingress-overflow"]);
  } finally {
    gate.resolve();
    t.stop();
  }
});

test("handshake timeout has a finite retry budget and uses fresh listeners", async () => {
  const { transport: t, listeners } = setup({ handshakeTimeoutMs: 5 });
  try {
    await t.start();
    await until(() => listeners.length === 4 && t.status === "disconnected");
    assert.equal(listeners.length, 4);
    assert.ok(listeners.every((l) => l.starts === 1 && l.stops >= 1));
  } finally {
    t.stop();
  }
});

test("late factory completion is disposed after stop without starting its listener", async () => {
  let complete!: (v: any) => void;
  const listener = new Listener();
  const t = createZaloTransport({
    approvedSdk: {
      createApi: () =>
        new Promise((r) => {
          complete = r;
        }),
    },
  });
  const pending = t.start();
  t.stop();
  complete({ listener, sendMessage: async () => ({}) });
  await pending;
  assert.equal(listener.starts, 0);
  assert.equal(listener.stops, 1);
  assert.doesNotThrow(() =>
    listener.emit("error", new Error("late private error")),
  );
});

test("invalid provider frames and invalid bounds cannot silently enter ingestion", async () => {
  const faults: string[] = [];
  const { transport: t, listeners } = setup({
    onFault: (reason: string) => faults.push(reason),
  });
  try {
    await t.start();
    listeners[0].emit("connected");
    listeners[0].emit("message", {});
    assert.equal(t.status, "disconnected");
    assert.deepEqual(faults, ["invalid-inbound"]);
  } finally {
    t.stop();
  }
  assert.throws(() => setup({ maxPendingInbound: 0 }));
  assert.throws(() => setup({ handshakeTimeoutMs: NaN }));
});

test("failed fault persistence stops reconnect without leaking or recursive reporting", async () => {
  let reports = 0;
  const { transport: t, listeners } = setup({
    onFault: async () => {
      reports++;
      throw new Error("private-fault-storage-sentinel");
    },
  });
  try {
    await t.start();
    listeners[0].emit("connected");
    listeners[0].emit("closed", 1006);
    await new Promise((r) => setTimeout(r, 25));
    assert.equal(listeners.length, 1);
    assert.equal(t.status, "disconnected");
    await assert.rejects(t.start());
    await assert.rejects(
      t.drain(),
      (e: Error) => !e.message.includes("private-fault"),
    );
    assert.equal(reports, 1);
  } finally {
    t.stop();
  }
});

test("a timed-out factory cannot affect a later fresh generation", async () => {
  let finish!: (api: any) => void;
  const old = new Listener(),
    fresh = new Listener();
  let count = 0;
  const t = createZaloTransport({
    approvedSdk: {
      createApi: async () => {
        if (count++ === 0)
          return new Promise((r) => {
            finish = r;
          });
        return { listener: fresh, sendMessage: async () => ({}) };
      },
    },
    handshakeTimeoutMs: 5,
  });
  try {
    await assert.rejects(t.start(), /initialization unavailable/);
    await t.start();
    fresh.emit("connected");
    finish({ listener: old, sendMessage: async () => ({}) });
    await until(() => old.stops === 1);
    old.emit("closed", 3003);
    assert.equal(fresh.starts, 1);
    assert.equal(old.starts, 0);
    assert.equal(t.status, "connected");
  } finally {
    t.stop();
  }
});

test("a stale factory alias cannot dispose the currently owned active listener", async () => {
  let finish!: (api: any) => void;
  let count = 0;
  const listener = new Listener();
  const api = {
    listener,
    sendMessage: async () => ({ message: { msgId: "accepted" } }),
  };
  const t = createZaloTransport({
    approvedSdk: {
      createApi: async () => {
        if (count++ === 0)
          return new Promise((r) => {
            finish = r;
          });
        return api;
      },
    },
    handshakeTimeoutMs: 5,
  });
  try {
    await assert.rejects(t.start());
    await t.start();
    listener.emit("connected");
    finish(api);
    await new Promise((r) => setTimeout(r, 2));
    assert.equal(listener.stops, 0);
    assert.equal(t.status, "connected");
  } finally {
    t.stop();
  }
});

test("immediate stop then restart opens a fresh generation instead of returning cancelled work", async () => {
  const { transport: t, listeners } = setup();
  try {
    const first = t.start();
    t.stop();
    const second = t.start();
    await Promise.all([first, second]);
    assert.equal(listeners.length, 2);
    assert.equal(listeners[0].starts, 0);
    assert.equal(listeners[1].starts, 1);
    listeners[1].emit("connected");
    assert.equal(t.status, "connected");
  } finally {
    t.stop();
  }
});

test("SDK payload cannot impersonate the private pre-dispatch cancellation outcome", async () => {
  const listener = new Listener(); let calls = 0;
  const t = createZaloTransport({ approvedSdk: { createApi: async () => ({
    listener, sendMessage: async () => { calls++; return { cancelled: true }; },
  }) } });
  try {
    await t.start(); listener.emit("connected");
    assert.deepEqual(await t.sendText("peer", "intentional reply"), { status: "unknown" });
    assert.equal(calls, 1);
  } finally { t.stop(); }
});
