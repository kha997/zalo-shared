import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  connect,
  createServer,
  type AddressInfo,
  type Socket,
} from "node:net";
import { connect as tlsConnect } from "node:tls";
import { resolve } from "node:path";

const gatewayPath = resolve(process.cwd(), "ops/egress-gateway.cjs");

type AuditLine = {
  event: string;
  reason?: string;
  sni?: string;
  port?: number;
  upstreamPort?: number;
  bindAddress?: string;
  allowHosts?: string[];
  maxTunnels?: number;
  address?: string;
  remoteAddress?: string;
};

// The gateway writes one JSON audit line per decision to stdout. Every live
// case therefore runs in a child process: audit output must never reach the
// test runner's own stdout, and the assertions are made against the real
// emitted log rather than against an in-process stub.
function childEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    ...extra,
  };
}

function evaluate<T>(script: string): T {
  const result = spawnSync(process.execPath, ["-e", script], {
    env: childEnv(),
    encoding: "utf8",
    timeout: 30000,
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim()) as T;
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}

// Captures a genuine TLS ClientHello over loopback. Nothing leaves the host and
// no certificate is validated: the server is a plain TCP socket that reads one
// chunk, so the bytes are exactly what a client puts on the wire.
async function captureClientHello(servername?: string): Promise<Buffer> {
  const port = await freePort();
  const server = createServer();
  await new Promise<void>((done) => server.listen(port, "127.0.0.1", done));
  const captured = new Promise<Buffer>((done, fail) => {
    const timer = setTimeout(
      () => fail(new Error("no ClientHello captured")),
      10000,
    );
    server.once("connection", (socket: Socket) => {
      socket.once("data", (chunk) => {
        clearTimeout(timer);
        socket.destroy();
        done(Buffer.from(chunk));
      });
    });
  });
  const client = tlsConnect({
    host: "127.0.0.1",
    port,
    servername,
    rejectUnauthorized: false,
  });
  client.on("error", () => {});
  try {
    return await captured;
  } finally {
    client.destroy();
    await new Promise<void>((done) => server.close(() => done()));
  }
}

let helloCache: { withSni: Buffer; upperSni: Buffer; withoutSni: Buffer } | null =
  null;

async function clientHellos() {
  if (helloCache) return helloCache;
  helloCache = {
    withSni: await captureClientHello("pilot-target.test"),
    upperSni: await captureClientHello("PILOT-TARGET.TEST"),
    withoutSni: await captureClientHello(),
  };
  return helloCache;
}

function sendProbe(port: number, payload: Buffer | null) {
  return new Promise<{ closed: Promise<boolean>; socket: Socket }>((done) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.on("error", () => {});
    socket.once("connect", () => {
      if (payload) socket.write(payload);
    });
    const closed = new Promise<boolean>((resolveClose) => {
      const timer = setTimeout(() => resolveClose(false), 5000);
      socket.once("close", () => {
        clearTimeout(timer);
        resolveClose(true);
      });
    });
    done({ closed, socket });
  });
}

async function withGateway(
  env: NodeJS.ProcessEnv,
  run: (ctx: {
    port: number;
    lines: () => AuditLine[];
    waitFor: (
      match: (line: AuditLine) => boolean,
      ms?: number,
    ) => Promise<AuditLine>;
  }) => Promise<void>,
) {
  const port = await freePort();
  const child = spawn(process.execPath, [gatewayPath], {
    env: childEnv({ GATEWAY_BIND_ADDRESS: "127.0.0.1", GATEWAY_PORT: String(port), ...env }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const lines: AuditLine[] = [];
  let stderrText = "";
  let pending = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderrText += chunk;
  });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    pending += chunk;
    let newline = pending.indexOf("\n");
    while (newline >= 0) {
      const text = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      newline = pending.indexOf("\n");
      if (text.trim()) lines.push(JSON.parse(text) as AuditLine);
    }
  });

  const waitFor = (match: (line: AuditLine) => boolean, ms = 8000) =>
    new Promise<AuditLine>((resolveLine, fail) => {
      const deadline = Date.now() + ms;
      const tick = () => {
        const hit = lines.find(match);
        if (hit) return resolveLine(hit);
        if (child.exitCode !== null)
          return fail(
            new Error(
              `gateway exited ${child.exitCode} before the expected audit line; log=${JSON.stringify(lines)} stderr=${stderrText}`,
            ),
          );
        if (Date.now() > deadline)
          return fail(
            new Error(
              `timed out waiting for an audit line; log=${JSON.stringify(lines)} stderr=${stderrText}`,
            ),
          );
        setTimeout(tick, 20);
      };
      tick();
    });

  try {
    const startup = await waitFor((line) => line.event === "startup");
    assert.equal(startup.port, port, JSON.stringify(startup));
    await run({ port, lines: () => lines, waitFor });
  } finally {
    child.kill("SIGTERM");
    await new Promise<void>((done) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        done();
      }, 3000);
      child.once("exit", () => {
        clearTimeout(timer);
        done();
      });
    });
  }
}

test("extractSni reads the server name from a real ClientHello", async () => {
  const { withSni, upperSni, withoutSni } = await clientHellos();
  const result = evaluate<{
    withSni: unknown;
    upperSni: unknown;
    withoutSni: unknown;
    lengths: number[];
  }>(`
const g = require(${JSON.stringify(gatewayPath)});
const withSni = Buffer.from(${JSON.stringify(withSni.toString("base64"))}, "base64");
const upperSni = Buffer.from(${JSON.stringify(upperSni.toString("base64"))}, "base64");
const withoutSni = Buffer.from(${JSON.stringify(withoutSni.toString("base64"))}, "base64");
console.log(JSON.stringify({
  withSni: g.extractSni(withSni),
  upperSni: g.extractSni(upperSni),
  withoutSni: g.extractSni(withoutSni),
  lengths: [withSni.length, upperSni.length, withoutSni.length],
}));
`);
  assert.deepEqual(result.withSni, { sni: "pilot-target.test" });
  assert.deepEqual(result.upperSni, { sni: "pilot-target.test" });
  assert.deepEqual(result.withoutSni, { reject: "no-server-name-extension" });
  assert.ok(
    result.lengths.every((length) => length > 100),
    JSON.stringify(result.lengths),
  );
});

test("every truncation of a real ClientHello is reported incomplete, never parsed", async () => {
  const { withSni } = await clientHellos();
  const result = evaluate<{ total: number; unexpected: unknown[] }>(`
const g = require(${JSON.stringify(gatewayPath)});
const hello = Buffer.from(${JSON.stringify(withSni.toString("base64"))}, "base64");
const unexpected = [];
for (let i = 0; i < hello.length; i++) {
  const parsed = g.extractSni(hello.subarray(0, i));
  if (!parsed.incomplete) unexpected.push([i, parsed]);
}
console.log(JSON.stringify({ total: hello.length, unexpected }));
`);
  assert.deepEqual(result.unexpected, []);
  assert.ok(result.total > 100);
});

test("non-TLS input and malformed records are rejected with a reason", () => {
  const result = evaluate<Record<string, unknown>>(`
const g = require(${JSON.stringify(gatewayPath)});
const b = (a) => Buffer.from(a);
console.log(JSON.stringify({
  http: g.extractSni(Buffer.from("GET / HTTP/1.1\\r\\nHost: pilot-target.test\\r\\n\\r\\n")),
  alert: g.extractSni(b([0x15, 0x03, 0x03, 0x00, 0x02, 0x02, 0x00])),
  zeroRecord: g.extractSni(b([0x16, 0x03, 0x01, 0x00, 0x00])),
  hugeRecord: g.extractSni(b([0x16, 0x03, 0x01, 0xff, 0xff])),
  notClientHello: g.extractSni(b([0x16, 0x03, 0x01, 0x00, 0x04, 0x02, 0x00, 0x00, 0x00])),
  empty: g.extractSni(Buffer.alloc(0)),
}));
`);
  assert.deepEqual(result.http, { reject: "not-a-tls-handshake" });
  assert.deepEqual(result.alert, { reject: "not-a-tls-handshake" });
  assert.deepEqual(result.zeroRecord, { reject: "implausible-record-length" });
  assert.deepEqual(result.hugeRecord, { incomplete: true });
  assert.deepEqual(result.notClientHello, { reject: "not-a-client-hello" });
  assert.deepEqual(result.empty, { incomplete: true });
});

test("the allowlist admits exact DNS names only", () => {
  const result = evaluate<{
    ok: string[];
    rejected: Record<string, string>;
    empty: string[];
    missing: string[];
  }>(`
const g = require(${JSON.stringify(gatewayPath)});
const ok = [...g.parseHostList("ID.ZALO.ME, id.zalo.me ,ok.test", "GATEWAY_ALLOW_HOSTS")].sort();
const candidates = {
  ipLiteral: "1.2.3.4",
  ipv6Literal: "::1",
  wildcard: "*.zalo.me",
  trailingDot: "id.zalo.me.",
  emptyLabel: "a..b",
  leadingHyphen: "-bad.test",
  trailingHyphen: "bad-.test",
  underscore: "under_score.test",
  space: "a b.test",
  longLabel: "a".repeat(64) + ".test",
};
const rejected = {};
for (const [name, value] of Object.entries(candidates)) {
  try { g.parseHostList(value, "GATEWAY_ALLOW_HOSTS"); rejected[name] = "accepted"; }
  catch (error) { rejected[name] = error.constructor.name + ": " + error.message; }
}
console.log(JSON.stringify({
  ok,
  rejected,
  empty: [...g.parseHostList("", "GATEWAY_ALLOW_HOSTS")],
  missing: [...g.parseHostList(undefined, "GATEWAY_ALLOW_HOSTS")],
}));
`);
  assert.deepEqual(result.ok, ["id.zalo.me", "ok.test"]);
  for (const [name, outcome] of Object.entries(result.rejected))
    assert.match(outcome, /^GatewayConfigError/, `${name}: ${outcome}`);
  assert.deepEqual(result.empty, []);
  assert.deepEqual(result.missing, []);
});

test("the bind address must be a wildcard or a literal IP", () => {
  const result = evaluate<Record<string, unknown>>(`
const g = require(${JSON.stringify(gatewayPath)});
const attempt = (value) => {
  try { return g.parseBindAddress(value); }
  catch (error) { return error.constructor.name; }
};
console.log(JSON.stringify({
  missing: attempt(undefined),
  wildcard4: attempt("0.0.0.0"),
  wildcard6: attempt("::"),
  literal: attempt("172.29.0.10"),
  name: attempt("gateway.test"),
  withPort: attempt("0.0.0.0:443"),
}));
`);
  assert.deepEqual(result, {
    missing: "0.0.0.0",
    wildcard4: "0.0.0.0",
    wildcard6: "::",
    literal: "172.29.0.10",
    name: "GatewayConfigError",
    withPort: "GatewayConfigError",
  });
});

test("loadConfig defaults are fail-closed and out-of-range settings are rejected", () => {
  const result = evaluate<{
    defaults: Record<string, unknown>;
    rejected: Record<string, string>;
  }>(`
const g = require(${JSON.stringify(gatewayPath)});
const c = g.loadConfig({});
const defaults = {
  bindAddress: c.bindAddress, port: c.port, upstreamPort: c.upstreamPort,
  allowHosts: [...c.allowHosts], maxTunnels: c.maxTunnels,
  handshakeTimeoutMs: c.handshakeTimeoutMs, idleTimeoutMs: c.idleTimeoutMs,
};
const candidates = {
  portZero: { GATEWAY_PORT: "0" },
  portHigh: { GATEWAY_PORT: "70000" },
  portText: { GATEWAY_PORT: "https" },
  portNegative: { GATEWAY_PORT: "-1" },
  upstreamZero: { GATEWAY_UPSTREAM_PORT: "0" },
  tunnelsOverHardLimit: { GATEWAY_MAX_TUNNELS: "257" },
  handshakeZero: { GATEWAY_HANDSHAKE_TIMEOUT_MS: "0" },
  idleTooLarge: { GATEWAY_IDLE_TIMEOUT_MS: "99999999" },
  allowIp: { GATEWAY_ALLOW_HOSTS: "1.2.3.4" },
  bindName: { GATEWAY_BIND_ADDRESS: "gateway.test" },
};
const rejected = {};
for (const [name, env] of Object.entries(candidates)) {
  try { g.loadConfig(env); rejected[name] = "accepted"; }
  catch (error) { rejected[name] = error.constructor.name; }
}
console.log(JSON.stringify({ defaults, rejected }));
`);
  assert.deepEqual(result.defaults, {
    bindAddress: "0.0.0.0",
    port: 443,
    upstreamPort: 443,
    allowHosts: [],
    maxTunnels: 32,
    handshakeTimeoutMs: 10000,
    idleTimeoutMs: 120000,
  });
  for (const [name, outcome] of Object.entries(result.rejected))
    assert.equal(outcome, "GatewayConfigError", name);
});

test("an invalid allowlist stops the gateway before it listens", async () => {
  const port = await freePort();
  const result = spawnSync(process.execPath, [gatewayPath], {
    env: childEnv({
      GATEWAY_BIND_ADDRESS: "127.0.0.1",
      GATEWAY_PORT: String(port),
      GATEWAY_ALLOW_HOSTS: "1.2.3.4",
    }),
    encoding: "utf8",
    timeout: 15000,
  });
  assert.equal(result.status, 1);
  const line = JSON.parse(result.stdout.trim()) as AuditLine;
  assert.equal(line.event, "startup_reject");
  assert.match(line.reason ?? "", /not an exact DNS name/);
});

test("extractSni rejects a high-bit server name instead of masking it to ASCII", async () => {
  const { withSni } = await clientHellos();
  const result = evaluate<unknown>(`
const g = require(${JSON.stringify(gatewayPath)});
const hello = Buffer.from(${JSON.stringify(withSni.toString("base64"))}, "base64");
const at = hello.indexOf(Buffer.from("pilot-target.test"));
if (at < 0) throw new Error("SNI bytes not found in the captured ClientHello");
hello[at] = 0xc0;
console.log(JSON.stringify(g.extractSni(hello)));
`);
  assert.deepEqual(result, { reject: "malformed-server-name" });
});

test("an empty allowlist denies every SNI and logs the requested name", async () => {
  const { withSni } = await clientHellos();
  await withGateway({}, async (ctx) => {
    const warning = await ctx.waitFor((line) => line.event === "startup_warning");
    assert.match(warning.reason ?? "", /empty/);
    assert.deepEqual(
      ctx.lines().find((line) => line.event === "startup")?.allowHosts,
      [],
    );

    const probe = await sendProbe(ctx.port, withSni);
    assert.equal(await probe.closed, true);
    probe.socket.destroy();

    const denied = await ctx.waitFor((line) => line.event === "sni_deny");
    assert.equal(denied.reason, "host-not-allowlisted");
    assert.equal(denied.sni, "pilot-target.test");
    assert.equal(denied.remoteAddress, "127.0.0.1");
    assert.equal(
      ctx.lines().filter((line) => line.event === "sni_allow").length,
      0,
    );
  });
});

test("non-TLS bytes on the gateway port are refused", async () => {
  await withGateway({ GATEWAY_ALLOW_HOSTS: "pilot-target.test" }, async (ctx) => {
    const probe = await sendProbe(
      ctx.port,
      Buffer.from("GET / HTTP/1.1\r\nHost: pilot-target.test\r\n\r\n"),
    );
    assert.equal(await probe.closed, true);
    probe.socket.destroy();
    const denied = await ctx.waitFor((line) => line.event === "sni_deny");
    assert.equal(denied.reason, "not-a-tls-handshake");
  });
});

test("an oversized ClientHello is refused instead of buffered without bound", async () => {
  // A TLS record length is 16 bits, so one handshake record is bounded at 65540
  // bytes on the wire. The gateway therefore reaches a decision within that
  // bound and an undecided connection cannot make it buffer without limit; a
  // slow trickle is covered separately by the handshake timeout.
  await withGateway({ GATEWAY_ALLOW_HOSTS: "pilot-target.test" }, async (ctx) => {
    const payload = Buffer.concat([
      Buffer.from([0x16, 0x03, 0x01, 0xff, 0xff]),
      Buffer.alloc(200000, 0x41),
    ]);
    const probe = await sendProbe(ctx.port, payload);
    assert.equal(await probe.closed, true);
    probe.socket.destroy();
    const denied = await ctx.waitFor((line) => line.event === "sni_deny");
    assert.equal(denied.reason, "not-a-client-hello");
    assert.equal(
      ctx.lines().filter((line) => line.event === "sni_allow").length,
      0,
    );
  });
});

test("extractSni decides within one maximum-length TLS record", () => {
  const result = evaluate<{ oneShort: unknown; maximum: unknown }>(`
const g = require(${JSON.stringify(gatewayPath)});
const record = Buffer.concat([
  Buffer.from([0x16, 0x03, 0x01, 0xff, 0xff]),
  Buffer.alloc(65535, 0x41),
]);
console.log(JSON.stringify({
  oneShort: g.extractSni(record.subarray(0, record.length - 1)),
  maximum: g.extractSni(record),
}));
`);
  assert.deepEqual(result.oneShort, { incomplete: true });
  assert.deepEqual(result.maximum, { reject: "not-a-client-hello" });
});

test("an allowlisted name that resolves to a non-public address is refused", async () => {
  const hello = await captureClientHello("localhost");
  await withGateway(
    { GATEWAY_ALLOW_HOSTS: "localhost", GATEWAY_UPSTREAM_PORT: "8443" },
    async (ctx) => {
      const probe = await sendProbe(ctx.port, hello);
      assert.equal(await probe.closed, true);
      probe.socket.destroy();
      const denied = await ctx.waitFor((line) => line.event === "sni_deny");
      assert.equal(denied.reason, "non-public-address");
      assert.equal(denied.sni, "localhost");
    },
  );
});

test("an allowlisted name that cannot be resolved is refused", async () => {
  const hello = await captureClientHello("pilot-absent-host.invalid");
  await withGateway(
    {
      GATEWAY_ALLOW_HOSTS: "pilot-absent-host.invalid",
      GATEWAY_UPSTREAM_PORT: "8443",
    },
    async (ctx) => {
      const probe = await sendProbe(ctx.port, hello);
      assert.equal(await probe.closed, true);
      probe.socket.destroy();
      const denied = await ctx.waitFor((line) => line.event === "sni_deny");
      assert.equal(denied.sni, "pilot-absent-host.invalid");
      assert.ok(
        ["unresolvable", "resolution-failed"].includes(denied.reason ?? ""),
        denied.reason,
      );
    },
  );
});

test("a connection that never sends a ClientHello is dropped at the handshake timeout", async () => {
  await withGateway(
    {
      GATEWAY_ALLOW_HOSTS: "pilot-target.test",
      GATEWAY_HANDSHAKE_TIMEOUT_MS: "250",
    },
    async (ctx) => {
      const probe = await sendProbe(ctx.port, null);
      assert.equal(await probe.closed, true);
      probe.socket.destroy();
      const denied = await ctx.waitFor((line) => line.event === "sni_deny");
      assert.equal(denied.reason, "handshake-timeout");
    },
  );
});

test("a client cannot choose the upstream destination", async () => {
  // The parsed ClientHello yields a hostname and nothing else, and the upstream
  // port is a single gateway-wide setting. There is no field in the protocol
  // this gateway speaks by which a connector could name a destination address
  // or port, so an allowlisted SNI cannot be turned into a connection to an
  // arbitrary service.
  const { withSni } = await clientHellos();
  const result = evaluate<{ parsed: string[]; config: string[] }>(`
const g = require(${JSON.stringify(gatewayPath)});
const hello = Buffer.from(${JSON.stringify(withSni.toString("base64"))}, "base64");
console.log(JSON.stringify({
  parsed: Object.keys(g.extractSni(hello)),
  config: Object.keys(g.loadConfig({ GATEWAY_ALLOW_HOSTS: "pilot-target.test" })),
}));
`);
  assert.deepEqual(result.parsed, ["sni"]);
  assert.deepEqual(result.config.sort(), [
    "allowHosts",
    "bindAddress",
    "handshakeTimeoutMs",
    "idleTimeoutMs",
    "maxTunnels",
    "port",
    "upstreamPort",
  ]);
});
