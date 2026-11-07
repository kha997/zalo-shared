import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createZaloTransport } from "../../adapters/zalo/transport.js";
test("inbound media locator capture is private and explicitly opt-in at transport receipt", async () => {
  for (const captureMedia of [false, true]) {
    class Listener extends EventEmitter {
      start() {
        this.emit("connected");
      }
      stop() {}
    }
    const listener = new Listener();
    let event: any;
    const transport = createZaloTransport({
      captureMedia,
      approvedSdk: {
        async createApi() {
          return {
            listener,
            async sendMessage() {
              throw Error("must not send");
            },
          };
        },
      },
      onInbound(value) {
        event = value;
      },
    });
    await transport.start();
    listener.emit("message", {
      threadId: "peer",
      type: 0,
      isSelf: false,
      data: {
        msgId: "photo",
        uidFrom: "peer",
        msgType: "chat.photo",
        content: {
          title: "photo.png",
          href: "https://cdn.example.test/a?token=synthetic",
        },
      },
    });
    await transport.drain();
    transport.stop();
    assert.equal(event.kind, "unsupported");
    assert.equal(
      event.media?.[0].url,
      captureMedia ? "https://cdn.example.test/a?token=synthetic" : undefined,
    );
    if (!captureMedia)
      assert.equal(JSON.stringify(event).includes("token="), false);
  }
});
