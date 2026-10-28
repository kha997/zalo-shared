// Run only through `npm run test:sdk`: Node permissions deny writes/processes,
// and these fail-fast hooks detect network attempts before any SDK import.
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire, syncBuiltinESMExports } from "node:module";
import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import https from "node:https";
import dgram from "node:dgram";
import childProcess from "node:child_process";
import { writeFileSync } from "node:fs";
import { normalizeInbound } from "../../adapters/zalo/transport.ts";

// Fail before any self-check if invoked without the intended permission boundary.
assert.ok(process.permission, "Run this probe through npm run test:sdk");
assert.equal(process.permission.has("fs.write"), false);
assert.equal(process.permission.has("child"), false);

let networkAttempts = 0;
const denyNetwork = () => {
  networkAttempts++;
  throw new Error("SDK offline probe forbids network");
};
net.Socket.prototype.connect = denyNetwork;
net.connect = net.createConnection = denyNetwork;
tls.connect = denyNetwork;
http.request = http.get = denyNetwork;
https.request = https.get = denyNetwork;
dgram.createSocket = denyNetwork;
globalThis.fetch = denyNetwork;
syncBuiltinESMExports();

test("offline guard self-check denies network, subprocesses and filesystem writes", () => {
  for (const attempt of [
    () => fetch("https://offline.invalid"),
    () => http.get("http://offline.invalid"),
    () => https.get("https://offline.invalid"),
    () => net.connect(9, "127.0.0.1"),
    () => tls.connect(9, "127.0.0.1"),
    () => dgram.createSocket("udp4"),
  ]) assert.throws(attempt, /forbids network/);
  assert.throws(() => childProcess.spawn(process.execPath, ["-e", "process.exit(99)"]), { code: "ERR_ACCESS_DENIED" });
  assert.throws(() => writeFileSync("/tmp/zalo-sdk-probe-must-not-exist", "forbidden"), { code: "ERR_ACCESS_DENIED" });
  assert.equal(networkAttempts, 6);
  networkAttempts = 0;
});

const raw = (uidFrom, idTo, msgId = "provider-1") => ({
  uidFrom, idTo, msgId, cliMsgId: "client-1", msgType: "webchat",
  content: "synthetic-only", ts: "1", quote: { ownerId: 123 },
});

test("actual ESM and CJS import, constructor and inbound model contracts stay offline", { timeout: 15000 }, async () => {
  const esm = await import("zca-js");
  const cjs = createRequire(import.meta.url)("zca-js");
  const fixtures = [];
  for (const sdk of [esm, cjs]) {
    const options = { logging: false, selfListen: true, checkUpdate: false };
    const instance = new sdk.Zalo(options);
    assert.equal(typeof instance.login, "function"); // Never invoke login or QR.
    assert.equal(sdk.ThreadType.User, 0);
    assert.equal(sdk.ThreadType.Group, 1);
    const directSelf = new sdk.UserMessage("owner", raw("0", "peer"));
    const directPeer = new sdk.UserMessage("owner", raw("peer", "0"));
    const groupSelf = new sdk.GroupMessage("owner", raw("0", "group"));
    const numericInbound = new sdk.UserMessage("owner", raw("peer", "0", 123));
    assert.deepEqual(normalizeInbound(directSelf), {
      threadId: "peer", threadType: 0, providerId: "provider-1", senderId: "owner",
      isSelf: true, kind: "text", text: "synthetic-only",
    });
    assert.equal(directSelf.data.cliMsgId, "client-1");
    assert.equal(directSelf.data.quote.ownerId, "123");
    assert.deepEqual(normalizeInbound(directPeer), {
      threadId: "peer", threadType: 0, providerId: "provider-1", senderId: "peer",
      isSelf: false, kind: "text", text: "synthetic-only",
    });
    assert.equal(directPeer.data.idTo, "owner");
    assert.deepEqual(normalizeInbound(groupSelf), {
      threadId: "group", threadType: 1, providerId: "provider-1", senderId: "owner",
      isSelf: true, kind: "text", text: "synthetic-only",
    });
    // Constructors do not validate types; malformed provider frames remain rejected.
    assert.equal(normalizeInbound(numericInbound), null);
    fixtures.push(JSON.parse(JSON.stringify({ directSelf, directPeer, groupSelf, numericInbound })));
  }
  assert.deepEqual(fixtures[0], fixtures[1]);
  assert.equal(networkAttempts, 0, "SDK import or model attempted network");
});
