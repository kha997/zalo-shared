"use strict";

// Connector-local egress guard. This file is preloaded with `--require` so it
// runs before the SDK is imported. It is deliberately independent of SDK code:
// the pinned SDK uses `fetch` and `ws`, which both reach `tls.connect` and then
// `net`, so every TCP connection is checked here.
//
// This is the innermost of three layers and is NOT the enforcement boundary.
// The boundary is the network topology: the connector is attached only to
// Docker networks declared internal=true, so the kernel gives it no route to
// the internet and no external DNS, and the only sanctioned path out is the
// separate egress-gateway container, which applies its own allowlist. This
// guard narrows the process further and fails closed on misconfiguration, but
// it must never be relied on as the isolation control.

const fs = require("node:fs");
const net = require("node:net");
const tls = require("node:tls");
const dns = require("node:dns");
const dnsPromises = require("node:dns/promises");
const dgram = require("node:dgram");
const childProcess = require("node:child_process");
const {
  matchesDeniedCidr,
  validateAddress,
} = require("./egress-address-policy.cjs");

const DENIED = "PILOT_EGRESS_DENIED";
const PROXY_ENV = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "NODE_USE_ENV_PROXY",
];
const RESOLVE_NAMES = [
  "resolve",
  "resolve4",
  "resolve6",
  "resolveAny",
  "resolveCaa",
  "resolveCname",
  "resolveMx",
  "resolveNaptr",
  "resolveNs",
  "resolvePtr",
  "resolveSoa",
  "resolveSrv",
  "resolveTlsa",
  "resolveTxt",
  "lookupService",
  "reverse",
];
function denied() {
  const error = new Error(DENIED);
  error.code = DENIED;
  return error;
}

function normalizedHost(value) {
  if (typeof value !== "string") throw denied();
  let host = value.trim().toLowerCase();
  if (!host || host.includes("%") || host.includes("/") || host.includes(","))
    throw denied();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (!host || host.endsWith(".")) throw denied();
  return host;
}

function validDnsName(host) {
  if (host.length < 1 || host.length > 253) return false;
  if (net.isIP(host) !== 0) return false;
  return host.split(".").every((label) =>
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
  );
}

function parseHostList(raw) {
  if (raw === undefined || raw === null || raw === "") return new Set();
  if (typeof raw !== "string") throw denied();
  const hosts = new Set();
  for (const part of raw.split(",")) {
    const host = normalizedHost(part);
    if (!validDnsName(host)) throw denied();
    hosts.add(host);
  }
  return hosts;
}

function parsePortList(raw) {
  const value = raw === undefined || raw === null || raw === "" ? "443" : raw;
  if (typeof value !== "string") throw denied();
  const ports = new Set();
  for (const part of value.split(",")) {
    const text = part.trim();
    if (!/^[0-9]{1,5}$/.test(text)) throw denied();
    const port = Number(text);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw denied();
    ports.add(port);
  }
  return ports;
}

function parseDatabase(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  // A configured but malformed URL must stop the process at startup. Treating it
  // as "no database" would defer the failure to runtime, where every connection
  // is denied for a reason that looks like a network fault.
  if (typeof raw !== "string" || !/^postgres(ql)?:\/\//.test(raw)) throw denied();
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw denied();
  }
  if (
    url.searchParams.has("host") ||
    url.searchParams.has("port") ||
    url.searchParams.has("user") ||
    url.searchParams.has("password") ||
    url.searchParams.has("ssl")
  )
    throw denied();
  let host = url.hostname;
  if (!host || host.includes("%") || host.includes(",")) throw denied();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  host = host.toLowerCase();
  const port = url.port === "" ? 5432 : Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw denied();
  if (!validDnsName(host) && net.isIP(host) === 0) throw denied();
  return Object.freeze({ host, port });
}

// The pinned address of the egress gateway. Compose maps each allowlisted
// provider hostname to this address with `extra_hosts`, so a provider
// connection is admissible only when it resolves to exactly this address and
// to no other. This is not a proxy setting: no CONNECT, HTTP or SOCKS proxy is
// involved, and the standard proxy variables above stay denied.
function parseGatewayPin(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") throw denied();
  let address = raw.trim().toLowerCase();
  if (address.startsWith("[") && address.endsWith("]")) address = address.slice(1, -1);
  // A literal address only. A name would make the pin depend on resolution,
  // which is exactly what the pin exists to remove.
  if (net.isIP(address) === 0) throw denied();
  // The gateway lives on an internal Docker network, so its address must be
  // private, loopback or unique-local; a public pin would mean provider
  // traffic was expected to leave without the gateway.
  if (!validateAddress(address, "gateway")) throw denied();
  return address;
}

function loadConfig(env) {
  for (const name of PROXY_ENV) if (env[name]) throw denied();
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw denied();
  if (
    process.execArgv.some(
      (arg) => arg === "--use-env-proxy" || arg.startsWith("--use-env-proxy="),
    ) ||
    /(?:^|\s)--use-env-proxy(?:=|\s|$)/.test(env.NODE_OPTIONS ?? "")
  )
    throw denied();
  const providerHosts = parseHostList(env.PILOT_EGRESS_HOSTS);
  const providerPorts = parsePortList(env.PILOT_EGRESS_PORTS);
  const database = parseDatabase(env.DATABASE_URL);
  if (database && providerHosts.has(database.host)) throw denied();
  const gatewayPin = parseGatewayPin(env.PILOT_EGRESS_GATEWAY);
  // A gateway address that is also the database address would collapse two
  // distinct trust levels into one endpoint.
  if (gatewayPin && database && database.host === gatewayPin) throw denied();
  return Object.freeze({ providerHosts, providerPorts, database, gatewayPin });
}

const config = loadConfig(process.env);

// The boundary is the network namespace: the connector must have no usable
// default route. That property belongs to the operator-supplied external
// database network, which compose cannot assert. The image therefore refuses to
// start when it is attached to a network that provides a default route. This is
// a misconfiguration guard, not the isolation control: a process that never
// loads the module is still bounded by the kernel.
function routeHasUsableDefault(ipv4Text, ipv6Text) {
  for (const line of (ipv4Text ?? "").trim().split("\n").slice(1)) {
    const field = line.trim().split(/\s+/);
    if (field.length < 8) continue;
    // /proc/net/route: iface destination gateway flags ... mask ...
    if (field[1] !== "00000000" || field[7] !== "00000000") continue;
    if ((parseInt(field[3], 16) & 0x1) !== 0) return true;
  }
  for (const line of (ipv6Text ?? "").trim().split("\n")) {
    const field = line.trim().split(/\s+/);
    if (field.length < 10) continue;
    // The kernel always lists an unreachable default route; only RTF_UP without
    // RTF_REJECT is a usable one. Fields: destination, prefix, ..., flags, dev.
    if (field[0] !== "0".repeat(32) || field[1] !== "00") continue;
    const flags = parseInt(field[8], 16);
    if ((flags & 0x1) !== 0 && (flags & 0x200) === 0) return true;
  }
  return false;
}

if (process.env.PILOT_REQUIRE_INTERNAL_NETWORK === "1") {
  const read = (path) => {
    try {
      return fs.readFileSync(path, "utf8");
    } catch {
      return null;
    }
  };
  const ipv4 = read("/proc/net/route");
  const ipv6 = read("/proc/net/ipv6_route");
  // An unreadable route table cannot prove the namespace has no default route,
  // so it is denied rather than treated as empty.
  if (ipv4 === null || ipv6 === null) throw denied();
  if (routeHasUsableDefault(ipv4, ipv6)) throw denied();
}

// Marker consumed by the connector CLI. The image entrypoint preloads this
// module; if a deliberate entrypoint override skips it, preflight and live
// commands refuse instead of running unguarded.
const GUARD_MARK = Symbol.for("zalo.pilot.egress.guard");
if (!(GUARD_MARK in process))
  Object.defineProperty(process, GUARD_MARK, {
    value: "active",
    enumerable: false,
    configurable: false,
    writable: false,
  });

function classifyTarget(host, port) {
  const normalized = normalizedHost(host);
  const numericPort = Number(port);
  if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535)
    return null;
  if (
    config.database &&
    normalized === config.database.host &&
    numericPort === config.database.port
  )
    return "database";
  if (
    config.providerHosts.has(normalized) &&
    config.providerPorts.has(numericPort)
  )
    return "provider";
  return null;
}

function classifyHostname(host) {
  const normalized = normalizedHost(host);
  if (config.database && normalized === config.database.host) return "database";
  if (config.providerHosts.has(normalized)) return "provider";
  return null;
}

// Every answer must be admissible. For a provider, the gateway pin is the only
// permitted address, so a resolver that returns the pin alongside any second
// address is refused outright rather than filtered: filtering would let the
// resolver choose the direct route.
function answersAdmissible(list, kind, gatewayPin) {
  if (!Array.isArray(list) || list.length === 0) return false;
  return list.every((entry) => {
    if (!entry || typeof entry.address !== "string") return false;
    if (kind === "provider" && gatewayPin)
      return entry.address.toLowerCase() === gatewayPin;
    return validateAddress(entry.address, kind);
  });
}

function resolveAndValidate(hostname, options, kind, callback) {
  const opts =
    typeof options === "number"
      ? { family: options }
      : options && typeof options === "object"
        ? options
        : {};
  nativeLookup(hostname, { ...opts, all: true }, (error, addresses) => {
    if (error) return callback(error);
    const list = Array.isArray(addresses) ? addresses : [];
    if (!answersAdmissible(list, kind, config.gatewayPin))
      return callback(denied());
    if (opts.all) return callback(null, list);
    return callback(null, list[0].address, list[0].family);
  });
}

const nativeLookup = dns.lookup.bind(dns);

function guardedDnsLookup(hostname, options, callback) {
  const cb = typeof options === "function" ? options : callback;
  const opts = typeof options === "function" ? {} : options;
  if (typeof cb !== "function" || typeof hostname !== "string")
    throw denied();
  const kind = classifyHostname(hostname);
  if (!kind) return process.nextTick(cb, denied());
  if (net.isIP(normalizedHost(hostname)) !== 0) {
    if (kind !== "database" || normalizedHost(hostname) !== config.database.host)
      return process.nextTick(cb, denied());
  }
  return resolveAndValidate(hostname, opts, kind, cb);
}

dns.lookup = guardedDnsLookup;
const promiseLookup = function (hostname, options) {
  return new Promise((resolve, reject) => {
    guardedDnsLookup(hostname, options, (error, address, family) => {
      if (error) return reject(error);
      if (options && typeof options === "object" && options.all)
        return resolve(address);
      return resolve({ address, family });
    });
  });
};
const denyQuery = function (...args) {
  const cb = args.find((value) => typeof value === "function");
  if (cb) return process.nextTick(cb, denied());
  throw denied();
};
for (const target of [dns, dns.promises, dnsPromises]) {
  if (!target) continue;
  if (target !== dns) target.lookup = promiseLookup;
  for (const name of RESOLVE_NAMES) {
    if (typeof target[name] === "function") target[name] = denyQuery;
  }
}
// A Resolver instance uses the c-ares path directly and does not go through the
// module-level resolve functions, so its prototype must be denied as well.
for (const Resolver of [
  dns.Resolver,
  dns.promises && dns.promises.Resolver,
  dnsPromises && dnsPromises.Resolver,
]) {
  if (!Resolver || !Resolver.prototype) continue;
  for (const name of RESOLVE_NAMES) {
    if (typeof Resolver.prototype[name] === "function")
      Resolver.prototype[name] = denyQuery;
  }
}

function makeLookup(kind) {
  return function guardedLookup(hostname, options, callback) {
    const cb = typeof options === "function" ? options : callback;
    const opts = typeof options === "function" ? {} : options;
    if (typeof cb !== "function") throw denied();
    if (typeof hostname !== "string") return process.nextTick(cb, denied());
    if (net.isIP(normalizedHost(hostname)) !== 0) {
      if (kind !== "database" || normalizedHost(hostname) !== config.database.host)
        return process.nextTick(cb, denied());
    }
    return resolveAndValidate(hostname, opts, kind, cb);
  };
}

function parseConnectArguments(args) {
  if (args.length === 0) return null;
  const first = args[0];
  if (Array.isArray(first)) return parseConnectArguments(first);
  if (typeof first === "string") return null;
  if (first && typeof first === "object") {
    // A bare `path` is a Unix socket. Node's HTTP client also sets `path` for
    // the request target, so only a path without a TCP target is treated as a
    // socket path; a TCP target keeps the address check and the path is
    // dropped before connect.
    if (
      first.path !== undefined &&
      first.host === undefined &&
      first.hostname === undefined &&
      first.port === undefined
    )
      return null;
    const host =
      first.host !== undefined
        ? first.host
        : first.hostname !== undefined
          ? first.hostname
          : "localhost";
    const port = first.port;
    if (typeof host !== "string" || host.length === 0) return null;
    if (!Number.isInteger(port) && !/^[0-9]+$/.test(String(port))) return null;
    const numericPort = Number(port);
    if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535)
      return null;
    return {
      options: first,
      host,
      port: numericPort,
      kind: classifyTarget(host, numericPort),
    };
  }
  if (typeof first === "number") {
    const host = typeof args[1] === "string" ? args[1] : "localhost";
    if (!Number.isInteger(first) || first < 1 || first > 65535) return null;
    return {
      options: null,
      host,
      port: first,
      kind: classifyTarget(host, first),
    };
  }
  return null;
}

const nativeSocketConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const callArgs =
    args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
  const target = parseConnectArguments(callArgs);
  if (!target || !target.kind) throw denied();
  if (
    target.options &&
    (target.options.fd !== undefined || target.options.handle !== undefined)
  )
    throw denied();
  const host = normalizedHost(target.host);
  const lookup = makeLookup(target.kind);
  const options = target.options
    ? { ...target.options, host, port: target.port, lookup }
    : { host, port: target.port, lookup };
  delete options.path;
  delete options.fd;
  delete options.handle;
  const callback = callArgs.find((value) => typeof value === "function");
  return nativeSocketConnect.call(
    this,
    options,
    ...(callback ? [callback] : []),
  );
};

const nativeTlsConnect = tls.connect;
tls.connect = function (...args) {
  const first = args[0];
  if (first && typeof first === "object" && first.path !== undefined) {
    if (
      first.host === undefined &&
      first.hostname === undefined &&
      first.port === undefined
    )
      throw denied();
  }
  return nativeTlsConnect.apply(this, args);
};

dgram.createSocket = function () {
  throw denied();
};
if (typeof dgram.Socket === "function") {
  const NativeDgramSocket = dgram.Socket;
  dgram.Socket = class PilotDgramSocket extends NativeDgramSocket {
    constructor() {
      throw denied();
    }
  };
}

for (const name of [
  "spawn",
  "spawnSync",
  "exec",
  "execSync",
  "execFile",
  "execFileSync",
  "fork",
]) {
  if (typeof childProcess[name] === "function")
    childProcess[name] = function () {
      throw denied();
    };
}
// The module-level helpers are not the only path: a caller can construct a
// ChildProcess and call its prototype method directly.
if (typeof childProcess.ChildProcess === "function") {
  for (const name of ["spawn", "spawnSync"]) {
    if (typeof childProcess.ChildProcess.prototype[name] === "function")
      childProcess.ChildProcess.prototype[name] = function () {
        throw denied();
      };
  }
}

// Raw bindings bypass every JavaScript-level hook: tcp_wrap/udp_wrap/pipe_wrap
// create sockets, spawn_sync/process_wrap create processes, stream_wrap creates
// libuv streams and cares_wrap performs DNS queries. A blocklist is not enough
// (the name can be a String object or another coercible value), and a partial
// block leaves sibling bindings reachable, so all public raw-binding paths fail
// closed. Node internals use internalBinding, and the reviewed dependency tree
// does not call process.binding, process._linkedBinding or process.dlopen.
const denyRawBinding = () => {
  throw denied();
};
if (typeof process.binding === "function") process.binding = denyRawBinding;
if (typeof process._linkedBinding === "function")
  process._linkedBinding = denyRawBinding;
if (typeof process.dlopen === "function") process.dlopen = denyRawBinding;

// net and dgram expose internal handle factories. They create native handles,
// and outbound use would still need unexported ConnectWrap/SendWrap objects,
// but the factories are removed so the native surface stays closed.
for (const [owner, name] of [
  [net, "_createServerHandle"],
  [dgram, "_createSocketHandle"],
]) {
  if (typeof owner[name] === "function") owner[name] = denyRawBinding;
}

try {
  const workerThreads = require("node:worker_threads");
  const NativeWorker = workerThreads.Worker;
  workerThreads.Worker = class PilotWorker extends NativeWorker {
    constructor() {
      throw denied();
    }
  };
} catch {}

module.exports = Object.freeze({
  _internal: Object.freeze({
    loadConfig,
    parseHostList,
    parsePortList,
    parseDatabase,
    parseGatewayPin,
    classifyTarget,
    classifyHostname,
    validateAddress,
    answersAdmissible,
    routeHasUsableDefault,
  }),
});
