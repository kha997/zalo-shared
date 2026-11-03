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
  delete env.PILOT_EGRESS_GATEWAY;
  delete env.PILOT_REQUIRE_INTERNAL_NETWORK;
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
       mapped:g.validateAddress("::ffff:127.0.0.1","provider"),
       compat:g.validateAddress("::7f00:1","provider")
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
    compat: false,
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
try { new child.ChildProcess().spawn({ file: "/bin/true" }); outcomes.push("proto-spawn-allowed"); } catch (error) { outcomes.push("proto-spawn-" + error.code); }
try { process.binding("tcp_wrap"); outcomes.push("binding-allowed"); } catch (error) { outcomes.push("binding-" + error.code); }
try { process.binding(new String("tcp_wrap")); outcomes.push("binding-obj-allowed"); } catch (error) { outcomes.push("binding-obj-" + error.code); }
try { process.binding("spawn_sync"); outcomes.push("binding-spawn-allowed"); } catch (error) { outcomes.push("binding-spawn-" + error.code); }
try { process._linkedBinding("spawn_sync"); outcomes.push("linked-allowed"); } catch (error) { outcomes.push("linked-" + error.code); }
try { process.dlopen({}); outcomes.push("dlopen-allowed"); } catch (error) { outcomes.push("dlopen-" + error.code); }
try { require("node:net")._createServerHandle(); outcomes.push("net-handle-allowed"); } catch (error) { outcomes.push("net-handle-" + error.code); }
try { require("node:dgram")._createSocketHandle(); outcomes.push("dgram-handle-allowed"); } catch (error) { outcomes.push("dgram-handle-" + error.code); }
setTimeout(() => console.log(outcomes.join(",")), 50);
`, { PILOT_EGRESS_HOSTS: "example.test" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    result.stdout.trim().split(",").sort(),
    [
      "binding-PILOT_EGRESS_DENIED",
      "binding-obj-PILOT_EGRESS_DENIED",
      "binding-spawn-PILOT_EGRESS_DENIED",
      "child-PILOT_EGRESS_DENIED",
      "dgram-handle-PILOT_EGRESS_DENIED",
      "dlopen-PILOT_EGRESS_DENIED",
      "dns-PILOT_EGRESS_DENIED",
      "linked-PILOT_EGRESS_DENIED",
      "net-handle-PILOT_EGRESS_DENIED",
      "proto-spawn-PILOT_EGRESS_DENIED",
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

test("the gateway pin accepts only a literal address on the internal network", () => {
  const result = guarded(
    `const g = require(${JSON.stringify(guard)})._internal;
     const attempt = (value) => {
       try { return g.parseGatewayPin(value); } catch (error) { return error.code; }
     };
     console.log(JSON.stringify({
       missing: attempt(undefined),
       blank: attempt(""),
       loopback: attempt("127.0.0.1"),
       ipv6Loopback: attempt("::1"),
       rfc1918: attempt("172.29.0.10"),
       ten: attempt("10.5.6.7"),
       uniqueLocal: attempt("fd12:3456:789a::1"),
       bracketed: attempt("[172.29.0.10]"),
       padded: attempt("  172.29.0.10  "),
       publicV4: attempt("93.184.216.34"),
       publicV6: attempt("2606:2800:220:1:248:1893:25c8:1946"),
       linkLocal: attempt("169.254.169.254"),
       unspecified: attempt("0.0.0.0"),
       name: attempt("gateway.test"),
       withPort: attempt("172.29.0.10:443"),
       notAString: attempt(172),
     }));`,
    {},
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    missing: null,
    blank: null,
    loopback: "127.0.0.1",
    ipv6Loopback: "::1",
    rfc1918: "172.29.0.10",
    ten: "10.5.6.7",
    uniqueLocal: "fd12:3456:789a::1",
    bracketed: "172.29.0.10",
    padded: "172.29.0.10",
    publicV4: "PILOT_EGRESS_DENIED",
    publicV6: "PILOT_EGRESS_DENIED",
    linkLocal: "PILOT_EGRESS_DENIED",
    unspecified: "PILOT_EGRESS_DENIED",
    name: "PILOT_EGRESS_DENIED",
    withPort: "PILOT_EGRESS_DENIED",
    notAString: "PILOT_EGRESS_DENIED",
  });
});

test("a gateway pin that is also the database address fails closed at startup", () => {
  const result = guarded("", {
    DATABASE_URL: "postgres://pilot:fake@127.0.0.1:5432/pilot",
    PILOT_EGRESS_GATEWAY: "127.0.0.1",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /PILOT_EGRESS_DENIED/);
});

test("a provider name that does not resolve to the pinned gateway address is denied", async () => {
  await withServer((port, connections) => {
    const result = guarded(connectScript(port, "localhost"), {
      PILOT_EGRESS_HOSTS: "localhost",
      PILOT_EGRESS_PORTS: String(port),
      PILOT_EGRESS_GATEWAY: "172.29.0.10",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /PILOT_EGRESS_DENIED/);
    assert.equal(connections(), 0);
  });
});

test("a malformed gateway pin fails closed at startup rather than being ignored", () => {
  for (const pin of ["93.184.216.34", "gateway.test", "169.254.169.254"]) {
    const result = guarded("", {
      PILOT_EGRESS_HOSTS: "example.test",
      PILOT_EGRESS_GATEWAY: pin,
    });
    assert.notEqual(result.status, 0, pin);
    assert.match(result.stderr, /PILOT_EGRESS_DENIED/, pin);
  }
});

test("a mixed resolver answer set is denied rather than filtered to the pin", () => {
  const result = guarded(
    `const g=require(${JSON.stringify(guard)})._internal;
     const pin="172.29.0.10";
     console.log(JSON.stringify({
       pinned:g.answersAdmissible([{address:pin,family:4}],"provider",pin),
       upper:g.answersAdmissible([{address:"172.29.0.10",family:4}],"provider",pin),
       mixed:g.answersAdmissible([{address:pin,family:4},{address:"93.184.216.34",family:4}],"provider",pin),
       empty:g.answersAdmissible([],"provider",pin),
       privateSecond:g.answersAdmissible([{address:pin,family:4},{address:"127.0.0.1",family:4}],"provider",pin)
     }));`,
    { PILOT_EGRESS_HOSTS: "example.test" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    pinned: true,
    upper: true,
    mixed: false,
    empty: false,
    privateSecond: false,
  });
});

test("a configured but malformed DATABASE_URL fails closed at startup", () => {
  for (const url of [
    "not-a-url",
    "mysql://pilot:fake@127.0.0.1:5432/pilot",
    "postgres://pilot:fake@127.0.0.1:0/pilot",
  ]) {
    const result = guarded("", { DATABASE_URL: url });
    assert.notEqual(result.status, 0, url);
    assert.match(result.stderr, /PILOT_EGRESS_DENIED/, url);
  }
});

test("the route guard ignores the kernel reject default and detects a usable one", () => {
  const v4Default =
    "Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT\n" +
    "eth0\t00000000\t0101A8C0\t0003\t0\t0\t0\t00000000\t0\t0\t0\n";
  const v4Scoped =
    "Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT\n" +
    "eth0\t000A1CA8\t00000000\t0001\t0\t0\t0\t00FFFFFF\t0\t0\t0\n";
  const v6Reject =
    "00000000000000000000000000000000 00 00000000000000000000000000000000 00 00000400 00000001 00000000 00000000 00200200 eth0\n";
  const v6Usable =
    "00000000000000000000000000000000 00 00000000000000000000000000000000 00 00000400 00000001 00000000 00000000 00000001 eth0\n";
  const result = guarded(
    `const g=require(${JSON.stringify(guard)})._internal;
     console.log(JSON.stringify({
       v4:g.routeHasUsableDefault(${JSON.stringify(v4Default)},null),
       v4Scoped:g.routeHasUsableDefault(${JSON.stringify(v4Scoped)},null),
       v6Reject:g.routeHasUsableDefault(null,${JSON.stringify(v6Reject)}),
       v6Usable:g.routeHasUsableDefault(null,${JSON.stringify(v6Usable)}),
       absent:g.routeHasUsableDefault(null,null)
     }));`,
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    v4: true,
    v4Scoped: false,
    v6Reject: false,
    v6Usable: true,
    absent: false,
  });
});

