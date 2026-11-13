"use strict";

// Boundary probe. Reports what the network layer of its own namespace actually
// permits, as one JSON object on stdout.
//
// It reads only /proc and /etc plus an optional harness CA, and dials only the
// targets it is handed. Every target is a harness address, a reserved
// documentation address (TEST-NET-1/2/3) or a reserved .test/.invalid name, so
// the probe cannot contact a provider or any real service even if the boundary
// under test were absent.
const fs = require("node:fs");
const net = require("node:net");
const tls = require("node:tls");
const dns = require("node:dns");
const dgram = require("node:dgram");

const TIMEOUT_MS = Number(process.env.HARNESS_TIMEOUT_MS ?? 4000);

function json(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return JSON.parse(raw);
}

function readIfExists(path) {
  try {
    return fs.readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function decodeRouteHex(value) {
  return value
    .match(/../g)
    .reverse()
    .map((byte) => parseInt(byte, 16))
    .join(".");
}

function ipv4Routing() {
  const raw = readIfExists("/proc/net/route");
  if (raw === null) return { present: false };
  const rows = raw
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => {
      const parts = line.split("\t");
      return {
        iface: parts[0],
        destination: decodeRouteHex(parts[1]),
        gateway: decodeRouteHex(parts[2]),
        mask: decodeRouteHex(parts[7]),
      };
    });
  return {
    present: true,
    rows,
    hasDefaultRoute: rows.some(
      (row) => row.destination === "0.0.0.0" && row.mask === "0.0.0.0",
    ),
  };
}

function ipv6Routing() {
  const raw = readIfExists("/proc/net/ipv6_route");
  if (raw === null) return { present: false };
  const rows = raw.trim().split("\n").filter(Boolean).map((line) => line.split(/\s+/));
  const addresses = (readIfExists("/proc/net/if_inet6") ?? "")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/);
      // Scope 00 is global; 10 is link-local; 20 is site-local.
      return { iface: parts[5], scope: parts[3] };
    });
  return {
    present: true,
    totalRoutes: rows.length,
    // The kernel always lists an `unreachable default` entry in an empty
    // namespace. It is a reject route (RTF_REJECT) with the maximum metric, so
    // it is not a default route anything can leave through. Count only a
    // default that is up and not rejecting.
    hasDefaultRoute: rows.some((row) => {
      if (row[0] !== "0".repeat(32) || parseInt(row[1], 16) !== 0) return false;
      const flags = parseInt(row[8] ?? "0", 16);
      const up = (flags & 0x0001) !== 0;
      const reject = (flags & 0x0200) !== 0;
      return up && !reject;
    }),
    rejectDefaultRoutes: rows.filter((row) => {
      if (row[0] !== "0".repeat(32) || parseInt(row[1], 16) !== 0) return false;
      return (parseInt(row[8] ?? "0", 16) & 0x0200) !== 0;
    }).length,
    globalScopeAddresses: addresses.filter((a) => a.scope === "00").length,
    linkLocalAddresses: addresses.filter((a) => a.scope === "10").length,
  };
}

function attemptTcp(target) {
  return new Promise((resolve) => {
    let socket;
    const finish = (outcome) => {
      clearTimeout(timer);
      try {
        socket?.destroy();
      } catch {}
      resolve(outcome);
    };
    const timer = setTimeout(() => finish("TIMEOUT"), TIMEOUT_MS);
    try {
      socket = net.connect({ host: target.host, port: target.port });
    } catch (error) {
      return finish(`THREW:${error.code ?? error.message}`);
    }
    socket.setTimeout(TIMEOUT_MS);
    socket.once("connect", () => finish("CONNECTED"));
    socket.once("timeout", () => finish("TIMEOUT"));
    socket.once("error", (error) => finish(`ERROR:${error.code ?? error.message}`));
  });
}

function attemptUdp(target) {
  return new Promise((resolve) => {
    let socket;
    const finish = (outcome) => {
      clearTimeout(timer);
      try {
        socket?.close();
      } catch {}
      resolve(outcome);
    };
    const timer = setTimeout(() => finish("TIMEOUT"), TIMEOUT_MS);
    try {
      socket = dgram.createSocket("udp4");
    } catch (error) {
      return finish(`THREW:${error.code ?? error.message}`);
    }
    socket.once("error", (error) => finish(`ERROR:${error.code ?? error.message}`));
    try {
      socket.send(Buffer.from("probe"), 0, 5, target.port, target.host, (error) => {
        if (error) return finish(`ERROR:${error.code ?? error.message}`);
        // A successful send only means the kernel accepted the datagram, so
        // wait briefly for an ICMP-driven error before calling it reachable.
        setTimeout(() => finish("SENT"), 500);
      });
    } catch (error) {
      finish(`THREW:${error.code ?? error.message}`);
    }
  });
}

function attemptLookup(name) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve("TIMEOUT"), TIMEOUT_MS);
    let done = false;
    const finish = (outcome) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    try {
      dns.lookup(name, { all: true, verbatim: true }, (error, addresses) => {
        if (error) return finish(`ERROR:${error.code ?? error.message}`);
        finish(
          `RESOLVED:${(Array.isArray(addresses) ? addresses : [])
            .map((entry) => entry.address)
            .sort()
            .join("|")}`,
        );
      });
    } catch (error) {
      finish(`THREW:${error.code ?? error.message}`);
    }
  });
}

function attemptTls(target) {
  return new Promise((resolve) => {
    const caFile = process.env.HARNESS_CA_FILE;
    const options = {
      host: target.host,
      port: target.port,
      servername: target.servername,
      rejectUnauthorized: true,
    };
    if (caFile) options.ca = fs.readFileSync(caFile);
    let socket;
    const finish = (outcome) => {
      clearTimeout(timer);
      try {
        socket?.destroy();
      } catch {}
      resolve(outcome);
    };
    const timer = setTimeout(() => finish({ outcome: "TIMEOUT" }), TIMEOUT_MS);
    try {
      socket = tls.connect(options);
    } catch (error) {
      return finish({ outcome: `THREW:${error.code ?? error.message}` });
    }
    socket.setTimeout(TIMEOUT_MS);
    socket.once("timeout", () => finish({ outcome: "TIMEOUT" }));
    socket.once("error", (error) =>
      finish({ outcome: `ERROR:${error.code ?? error.message}` }),
    );
    socket.once("secureConnect", () => {
      const certificate = socket.getPeerX509Certificate();
      const result = {
        outcome: "CONNECTED",
        authorized: socket.authorized,
        fingerprint256: certificate ? certificate.fingerprint256 : null,
        subject: certificate ? certificate.subject : null,
        data: null,
      };
      let payload = "";
      socket.setEncoding("utf8");
      socket.once("data", (chunk) => {
        payload += chunk;
      });
      socket.once("end", () => {
        result.data = payload.trim();
        finish(result);
      });
      setTimeout(() => {
        result.data = payload.trim();
        finish(result);
      }, 1500);
    });
  });
}

async function main() {
  const report = {
    component: "boundary-probe",
    node: process.version,
    uid: process.getuid ? process.getuid() : null,
    guardActive: Symbol.for("zalo.pilot.egress.guard") in process,
    resolvConf: readIfExists("/etc/resolv.conf"),
    hostsFile: readIfExists("/etc/hosts"),
    ipv4Routing: ipv4Routing(),
    ipv6Routing: ipv6Routing(),
  };

  const dnsNames = json("HARNESS_DNS_NAMES", []);
  report.dns = {};
  for (const name of dnsNames) report.dns[name] = await attemptLookup(name);

  const tcpTargets = json("HARNESS_TCP_TARGETS", []);
  report.tcp = {};
  for (const target of tcpTargets)
    report.tcp[target.label] = await attemptTcp(target);

  const udpTarget = json("HARNESS_UDP_TARGET", null);
  report.udp = udpTarget ? await attemptUdp(udpTarget) : "not-probed";

  const tlsTargets = json("HARNESS_TLS_TARGETS", []);
  report.tls = {};
  for (const target of tlsTargets)
    report.tls[target.label] = await attemptTls(target);

  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}

main().catch((error) => {
  process.stdout.write(
    JSON.stringify({ component: "boundary-probe", fatal: String(error?.stack ?? error) }) +
      "\n",
  );
  process.exitCode = 1;
});
