#!/usr/bin/env bash
# Assert the pilot stack is an OS-enforced network boundary and that every
# runtime allowlist value agrees with the reviewed ops/pilot-egress-allowlist.json.
#
# Static only. It renders ops/pilot-compose.example.yml with placeholder
# variables, reads no private file, starts no container and touches no network.
# Prints assertions, never the rendered config.
set -euo pipefail
cd "$(dirname "$0")/../.."

tmp_env=$(mktemp)
trap 'rm -f "$tmp_env"' EXIT

cfg=$(
  PILOT_DB_NETWORK=placeholder-db \
  PILOT_ENV_FILE="$tmp_env" \
  PILOT_MANIFEST_FILE=/nonexistent/manifest.json \
  PILOT_KEY_FILE=/nonexistent/session.key \
  PILOT_STATE_DIR=/nonexistent/state \
  PILOT_DB_CA_FILE=/nonexistent/db-ca.crt \
  PILOT_CONNECTOR_IMAGE=placeholder-connector:check \
  PILOT_EGRESS_GATEWAY_IMAGE=placeholder-gateway:check \
    docker compose -f ops/pilot-compose.example.yml config --format json
)

# The application stack is rendered the same way rather than parsed as YAML, so
# this check needs only Docker and Python. Placeholder values are never used to
# start anything; `config` only interpolates.
app_cfg=$(
  PUBLIC_ORIGIN=http://127.0.0.1:3100 \
  DATABASE_URL=postgres://zs_app:placeholder@postgres:5432/zalo \
  METRICS_TOKEN=placeholder \
  POSTGRES_DB=zalo \
  POSTGRES_USER=zs_owner \
  POSTGRES_PASSWORD=placeholder \
  APP_DATABASE_PASSWORD=placeholder \
  MIGRATION_DATABASE_URL=postgres://zs_owner:placeholder@postgres:5432/zalo \
    docker compose -f ops/compose.yaml config --format json
)

python3 - "$cfg" "$app_cfg" <<'PY'
import json, sys

def ok(text):
    print("pilot-network:", text)

allow = json.load(open("ops/pilot-egress-allowlist.json", encoding="utf-8"))
d = json.loads(sys.argv[1])
svc, nets = d["services"], d["networks"]
conn, gateway = svc["pilot-connector"], svc["egress-gateway"]
gw = allow["gateway"]
hosts = [entry["host"] for entry in allow["admitted"]]
admitted = set(hosts)

# The allowlist file must be internally consistent before it can be a source of
# truth for anything.
assert len(admitted) == len(hosts), "duplicate admitted host"
for entry in allow["admitted"]:
    assert entry["classification"] == "confirmed-static", entry
    assert entry["evidence"], entry
for section in ("pending", "excluded"):
    for entry in allow[section]:
        host = entry.get("host")
        if host:
            assert host not in admitted, (section, host)
ok(f"allowlist v{allow['version']}: {len(hosts)} admitted, "
   f"{len(allow['pending'])} pending classes, {len(allow['excluded'])} excluded")

# 1. Nothing publishes a port, so the stack adds no inbound exposure.
for name, s in svc.items():
    assert not s.get("ports"), (name, s.get("ports"))
ok("no service publishes a port")

# 2. The connector sits only on internal networks, so the kernel gives its
#    namespace no default route and no external resolver.
assert set(conn["networks"]) == {"pilot-db", "pilot-egress"}, conn["networks"]
assert nets["pilot-egress"]["internal"] is True, nets["pilot-egress"]
ok("connector joins pilot-db + pilot-egress; pilot-egress internal=true")

# 3. pilot-db is external, so its internal flag comes from the application
#    stack. Assert it there rather than trusting the operator's variable; the
#    named network itself is checked by preflight-connector.sh.
app = json.loads(sys.argv[2])
assert app["networks"]["private"]["internal"] is True, app["networks"]["private"]
ok(f"application private network is internal=true; PILOT_DB_NETWORK must name it "
   f"(deployed as '{app['name']}-...private')")

# 4. Exactly one container reaches the internet, and it is the gateway.
assert nets["pilot-uplink"].get("internal", False) is False, nets["pilot-uplink"]
uplink = {name for name, s in svc.items() if "pilot-uplink" in s.get("networks", {})}
assert uplink == {"egress-gateway"}, uplink
assert set(gateway["networks"]) == {"pilot-egress", "pilot-uplink"}, gateway["networks"]
ok("pilot-uplink is non-internal and egress-gateway is its only member")

# 5. The gateway address is static and inside the reviewed subnet.
assert gateway["networks"]["pilot-egress"]["ipv4_address"] == gw["address"], gw
subnet = nets["pilot-egress"]["ipam"]["config"][0]["subnet"]
assert subnet == gw["subnet"], (subnet, gw["subnet"])
assert gw["address"].rsplit(".", 1)[0] == gw["subnet"].rsplit(".", 1)[0], gw
ok(f"gateway static address {gw['address']} inside {subnet}")

# 6. Every admitted host is pinned to the gateway, and nothing else is pinned.
pins = {}
for entry in conn.get("extra_hosts", []):
    host, _, address = entry.partition("=")
    pins[host] = address
assert pins == {host: gw["address"] for host in hosts}, pins
ok(f"connector pins exactly {sorted(pins)} -> {gw['address']}")

# 7. The connector allowlist, the gateway allowlist and the guard pin are the
#    same reviewed values.
assert conn["environment"]["PILOT_EGRESS_HOSTS"] == ",".join(hosts)
assert gateway["environment"]["GATEWAY_ALLOW_HOSTS"] == ",".join(hosts)
assert conn["environment"]["PILOT_EGRESS_GATEWAY"] == gw["address"]
assert conn["environment"]["PILOT_EGRESS_PORTS"] == str(gw["port"])
assert gateway["environment"]["GATEWAY_PORT"] == str(gw["port"])
assert gateway["environment"]["GATEWAY_UPSTREAM_PORT"] == str(gw["port"])
ok("connector PILOT_EGRESS_HOSTS == gateway GATEWAY_ALLOW_HOSTS == reviewed allowlist")
ok(f"connector PILOT_EGRESS_GATEWAY == gateway static address == {gw['address']}")

# 7b. The gateway listens only on the connector-facing address, and the
#     connector refuses to start on a namespace with a default route.
assert gateway["environment"]["GATEWAY_BIND_ADDRESS"] == gw["address"], gateway["environment"]
assert conn["environment"]["PILOT_REQUIRE_INTERNAL_NETWORK"] == "1", conn["environment"]
assert gateway.get("healthcheck"), gateway.get("healthcheck")
ok("gateway binds only the egress address; connector requires an internal network; gateway has a healthcheck")

# 7c. verify-full needs a trust anchor, and requireTlsDatabaseUrl refuses a
#     sslrootcert parameter, so the CA arrives as a read-only mount referenced
#     by NODE_EXTRA_CA_CERTS. The variable only adds a trust anchor; it cannot
#     disable verification.
ca_mounts = [v for v in conn.get("volumes", []) if v.get("target") == "/run/pilot/db-ca.crt"]
assert len(ca_mounts) == 1, ca_mounts
assert ca_mounts[0]["read_only"] is True, ca_mounts[0]
assert ca_mounts[0]["source"] == "/nonexistent/db-ca.crt", ca_mounts[0]
assert conn["environment"]["NODE_EXTRA_CA_CERTS"] == "/run/pilot/db-ca.crt", conn["environment"]
ok("connector mounts the pilot CA read-only and trusts it via NODE_EXTRA_CA_CERTS")

# 8. No pending or excluded host is admitted, compared as whole tokens so that
#    chat.zalo.me is not mistaken for a substring of wpa.chat.zalo.me.
tokens = set(conn["environment"]["PILOT_EGRESS_HOSTS"].split(","))
tokens |= set(gateway["environment"]["GATEWAY_ALLOW_HOSTS"].split(","))
tokens |= set(pins)
assert tokens == admitted, (sorted(tokens), sorted(admitted))
ok("no pending or excluded host appears as an allowlist entry or a pin")

# 9. Hardening on both workloads.
for name in ("pilot-connector", "egress-gateway"):
    s = svc[name]
    assert s["cap_drop"] == ["ALL"], (name, s.get("cap_drop"))
    assert s["read_only"] is True, name
    assert "no-new-privileges:true" in s["security_opt"], name
    assert s["user"] == "65532:65532", name
    assert s["restart"] == "no", name
    assert s["init"] is True, name
assert gateway.get("cap_add") == ["NET_BIND_SERVICE"], gateway.get("cap_add")
assert "cap_add" not in conn, conn.get("cap_add")
ok("both workloads: cap_drop ALL, read_only, no-new-privileges, uid 65532, restart no, init")
ok("gateway adds only NET_BIND_SERVICE; the connector adds no capability")

# 10. The gateway must not be able to route between its two networks, or the
#     connector could use it as a gateway and bypass the SNI allowlist.
assert gateway["sysctls"]["net.ipv4.ip_forward"] == "0", gateway["sysctls"]
assert gateway["sysctls"]["net.ipv6.conf.all.forwarding"] == "0", gateway["sysctls"]
ok("gateway ip_forward=0 and ipv6 forwarding=0: it splices sockets, it does not route")

ok(f"pending and NOT admitted: {sorted(e['classification'] for e in allow['pending'])}")
print("pilot-network: all assertions PASS")
PY
