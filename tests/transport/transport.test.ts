import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  createZaloTransport,
  normalizeInbound,
} from "../../adapters/zalo/transport.js";
class Listener extends EventEmitter {
  starts = 0;
  stops = 0;
  options: unknown;
  start(options: unknown) {
    this.starts++;
    this.options = options;
  }
  stop() {
    this.stops++;
  }
}
function setup(extra = {}) {
  const listener = new Listener();
  let sends = 0;
  let options: unknown;
  const api = {
    listener,
    sendMessage: async () => {
      sends++;
      return { message: { msgId: "sent-1" }, attachment: [] };
    },
  };
  const transport = createZaloTransport({
    approvedSdk: {
      createApi: async (o) => {
        options = o;
        return api;
      },
    },
    reconnectDelayMs: 5,
    requireConnectedEvent: false,
    ...extra,
  });
  return {
    listener,
    transport,
    api,
    sends: () => sends,
    options: () => options,
  };
}
const delay = (ms = 20) => new Promise((r) => setTimeout(r, ms));
test("explicit injection creates one listener with safe options and stops reconnect timer", async () => {
  const x = setup();
  await Promise.all([x.transport.start(), x.transport.start()]);
  assert.equal(x.listener.starts, 1);
  assert.deepEqual(x.options(), {
    logging: false,
    selfListen: true,
    checkUpdate: false,
  });
  assert.deepEqual(x.listener.options, { retryOnClose: false });
  x.listener.emit("closed", 1006, "");
  x.transport.stop();
  await delay();
  assert.equal(x.listener.starts, 1);
});
test("reconnect is bounded and stale message callback is ignored", async () => {
  const received: unknown[] = [];
  const x = setup({ onInbound: (m: unknown) => received.push(m) });
  await x.transport.start();
  const callback = x.listener.listeners("message")[0]!;
  x.listener.emit("closed", 1006, "");
  await delay();
  assert.equal(x.listener.starts, 2);
  callback({});
  assert.equal(received.length, 0);
  for (let i = 0; i < 4; i++) {
    x.listener.emit("closed", 1006, "");
    await delay();
  }
  assert.equal(x.transport.status, "disconnected");
  assert.equal(x.listener.starts, 4);
  x.transport.stop();
});
test("duplicate/kick and explicit invalidation expire without retry or sending", async () => {
  for (const code of [3000, 3003]) {
    const x = setup();
    await x.transport.start();
    x.listener.emit("closed", code, "");
    await delay();
    assert.equal(x.transport.status, "expired");
    assert.equal(x.listener.starts, 1);
    assert.equal((await x.transport.sendText("peer", "hi")).status, "failed");
  }
  const x = setup();
  await x.transport.start();
  x.transport.sessionInvalid();
  assert.equal(x.transport.status, "expired");
  await x.transport.start();
  assert.equal(x.listener.starts, 1);
});
test("a listener cannot be owned by two wrappers", async () => {
  const x = setup();
  await x.transport.start();
  const y = createZaloTransport({
    approvedSdk: { createApi: async () => x.api },
  });
  await assert.rejects(y.start(), /owned/);
  x.transport.stop();
});
test("send timeout is unknown and never resent; successful result retains provider ID", async () => {
  const x = setup();
  await x.transport.start();
  assert.deepEqual(await x.transport.sendText("peer", "hi"), {
    status: "sent",
    providerId: "sent-1",
  });
  assert.equal(x.sends(), 1);
  x.transport.stop();
  let calls = 0;
  const listener = new Listener();
  const t = createZaloTransport({
    approvedSdk: {
      createApi: async () => ({
        listener,
        sendMessage: async () => {
          calls++;
          return new Promise(() => {});
        },
      }),
    },
    sendTimeoutMs: 5,
    requireConnectedEvent: false,
  });
  await t.start();
  assert.deepEqual(await t.sendText("peer", "hi"), { status: "unknown" });
  assert.equal(calls, 1);
  t.stop();
});
test("normalization keeps text and self origin, rejects malformed and treats media as unsupported metadata", () => {
  assert.deepEqual(
    normalizeInbound({
      threadId: "p",
      type: 0,
      isSelf: true,
      data: { msgId: "m", uidFrom: "me", msgType: "webchat", content: "hello" },
    }),
    {
      threadId: "p",
      threadType: 0,
      providerId: "m",
      senderId: "me",
      isSelf: true,
      kind: "text",
      text: "hello",
    },
  );
  assert.equal(normalizeInbound({}), null);
  assert.equal(
    normalizeInbound({
      threadId: "p",
      type: 0,
      isSelf: false,
      data: {
        msgId: "m",
        uidFrom: "p",
        msgType: "chat.photo",
        content: { href: "https://private" },
      },
    })?.kind,
    "unsupported",
  );
});
test("stop during SDK creation fences late completion; errors never crash and sends are uncertain", async () => {
  let resolve!: (api: any) => void;
  const listener = new Listener();
  const t = createZaloTransport({
    approvedSdk: {
      createApi: () =>
        new Promise((r) => {
          resolve = r;
        }),
    },
  });
  const pending = t.start();
  t.stop();
  resolve({ listener, sendMessage: async () => ({}) });
  await pending;
  assert.equal(listener.starts, 0);
  assert.equal(t.status, "disconnected");
  const x = setup();
  await x.transport.start();
  x.listener.emit("error", new Error("private"));
  assert.equal(x.transport.status, "disconnected");
  x.transport.stop();
  const y = setup();
  y.api.sendMessage = async () => {
    throw new Error("uncertain");
  };
  await y.transport.start();
  assert.deepEqual(await y.transport.sendText("p", "hi"), {
    status: "unknown",
  });
  y.transport.stop();
});
test("SDK connected event gates delivery and disconnected+closed only schedules one retry", async () => {
  const x = setup({ requireConnectedEvent: true });
  await x.transport.start();
  assert.equal(x.transport.status, "connecting");
  assert.deepEqual(await x.transport.sendText("p", "hi"), { status: "failed" });
  x.listener.emit("connected");
  assert.equal(x.transport.status, "connected");
  x.listener.emit("disconnected", 1006, "");
  x.listener.emit("closed", 1006, "");
  await delay();
  assert.equal(x.listener.starts, 2);
  x.transport.stop();
});
test("default waits for connected and stop fences a queued send before execution", async () => {
  const listener = new Listener();
  let calls = 0;
  const t = createZaloTransport({
    approvedSdk: {
      createApi: async () => ({
        listener,
        sendMessage: async () => {
          calls++;
          return {};
        },
      }),
    },
  });
  await t.start();
  assert.equal(t.status, "connecting");
  listener.emit("connected");
  const sent = t.sendText("peer", "hi");
  t.stop();
  assert.deepEqual(await sent, { status: "failed" });
  assert.equal(calls, 0);
});
test("late SDK errors after close or stop are consumed", async () => {
  const x = setup();
  await x.transport.start();
  x.listener.emit("closed", 1006, "");
  assert.doesNotThrow(() => x.listener.emit("error", new Error("late")));
  x.transport.stop();
  assert.doesNotThrow(() => x.listener.emit("error", new Error("later")));
});

test("zca-js 2.2.0 send envelope canonicalizes safe numeric IDs and rejects precision loss", async () => {
  // Pinned src/apis/sendMessage.ts:16-23 declares msgId:number inside message.
  for (const [id, expected] of [
    [123456789, { status: "sent", providerId: "123456789" }],
    [
      Number.MAX_SAFE_INTEGER,
      { status: "sent", providerId: String(Number.MAX_SAFE_INTEGER) },
    ],
    ["00123", { status: "sent", providerId: "00123" }],
    ["", { status: "unknown" }],
    [Number.MAX_SAFE_INTEGER + 1, { status: "unknown" }],
    [1.5, { status: "unknown" }],
    [NaN, { status: "unknown" }],
    [Infinity, { status: "unknown" }],
  ] as const) {
    const listener = new Listener();
    const transport = createZaloTransport({
      approvedSdk: {
        createApi: async () => ({
          listener,
          sendMessage: async () => ({ message: { msgId: id }, attachment: [] }),
        }),
      },
    });
    await transport.start();
    listener.emit("connected");
    assert.deepEqual(await transport.sendText("peer", "hi"), expected);
    transport.stop();
  }
});
