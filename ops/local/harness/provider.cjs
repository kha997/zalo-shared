"use strict";

// Synthetic TLS provider for the offline allow-path harness. It stands in for a
// public provider endpoint so the gateway's admit path can be exercised end to
// end without contacting any real host. It holds no credential and serves no
// data: it completes a TLS handshake, reports the SNI it received and the
// certificate fingerprint it presented, sends one fixed token and closes.
//
// The fingerprint matters. The probe compares it with the fingerprint of the
// certificate generated for this run, which is what proves the connection
// terminated here rather than at some real host on the internet.
const crypto = require("node:crypto");
const fs = require("node:fs");
const tls = require("node:tls");

const certDir = process.env.HARNESS_CERT_DIR ?? "/harness";
const bindAddress = process.env.HARNESS_PROVIDER_BIND ?? "0.0.0.0";
const port = Number(process.env.HARNESS_PROVIDER_PORT ?? "443");

const cert = fs.readFileSync(`${certDir}/provider.crt`);
const key = fs.readFileSync(`${certDir}/provider.key`);
const fingerprint256 = new crypto.X509Certificate(cert).fingerprint256;

function audit(event, fields) {
  process.stdout.write(
    JSON.stringify({ component: "synthetic-provider", event, ...fields }) + "\n",
  );
}

const server = tls.createServer({ key, cert }, (socket) => {
  audit("handshake", {
    sni: socket.servername ?? null,
    fingerprint256,
    remoteAddress: socket.remoteAddress,
    authorized: socket.authorized,
  });
  socket.end("SYNTHETIC-PROVIDER-OK\n");
  socket.on("error", () => {});
});

server.listen(port, bindAddress, () => {
  audit("listen", { bindAddress, port, fingerprint256 });
});

for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    audit("shutdown", { signal });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
