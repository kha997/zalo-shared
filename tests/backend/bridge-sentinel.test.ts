import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createZaloTransport } from "../../adapters/zalo/transport.js";
import { createSdkProvider } from "../../adapters/zalo/provider.js";
import { ProviderNotDispatchedError } from "../../server/worker.js";

for (const cancelBeforeInvocation of [false, true]) {
  test(`actual bridge distinguishes SDK cancellation payload from internal non-dispatch (${cancelBeforeInvocation})`, async () => {
    class Listener extends EventEmitter {
      start() {}
      stop() {}
    }
    const listener = new Listener();
    let calls = 0;
    const transport = createZaloTransport({
      approvedSdk: {
        createApi: async () => ({
          listener,
          sendMessage: async () => {
            calls++;
            return { cancelled: true };
          },
        }),
      },
    });
    const db = {
      async query(sql: string) {
        return {
          rows: sql.includes("provider_state")
            ? [{ status: "connected", reconciliation_required: false }]
            : sql.includes("delivery_parts")
              ? [{ part: 0 }]
              : [{ text: "synthetic", provider_thread_id: "peer", provider_thread_type: 0, attachments: 0 }],
        };
      },
    } as any;
    const provider = createSdkProvider(null as any, {
      get status() { return transport.status; },
      sendText(peer, text, type) {
        const pending = transport.sendText(peer, text, type);
        if (cancelBeforeInvocation) transport.stop();
        return pending;
      },
    });
    try {
      await transport.start();
      listener.emit("connected");
      await provider.prepareMessage!("synthetic-message", db);
      await assert.rejects(provider.sendPart("synthetic-message", 0, db), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error instanceof ProviderNotDispatchedError, cancelBeforeInvocation);
        assert.equal(error.message, cancelBeforeInvocation ? "Provider dispatch deferred" : "Provider execution uncertain");
        return true;
      });
      assert.equal(calls, cancelBeforeInvocation ? 0 : 1);
    } finally {
      transport.stop();
      provider.releaseMessage!("synthetic-message");
    }
  });
}
