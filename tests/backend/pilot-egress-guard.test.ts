import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer, type AddressInfo } from "node:net";
import { resolve } from "node:path";

const guard = resolve(process.cwd(), "ops/pilot-egress-guard.cjs");
const proxyKeys = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "NODE_USE_ENV_PROXY",
];

function environment(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.NODE_OPTIONS;
  delete env.NODE_TLS_REJECT_UNAUTHORIZED;
  delete env.DATABASE_URL;
  delete env.PILOT_EGRESS_HOSTS;
  delete env.PILOT_EGRESS_PORTS;
  for (const key of proxyKeys) delete env[key];
  return { ...env, ...extra };
}

function guarded(script: string, extra: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, ["-r", guard, "-e", script], {
    env: environment(extra),
    encoding: "utf8",
    timeout: 5000,
  });
}

function connectScript(port: number, host: string) {
  return `
try {
  const timer = setTimeout(() => { console.log("TIMEOUT"); process.exit(3); }, 2000);
  const socket = require("node:net").connect(${port}, ${JSON.stringify(host)});
  socket.on("connect", () => { clearTimeout(timer); console.log("CONNECTED"); socket.destroy(); });
  socket.on("error", (error) => { clearTimeout(timer); console.log("ERROR", error.code || error.message); process.exit(2); });
} catch (error) {
  console.log("THREW", error.code || error.message);
  process.exit(2);
}
`;
}

async function withServer(
  run: (port: number, connections: () => number) => void | Promise<void>,
) {
  let accepted = 0;
  const server = createServer((socket) => {
    accepted++;
    socket.destroy();
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const port = (server.address() as AddressInfo).port;
  try {
    await run(port, () => accepted);
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
  }
}

test("provider policy admits only exact allowlisted public host and port", () => {
  const result = guarded(
    `const g=require(${JSON.stringify(guard)})._internal;
     console.log(JSON.stringify({
       exact:g.classifyTarget("example.test",443),
       wrongPort:g.classifyTarget("example.test",8443),
       unknown:g.classifyTarget("other.test",443),
       publicAddress:g.validateAddress("93.184.216.34","provider"),
       privateAddress:g.validateAddress("10.0.0.1","provider"),
       loopback:g.validateAddress("127.0.0.1","provider"),
       mapped:g.validateAddress("::ffff:127.0.0.1","provider")
     }));`,
    { PILOT_EGRESS_HOSTS: "example.test", PILOT_EGRESS_PORTS: "443" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    exact: "provider",
    wrongPort: null,
    unknown: null,
    publicAddress: true,
    privateAddress: false,
    loopback: false,
    mapped: false,
  });
});

test("empty allowlist denies direct IP connections before any connect", async () => {
  await withServer((port, connections) => {
    const result = guarded(connectScript(port, "127.0.0.1"));
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /PILOT_EGRESS_DENIED/);
    assert.equal(connections(), 0);
  });
});

test("alternate ports and unknown hosts are denied before DNS", () => {
  const result = guarded(connectScript(8443, "example.test"), {
    PILOT_EGRESS_HOSTS: "example.test",
    PILOT_EGRESS_PORTS: "443",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /PILOT_EGRESS_DENIED/);
});

test("public IP literals are not admitted as provider hosts", () => {
  const result = guarded(connectScript(443, "93.184.216.34"), {
    PILOT_EGRESS_HOSTS: "example.test",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /PILOT_EGRESS_DENIED/);
});

test("IPv6 loopback is denied", () => {
  const result = guarded(connectScript(443, "::1"), {
    PILOT_EGRESS_HOSTS: "example.test",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /PILOT_EGRESS_DENIED/);
});

test("a provider hostname resolving to loopback is denied", async () => {
  await withServer((port, connections) => {
    const result = guarded(connectScript(port, "localhost"), {
      PILOT_EGRESS_HOSTS: "localhost",
      PILOT_EGRESS_PORTS: String(port),
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /PILOT_EGRESS_DENIED/);
    assert.equal(connections(), 0);
  });
});

test("UDP, DNS resolve and child processes are denied", () => {
  const result = guarded(`
const dgram = require("node:dgram");
const dns = require("node:dns");
const child = require("node:child_process");
const outcomes = [];
try { dgram.createSocket("udp4"); outcomes.push("udp-allowed"); } catch (error) { outcomes.push("udp-" + error.code); }
dns.resolve4("example.test", (error) => outcomes.push("dns-" + (error && error.code)));
try { child.execSync("true"); outcomes.push("child-allowed"); } catch (error) { outcomes.push("child-" + error.code); }
setTimeout(() => console.log(outcomes.join(",")), 50);
`, { PILOT_EGRESS_HOSTS: "example.test" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    result.stdout.trim().split(",").sort(),
    [
      "child-PILOT_EGRESS_DENIED",
      "dns-PILOT_EGRESS_DENIED",
      "udp-PILOT_EGRESS_DENIED",
    ],
  );
});

test("the internal database remains reachable on its exact host and port", async () => {
  await withServer(async (port, connections) => {
    const result = guarded(connectScript(port, "127.0.0.1"), {
      DATABASE_URL: `postgres://pilot:fake@127.0.0.1:${port}/pilot`,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /CONNECTED/);
    await new Promise((done) => setTimeout(done, 20));
    assert.equal(connections(), 1);
  });
});

test("database connections to any other port are denied", async () => {
  await withServer((port, connections) => {
    const result = guarded(connectScript(port, "127.0.0.1"), {
      DATABASE_URL: "postgres://pilot:fake@127.0.0.1:5432/pilot",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /PILOT_EGRESS_DENIED/);
    assert.equal(connections(), 0);
  });
});

test("database URL query overrides cannot redirect the internal connection", async () => {
  await withServer((port, connections) => {
    const result = guarded(connectScript(port, "127.0.0.1"), {
      DATABASE_URL: `postgres://pilot:fake@127.0.0.1:${port}/pilot?host=other.test`,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /PILOT_EGRESS_DENIED/);
    assert.equal(connections(), 0);
  });
});

test("HTTP requests to the exact allowed host and port are admitted", () => {
  const result = guarded(
    `
const net = require("node:net");
const http = require("node:http");
const server = net.createServer((socket) => {
  socket.once("data", () => {
    socket.end("HTTP/1.1 200 OK\\r\\nContent-Length: 2\\r\\nConnection: close\\r\\n\\r\\nOK");
  });
});
server.listen(45442, "127.0.0.1", () => {
  http.get({ host: "127.0.0.1", port: 45442, path: "/" }, (response) => {
    response.resume();
    response.on("end", () => {
      console.log("HTTP-" + response.statusCode);
      server.close();
    });
  }).on("error", (error) => {
    console.log("HTTP-ERROR", error.code || error.message);
    server.close();
    process.exitCode = 2;
  });
});
`,
    { DATABASE_URL: "postgres://pilot:fake@127.0.0.1:45442/pilot" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /HTTP-200/);
});

test("a bare unix socket path is denied", () => {
  const result = guarded(`
try {
  require("node:net").connect({ path: "/tmp/pilot.sock" });
  console.log("UNIX-ALLOWED");
} catch (error) {
  console.log("UNIX-" + error.code);
}
`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /UNIX-PILOT_EGRESS_DENIED/);
});

test("proxy environment variables fail closed at startup", () => {
  const result = guarded("", { HTTP_PROXY: "http://127.0.0.1:1" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /PILOT_EGRESS_DENIED/);
});

test("NODE_OPTIONS cannot re-enable environment proxy handling", () => {
  const result = guarded("", { NODE_OPTIONS: "--use-env-proxy" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /PILOT_EGRESS_DENIED/);
});

test("Resolver instances and fd-based sockets cannot bypass the guard", () => {
  const result = guarded(
    `
const dns = require("node:dns");
const outcomes = [];
try {
  new dns.Resolver().resolve4("example.test", (error) =>
    outcomes.push("resolver-" + (error && error.code)),
  );
} catch (error) {
  outcomes.push("resolver-" + error.code);
}
try {
  new (require("node:net").Socket)().connect({
    host: "example.test",
    port: 443,
    fd: 3,
  });
  outcomes.push("fd-allowed");
} catch (error) {
  outcomes.push("fd-" + error.code);
}
setTimeout(() => console.log(outcomes.join(",")), 50);
`,
    { PILOT_EGRESS_HOSTS: "example.test" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split(",").sort(), [
    "fd-PILOT_EGRESS_DENIED",
    "resolver-PILOT_EGRESS_DENIED",
  ]);
});

test("wildcard provider hosts are rejected", () => {
  const result = guarded("", { PILOT_EGRESS_HOSTS: "*.zalo.me" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /PILOT_EGRESS_DENIED/);
});
