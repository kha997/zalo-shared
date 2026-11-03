"use strict";

// Pilot egress gateway: a transparent TLS passthrough router.
//
// Why this shape. The pilot connector is attached only to Docker networks
// declared internal=true, so the kernel gives it no route to the internet and
// no external DNS; that topology, not this process, is the enforcement
// boundary. The connector reaches a provider hostname because compose pins that
// name to this gateway's static address in /etc/hosts, so the connector's TCP
// connection arrives here while its TLS ClientHello still carries the real
// provider SNI. This process reads that SNI, admits only exact allowlisted
// names, resolves and pins the real destination itself, and splices opaque
// bytes.
//
// TLS is never intercepted: there is no certificate, no key and no MITM here,
// so the connector still validates the provider certificate end to end and
// this process never sees a session key, cookie or message body.
//
// A transparent router is used rather than a CONNECT proxy because the pinned
// SDK builds its WebSocket options from its own context (`agent:
// this.ctx.options.agent` in dist/apis/listen.js) and the connector does not
// configure a proxy agent there. Covering that path with a client-side proxy
// setting would mean patching an integrity-pinned dependency, which is out of
// scope. Docker also ignores `--dns` on an internal network, so this process
// cannot act as the connector's resolver.
//
// Every decision produces one audit line on stdout. Denials record the SNI
// hostname, which makes this process the endpoint-discovery instrument for a
// future authorized observation window: a host that is pinned but not
// allowlisted is refused here and its name is written to the log, so the
// inventory can be assembled without any traffic reaching it.

const net = require("node:net");
const dns = require("node:dns");
const { validateAddress } = require("./egress-address-policy.cjs");

const DEFAULT_PORT = 443;
const DEFAULT_MAX_TUNNELS = 32;
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 10000;
const DEFAULT_IDLE_TIMEOUT_MS = 120000;
const MAX_TUNNELS_HARD_LIMIT = 256;
const TLS_RECORD_HANDSHAKE = 0x16;
const TLS_HANDSHAKE_CLIENT_HELLO = 0x01;
const TLS_EXTENSION_SERVER_NAME = 0x0000;
const TLS_NAME_TYPE_HOST_NAME = 0x00;

class GatewayConfigError extends Error {}

function invalid(message) {
  throw new GatewayConfigError(message);
}

// One JSON line per decision. Only hostnames, ports and reasons are recorded;
// no TLS payload, header or credential ever reaches this function.
function audit(event, fields) {
  process.stdout.write(
    JSON.stringify({
      ts: new Date().toISOString(),
      component: "egress-gateway",
      event,
      ...fields,
    }) + "\n",
  );
}

function parsePositiveInt(raw, settingName, limit, fallback) {
  const text =
    raw === undefined || raw === null || raw === "" ? fallback : String(raw).trim();
  if (text === undefined || !/^[0-9]{1,9}$/.test(text))
    throw invalid(`${settingName} is not a positive integer`);
  const value = Number(text);
  if (!Number.isInteger(value) || value < 1 || value > limit)
    throw invalid(`${settingName} is out of range: ${value}`);
  return value;
}

function validDnsName(host) {
  if (typeof host !== "string") return false;
  if (host.length < 1 || host.length > 253) return false;
  if (net.isIP(host) !== 0) return false;
  return host.split(".").every((label) =>
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
  );
}

function parseHostList(raw, settingName) {
  if (raw === undefined || raw === null || raw === "") return new Set();
  if (typeof raw !== "string") throw invalid(`${settingName} must be a string`);
  const hosts = new Set();
  for (const part of raw.split(",")) {
    const host = part.trim().toLowerCase();
    // An IP literal would let a caller reach a destination without naming it,
    // which defeats an SNI-keyed policy, so it is rejected outright.
    if (!host || host.endsWith(".") || !validDnsName(host))
      throw invalid(`${settingName} entry is not an exact DNS name`);
    hosts.add(host);
  }
  return hosts;
}

function parseBindAddress(raw) {
  const value = raw === undefined || raw === null || raw === "" ? "0.0.0.0" : raw;
  if (typeof value !== "string" || value.length > 64)
    throw invalid("GATEWAY_BIND_ADDRESS is invalid");
  if (value !== "0.0.0.0" && value !== "::" && net.isIP(value) === 0)
    throw invalid("GATEWAY_BIND_ADDRESS must be 0.0.0.0, :: or a literal IP");
  return value;
}

function loadConfig(env) {
  return Object.freeze({
    bindAddress: parseBindAddress(env.GATEWAY_BIND_ADDRESS),
    port: parsePositiveInt(env.GATEWAY_PORT, "GATEWAY_PORT", 65535, String(DEFAULT_PORT)),
    upstreamPort: parsePositiveInt(
      env.GATEWAY_UPSTREAM_PORT,
      "GATEWAY_UPSTREAM_PORT",
      65535,
      String(DEFAULT_PORT),
    ),
    allowHosts: parseHostList(env.GATEWAY_ALLOW_HOSTS, "GATEWAY_ALLOW_HOSTS"),
    maxTunnels: parsePositiveInt(
      env.GATEWAY_MAX_TUNNELS,
      "GATEWAY_MAX_TUNNELS",
      MAX_TUNNELS_HARD_LIMIT,
      String(DEFAULT_MAX_TUNNELS),
    ),
    handshakeTimeoutMs: parsePositiveInt(
      env.GATEWAY_HANDSHAKE_TIMEOUT_MS,
      "GATEWAY_HANDSHAKE_TIMEOUT_MS",
      600000,
      String(DEFAULT_HANDSHAKE_TIMEOUT_MS),
    ),
    idleTimeoutMs: parsePositiveInt(
      env.GATEWAY_IDLE_TIMEOUT_MS,
      "GATEWAY_IDLE_TIMEOUT_MS",
      3600000,
      String(DEFAULT_IDLE_TIMEOUT_MS),
    ),
  });
}

// Reads the server_name extension out of a buffered TLS ClientHello.
// Returns { sni } on success, { incomplete: true } when more bytes are needed,
// or { reject: reason } when the stream cannot be an admissible ClientHello.
// The record length is 16 bits, so `incomplete` implies the buffer is under
// 65540 bytes; that is the whole memory bound for an undecided connection and
// no separate size limit is needed.
function extractSni(buffer) {
  if (buffer.length < 5) return { incomplete: true };
  if (buffer[0] !== TLS_RECORD_HANDSHAKE) return { reject: "not-a-tls-handshake" };
  const recordLength = buffer.readUInt16BE(3);
  if (recordLength < 1) return { reject: "implausible-record-length" };
  if (buffer.length < 5 + recordLength) return { incomplete: true };

  const record = buffer.subarray(5, 5 + recordLength);
  if (record.length < 4 || record[0] !== TLS_HANDSHAKE_CLIENT_HELLO)
    return { reject: "not-a-client-hello" };
  const helloLength = (record[1] << 16) | (record[2] << 8) | record[3];
  if (helloLength < 1 || record.length < 4 + helloLength)
    return { reject: "truncated-client-hello" };
  const helloEnd = 4 + helloLength;

  // client_version(2) + random(32) + session_id(1+n) + cipher_suites(2+n)
  // + compression(1+n) + extensions(2+n)
  let offset = 4 + 2 + 32;
  const need = (n) => {
    if (offset + n > helloEnd) throw invalid("truncated");
    const value = record.subarray(offset, offset + n);
    offset += n;
    return value;
  };
  try {
    const sessionIdLength = need(1)[0];
    need(sessionIdLength);
    const cipherLength = need(2).readUInt16BE(0);
    need(cipherLength);
    const compressionLength = need(1)[0];
    need(compressionLength);
    if (offset + 2 > helloEnd) return { reject: "no-extensions" };
    const extensionsLength = need(2).readUInt16BE(0);
    const extensionsEnd = offset + extensionsLength;
    if (extensionsEnd > helloEnd) return { reject: "truncated-extensions" };
    while (offset + 4 <= extensionsEnd) {
      const type = need(2).readUInt16BE(0);
      const length = need(2).readUInt16BE(0);
      if (offset + length > extensionsEnd) return { reject: "truncated-extension" };
      const data = need(length);
      if (type !== TLS_EXTENSION_SERVER_NAME) continue;
      if (data.length < 2) return { reject: "truncated-server-name" };
      const listLength = data.readUInt16BE(0);
      if (listLength < 3 || listLength > data.length - 2)
        return { reject: "truncated-server-name" };
      if (data[2] !== TLS_NAME_TYPE_HOST_NAME) return { reject: "unsupported-name-type" };
      const nameLength = data.readUInt16BE(3);
      if (nameLength < 1 || 5 + nameLength > 2 + listLength)
        return { reject: "truncated-server-name" };
      const name = data.subarray(5, 5 + nameLength);
      // ASCII only: decoding a high-bit byte as ASCII would let the audit name
      // differ from the bytes forwarded to the upstream.
      for (const byte of name) if (byte >= 0x80) return { reject: "malformed-server-name" };
      const sni = name.toString("ascii").toLowerCase();
      if (!validDnsName(sni) || sni.endsWith("."))
        return { reject: "malformed-server-name" };
      return { sni };
    }
    return { reject: "no-server-name-extension" };
  } catch {
    return { reject: "truncated-client-hello" };
  }
}

// Every resolved address must be admissible, and the tunnel is then pinned to
// the first one so a second, differing resolution cannot be substituted
// between the check and the connect.
function lookupPinnedAddress(hostname) {
  return new Promise((resolve, reject) => {
    dns.lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error)
        return reject(
          new GatewayConfigError(
            error.code === "ENOENT" || error.code === "ENOTFOUND"
              ? "unresolvable"
              : "resolution-failed",
          ),
        );
      const list = Array.isArray(addresses) ? addresses : [];
      if (list.length === 0) return reject(new GatewayConfigError("unresolvable"));
      for (const entry of list) {
        if (
          !entry ||
          typeof entry.address !== "string" ||
          !validateAddress(entry.address, "provider")
        )
          return reject(new GatewayConfigError("non-public-address"));
      }
      resolve({ address: list[0].address, family: list[0].family });
    });
  });
}

function startGateway(config) {
  const settings = config ?? loadConfig(process.env);
  let tunnels = 0;

  const server = net.createServer({ allowHalfOpen: false });
  // Undecided connections buffer at most one ClientHello while they wait for a
  // decision. Cap concurrent sockets as well as established tunnels so a burst
  // of half-open handshakes cannot exhaust memory. The connector is the only
  // peer, so this is a self-DoS limit, not a trust boundary.
  server.maxConnections = settings.maxTunnels * 2;

  server.on("connection", (clientSocket) => {
    const remote = clientSocket.remoteAddress;
    // Set once a decision is final, whether allow or deny, so the handshake
    // timer and a late upstream failure cannot both act on the same tunnel.
    let decided = false;
    let upstreamSocket = null;

    const deny = (reason, extra) => {
      if (decided) return;
      decided = true;
      audit("sni_deny", { reason, remoteAddress: remote, ...extra });
      if (upstreamSocket) upstreamSocket.destroy();
      clientSocket.destroy();
    };

    clientSocket.setTimeout(settings.handshakeTimeoutMs);
    const onHandshakeTimeout = () => deny("handshake-timeout");
    clientSocket.once("timeout", onHandshakeTimeout);
    clientSocket.once("error", () => clientSocket.destroy());

    if (tunnels >= settings.maxTunnels) return deny("tunnel-limit");

    let buffered = Buffer.alloc(0);
    let helloSettled = false;

    const onData = (chunk) => {
      if (helloSettled) return;
      buffered = Buffer.concat([buffered, chunk]);
      const parsed = extractSni(buffered);
      if (parsed.incomplete) return;
      if (parsed.reject) return deny(parsed.reject);

      helloSettled = true;
      clientSocket.removeListener("data", onData);
      clientSocket.pause();
      const sni = parsed.sni;

      if (!settings.allowHosts.has(sni))
        return deny("host-not-allowlisted", { sni });

      lookupPinnedAddress(sni).then(
        (pinned) => {
          if (decided) return;
          const upstream = net.connect({
            host: pinned.address,
            port: settings.upstreamPort,
            family: pinned.family,
          });
          upstreamSocket = upstream;
          upstream.setTimeout(settings.idleTimeoutMs);

          const onUpstreamFailure = (error) => {
            upstreamSocket = null;
            deny((error && error.code) || "upstream-error", {
              sni,
              address: pinned.address,
            });
          };
          upstream.once("error", onUpstreamFailure);

          upstream.once("connect", () => {
            upstream.removeListener("error", onUpstreamFailure);
            if (decided) return upstream.destroy();
            decided = true;
            tunnels += 1;
            audit("sni_allow", {
              sni,
              port: settings.upstreamPort,
              address: pinned.address,
              family: pinned.family,
              remoteAddress: remote,
              tunnels,
            });

            let closed = false;
            const closeBoth = () => {
              if (closed) return;
              closed = true;
              tunnels = Math.max(0, tunnels - 1);
              upstream.destroy();
              clientSocket.destroy();
            };

            clientSocket.removeListener("timeout", onHandshakeTimeout);
            clientSocket.setTimeout(settings.idleTimeoutMs);
            // Replay the ClientHello we consumed, then splice opaquely.
            upstream.write(buffered);
            clientSocket.pipe(upstream).pipe(clientSocket);
            upstream.once("close", closeBoth);
            clientSocket.once("close", closeBoth);
            upstream.on("error", closeBoth);
            clientSocket.on("error", closeBoth);
            upstream.once("timeout", closeBoth);
            clientSocket.once("timeout", closeBoth);
          });
        },
        (error) =>
          deny(error instanceof GatewayConfigError ? error.message : "resolution-failed", {
            sni,
          }),
      );
    };

    clientSocket.on("data", onData);
  });

  server.listen(settings.port, settings.bindAddress, () => {
    const bound = server.address();
    audit("startup", {
      bindAddress: settings.bindAddress,
      port: typeof bound === "object" && bound ? bound.port : settings.port,
      upstreamPort: settings.upstreamPort,
      allowHosts: [...settings.allowHosts].sort(),
      maxTunnels: settings.maxTunnels,
      node: process.version,
    });
    if (settings.allowHosts.size === 0)
      audit("startup_warning", {
        reason: "GATEWAY_ALLOW_HOSTS is empty, so every SNI is denied",
      });
  });

  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => {
      audit("shutdown", { signal, tunnels });
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 5000).unref();
    });

  return server;
}

module.exports = Object.freeze({
  GatewayConfigError,
  extractSni,
  loadConfig,
  parseBindAddress,
  parseHostList,
  validDnsName,
  startGateway,
});

if (require.main === module) {
  try {
    startGateway();
  } catch (error) {
    audit("startup_reject", {
      reason: error instanceof Error ? error.message : "unknown",
    });
    process.exit(1);
  }
}
