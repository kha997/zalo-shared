import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createZaloTransport } from "../../adapters/zalo/transport.js";
const input = () => ({
  name: "synthetic.txt",
  mime: "text/plain" as const,
  data: Buffer.from("synthetic"),
});
async function setup(
  sendAttachment?: (...args: any[]) => Promise<unknown>,
  timeout = 10,
) {
  class Listener extends EventEmitter {
    start() {}
    stop() {}
  }
  const listener = new Listener();
  const t = createZaloTransport({
    approvedSdk: {
      createApi: async () => ({
        listener,
        sendMessage: async () => ({ message: { msgId: "text" } }),
        sendAttachment,
      }),
    },
    requireConnectedEvent: false,
    sendTimeoutMs: timeout,
  });
  await t.start();
  return t;
}
test("media transport snapshots source and accepts only a single exact attachment acknowledgement", async () => {
  let seen: any;
  const t = await setup(async (...args) => {
    seen = args;
    return { message: null, attachment: [{ msgId: 42 }] };
  });
  try {
    const media = input();
    const pending = t.sendAttachment(media, "peer", 1);
    media.data.fill(0);
    assert.deepEqual(await pending, { status: "sent", providerId: "42" });
    assert.equal(seen[0].data.toString(), "synthetic");
    assert.deepEqual(seen.slice(1), ["peer", 1]);
  } finally {
    t.stop();
  }
});
test("media predispatch cancellation and validation invoke zero SDK methods", async () => {
  let calls = 0;
  const t = await setup(async () => {
    calls++;
    return { message: null, attachment: [{ msgId: "id" }] };
  });
  assert.deepEqual(
    await t.sendAttachment(
      { name: "a", mime: "text/plain", data: "/private" } as any,
      "peer",
    ),
    { status: "failed" },
  );
  const p = t.sendAttachment(input(), "peer");
  t.stop();
  assert.deepEqual(await p, { status: "failed" });
  assert.equal(calls, 0);
  const missing = await setup();
  try {
    assert.deepEqual(await missing.sendAttachment(input(), "peer"), {
      status: "failed",
    });
  } finally {
    missing.stop();
  }
});
test("media upload-like side effect followed by timeout stays unknown and never repeats", async () => {
  let calls = 0,
    late!: (x: any) => void;
  const t = await setup(async () => {
    calls++;
    return new Promise((r) => (late = r));
  });
  try {
    const result = await t.sendAttachment(input(), "peer");
    assert.deepEqual(result, { status: "unknown" });
    late({ message: null, attachment: [{ msgId: "late" }] });
    await Promise.resolve();
    assert.equal(calls, 1);
    assert.deepEqual(result, { status: "unknown" });
  } finally {
    t.stop();
  }
});
test("media SDK throw and malformed envelopes cannot prove nonexecution", async () => {
  for (const raw of [
    { cancelled: true },
    { message: { msgId: "text" }, attachment: [{ msgId: "x" }] },
    { message: null, attachment: [] },
    { message: null, attachment: [{ msgId: "a" }, { msgId: "b" }] },
    { message: null, attachment: [{ msgId: Number.MAX_SAFE_INTEGER + 1 }] },
  ]) {
    let calls = 0;
    const t = await setup(async () => {
      calls++;
      return raw;
    });
    try {
      assert.deepEqual(await t.sendAttachment(input(), "peer"), {
        status: "unknown",
      });
      assert.equal(calls, 1);
    } finally {
      t.stop();
    }
  }
  const t = await setup(async () => {
    throw new Error("secret");
  });
  try {
    assert.deepEqual(await t.sendAttachment(input(), "peer"), {
      status: "unknown",
    });
  } finally {
    t.stop();
  }
});
