"use strict";

// Connector-local egress guard. This file is preloaded with `--require` so it
// runs before the SDK is imported. It is deliberately independent of SDK code:
// the pinned SDK uses `fetch` and `ws`, which ultimately call `net`/`tls`, and
// every TCP connection is checked here. It is not a substitute for a network
// namespace or host firewall, but it is a default-deny boundary for this
// process and its worker threads.

const net = require("node:net");
const tls = require("node:tls");
const dns = require("node:dns");
const dnsPromises = require("node:dns/promises");
const dgram = require("node:dgram");
const childProcess = require("node:child_process");
const ipaddr = require("ipaddr.js");

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
const PROVIDER_DENIED_CIDRS = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.88.99.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
  "::/128",
  "::1/128",
  "::/96",
  "::ffff:0:0/96",
  "64:ff9b::/96",
  "100::/64",
  "2001::/32",
  "2001:2::/48",
  "2001:10::/28",
  "2001:20::/28",
  "2001:db8::/32",
  "2002::/16",
  "3fff::/20",
  "5f00::/16",
  "fc00::/7",
  "fe80::/10",
  "ff00::/8",
];
const deniedCidrs = PROVIDER_DENIED_CIDRS.map((cidr) => ipaddr.parseCIDR(cidr));

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
  if (typeof raw !== "string" || !/^postgres(ql)?:\/\//.test(raw)) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (
    url.searchParams.has("host") ||
    url.searchParams.has("port") ||
    url.searchParams.has("user") ||
    url.searchParams.has("password") ||
    url.searchParams.has("ssl")
  )
    return null;
  let host = url.hostname;
  if (!host || host.includes("%") || host.includes(",")) return null;
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  host = host.toLowerCase();
  const port = url.port === "" ? 5432 : Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (!validDnsName(host) && net.isIP(host) === 0) return null;
  return Object.freeze({ host, port });
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
  return Object.freeze({ providerHosts, providerPorts, database });
}

const config = loadConfig(process.env);

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

function matchesDeniedCidr(address) {
  return deniedCidrs.some(
    (cidr) =>
      address.kind() === cidr[0].kind() && address.match(cidr),
  );
}

function validateAddress(raw, kind) {
  if (typeof raw !== "string" || net.isIP(raw) === 0) return false;
  let address;
  try {
    address = ipaddr.parse(raw);
  } catch {
    return false;
  }
  if (address.kind() === "ipv6" && address.isIPv4MappedAddress()) {
    if (kind === "provider") return false;
    address = address.toIPv4Address();
  }
  const range = address.range();
  if (kind === "provider")
    return range === "unicast" && !matchesDeniedCidr(address);
  if (kind === "database")
    return ["private", "loopback", "uniqueLocal"].includes(range);
  return false;
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
    if (list.length === 0) return callback(denied());
    for (const entry of list) {
      if (
        !entry ||
        typeof entry.address !== "string" ||
        !validateAddress(entry.address, kind)
      )
        return callback(denied());
    }
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
    classifyTarget,
    classifyHostname,
    validateAddress,
  }),
});
