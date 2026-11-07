"use strict";

// Shared address policy for the pilot egress guard and the pilot egress
// gateway. Both components must classify a resolved address identically, so
// the denied-range list and the validation rules live here once rather than
// being copied into each component.

const net = require("node:net");
const ipaddr = require("ipaddr.js");

// Everything a provider destination must never resolve to: loopback, RFC1918,
// carrier-grade NAT, link-local (including the cloud metadata address),
// multicast, reserved, documentation and benchmark space, IPv6-embedded IPv4
// forms that would smuggle a private address past a naive v6 check, Teredo,
// 6to4, unique-local and the IPv4-mapped range.
const DENIED_CIDRS = [
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

const deniedCidrs = DENIED_CIDRS.map((cidr) => ipaddr.parseCIDR(cidr));

function matchesDeniedCidr(address) {
  return deniedCidrs.some(
    (cidr) => address.kind() === cidr[0].kind() && address.match(cidr),
  );
}

// "provider" is a public internet destination and must be public unicast
// outside every denied range. "database" and "gateway" are pilot
// infrastructure on an internal Docker network and must be private, loopback
// or unique-local; an unknown kind fails closed.
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
  if (kind === "database" || kind === "gateway")
    return ["private", "loopback", "uniqueLocal"].includes(range);
  return false;
}

module.exports = Object.freeze({ DENIED_CIDRS, matchesDeniedCidr, validateAddress });
