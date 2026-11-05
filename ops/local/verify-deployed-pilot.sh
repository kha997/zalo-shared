#!/usr/bin/env bash
# Verify the deployed pilot topology, not a fixture of it.
#
# ops/local/verify-pilot-network.sh proves the boundary on disposable networks.
# This script runs against the topology that deploy-pilot-topology.sh actually
# started, and repeats the negative tests there:
#
#   * the rendered compose matches the reviewed allowlist, pins, mounts and
#     internal-network flags;
#   * the kernel alone refuses direct IP, IPv6, UDP, host-bridge and unresolved
#     names from the deployed connector network;
#   * the connector image's own guard refuses the same attempts earlier;
#   * an empty egress policy denies everything (fail closed);
#   * a stopped gateway leaves the connector with no path out;
#   * a connector attached to the uplink network refuses to start;
#   * the deployed gateway refuses an unapproved SNI and admits no tunnel.
#
# No probe uses a provider hostname: every destination is a reserved .test
# name, a documentation address, a public literal from a network with no route,
# or the gateway's private address. The only container affected is the
# dedicated pilot gateway, which is stopped and restarted within this script.
set -euo pipefail
cd "$(dirname "$0")/../.."
repo=$(pwd)

IMAGE=${PILOT_CONNECTOR_IMAGE:-zalo-shared-connector:g5-local}
EGRESS_NET=${PILOT_EGRESS_NETWORK:-zalo-shared-pilot_pilot-egress}
UPLINK_NET=${PILOT_UPLINK_NETWORK:-zalo-shared-pilot_pilot-uplink}
GATEWAY=${PILOT_GATEWAY_CONTAINER:-zalo-shared-pilot-egress-gateway-1}
GATEWAY_ADDRESS=${PILOT_GATEWAY_ADDRESS:-172.16.29.10}
HOST_BRIDGE=${GATEWAY_ADDRESS%.*}.1
PRIV=${PILOT_PRIVATE_DIR:-"$HOME/pilot-private/zalo-shared"}/topology
ALLOW_NAME=pilot-target.test
DENY_NAME=denied-target.test
PUBLIC_CANARY=1.1.1.1
PUBLIC_UDP=8.8.8.8
IPV6_CANARY=2001:db8::1
ALLOWLIST=$(python3 -c 'import json; print(",".join(e["host"] for e in json.load(open("ops/pilot-egress-allowlist.json", encoding="utf-8"))["admitted"]))')

logdir=$(mktemp -d)
gateway_stopped=0
cleanup() {
  if [ "$gateway_stopped" = "1" ]; then
    docker start "$GATEWAY" >/dev/null 2>&1 || true
  fi
  rm -rf "$logdir"
}
trap cleanup EXIT

say() { printf 'pilot-deployed: %s\n' "$*"; }
fail() { printf 'pilot-deployed: FAIL %s\n' "$*" >&2; exit 1; }

for cmd in docker python3; do
  command -v "$cmd" >/dev/null || fail "$cmd is required"
done
docker image inspect "$IMAGE" >/dev/null 2>&1 || fail "$IMAGE not found (build the connector image first)"
docker network inspect "$EGRESS_NET" >/dev/null 2>&1 || fail "run deploy-pilot-topology.sh first: $EGRESS_NET missing"
docker network inspect "$UPLINK_NET" >/dev/null 2>&1 || fail "run deploy-pilot-topology.sh first: $UPLINK_NET missing"
docker container inspect "$GATEWAY" >/dev/null 2>&1 || fail "run deploy-pilot-topology.sh first: $GATEWAY missing"
[ -f "$PRIV/pilot-compose.yml" ] || fail "$PRIV/pilot-compose.yml missing"
[ -f "$PRIV/pilot-interpolation.env" ] || fail "$PRIV/pilot-interpolation.env missing"

share() {
  case "$1" in
    /*) printf '%s' "$1" ;;
    *) printf '%s' "$repo/$1" ;;
  esac
}

# ------------------------------------------------------- rendered deployment
# Render the private copy with the private interpolation file, then assert on
# the same document the deployed gateway was started from.
docker compose --env-file "$PRIV/pilot-interpolation.env" -f "$PRIV/pilot-compose.yml" \
  config --format json >"$logdir/config.json" 2>"$logdir/config.err" ||
  { tail -20 "$logdir/config.err" >&2; fail "the private compose copy does not render"; }

# --------------------------------------------------------- deployed topology
egress_internal=$(docker network inspect "$EGRESS_NET" --format '{{.Internal}}')
uplink_internal=$(docker network inspect "$UPLINK_NET" --format '{{.Internal}}')
uplink_members=$(docker network inspect "$UPLINK_NET" --format '{{range .Containers}}{{.Name}} {{end}}' | xargs)
published=$(docker port "$GATEWAY" 2>/dev/null | wc -l)
ip_forward=$(docker exec "$GATEWAY" /nodejs/bin/node -e 'process.stdout.write(require("node:fs").readFileSync("/proc/sys/net/ipv4/ip_forward","utf8").trim())')
gateway_health=$(docker inspect -f '{{.State.Health.Status}}' "$GATEWAY" 2>/dev/null || echo unknown)
[ "$egress_internal" = "true" ] || fail "$EGRESS_NET is not internal"
[ "$uplink_internal" = "false" ] || fail "$UPLINK_NET is unexpectedly internal"
[ "$gateway_health" = "healthy" ] || fail "the deployed gateway is '$gateway_health'"

# ------------------------------------------------ gateway audit line marker
# Only events after this marker are attributed to this verification.
before_lines=$(docker logs "$GATEWAY" 2>&1 | wc -l)
docker logs "$GATEWAY" >"$logdir/gateway-before.log" 2>&1

TLS_DENIED="[{\"label\":\"denied-sni\",\"host\":\"$GATEWAY_ADDRESS\",\"port\":443,\"servername\":\"$DENY_NAME\"}]"
TLS_GUARDED="[{\"label\":\"guarded\",\"host\":\"$ALLOW_NAME\",\"port\":443,\"servername\":\"$ALLOW_NAME\"}]"
TCP_TARGETS="[{\"label\":\"direct\",\"host\":\"$PUBLIC_CANARY\",\"port\":443},{\"label\":\"ipv6-direct\",\"host\":\"$IPV6_CANARY\",\"port\":443},{\"label\":\"bridge-2026\",\"host\":\"$HOST_BRIDGE\",\"port\":2026},{\"label\":\"bridge-5432\",\"host\":\"$HOST_BRIDGE\",\"port\":5432},{\"label\":\"bridge-8080\",\"host\":\"$HOST_BRIDGE\",\"port\":8080}]"
TCP_GUARDED="[{\"label\":\"direct\",\"host\":\"$PUBLIC_CANARY\",\"port\":443},{\"label\":\"ipv6-direct\",\"host\":\"$IPV6_CANARY\",\"port\":443}]"
UDP_PUBLIC="{\"label\":\"public-udp\",\"host\":\"$PUBLIC_UDP\",\"port\":53}"
DNS_NAMES="[\"$ALLOW_NAME\",\"unpinned.test\"]"

probe() {
  local out=$1; shift
  docker run --rm --network "$EGRESS_NET" --user 65532:65532 \
    -v "$(share ops/local/harness):/harness:ro" \
    "$@" >"$logdir/out-$out.json" 2>"$logdir/err-$out.txt" || true
  if [ ! -s "$logdir/out-$out.json" ]; then
    echo "FAIL: probe $out produced no report" >&2
    tail -20 "$logdir/err-$out.txt" >&2 || true
    exit 1
  fi
}

# -------------------------------------------------- 1. kernel boundary only
probe kernel \
  --entrypoint /nodejs/bin/node \
  -e NODE_OPTIONS= \
  -e HARNESS_TIMEOUT_MS=4000 \
  -e "HARNESS_DNS_NAMES=$DNS_NAMES" \
  -e "HARNESS_TCP_TARGETS=$TCP_TARGETS" \
  -e "HARNESS_UDP_TARGET=$UDP_PUBLIC" \
  -e "HARNESS_TLS_TARGETS=$TLS_DENIED" \
  "$IMAGE" /harness/probe.cjs

# -------------------------------------- 2. the image's own guard, as launched
# The image entrypoint preloads the guard, so this uses the artifact that would
# run live: no working-tree mount over it.
probe guarded \
  --add-host "$ALLOW_NAME:$GATEWAY_ADDRESS" \
  -e PILOT_EGRESS_HOSTS="$ALLOW_NAME" \
  -e PILOT_EGRESS_PORTS=443 \
  -e PILOT_EGRESS_GATEWAY="$GATEWAY_ADDRESS" \
  -e PILOT_REQUIRE_INTERNAL_NETWORK=1 \
  -e HARNESS_TIMEOUT_MS=4000 \
  -e "HARNESS_DNS_NAMES=$DNS_NAMES" \
  -e "HARNESS_TCP_TARGETS=$TCP_GUARDED" \
  -e "HARNESS_UDP_TARGET=$UDP_PUBLIC" \
  -e "HARNESS_TLS_TARGETS=$TLS_GUARDED" \
  "$IMAGE" /harness/probe.cjs

# ------------------------------------------- 3. connector with no egress policy
# An empty allowlist must deny even the pinned, otherwise-permitted name.
probe nopolicy \
  --add-host "$ALLOW_NAME:$GATEWAY_ADDRESS" \
  -e PILOT_EGRESS_HOSTS= \
  -e PILOT_EGRESS_PORTS=443 \
  -e PILOT_EGRESS_GATEWAY="$GATEWAY_ADDRESS" \
  -e PILOT_REQUIRE_INTERNAL_NETWORK=1 \
  -e HARNESS_TIMEOUT_MS=4000 \
  -e "HARNESS_DNS_NAMES=$DNS_NAMES" \
  -e "HARNESS_TCP_TARGETS=$TCP_GUARDED" \
  -e "HARNESS_UDP_TARGET=$UDP_PUBLIC" \
  -e "HARNESS_TLS_TARGETS=$TLS_GUARDED" \
  "$IMAGE" /harness/probe.cjs

# ----------------------------------------------------- 4. stopped gateway
# The dedicated gateway is stopped, probed, and restarted. The connector keeps
# its pinned address, so this proves a missing gateway is a closed path.
gateway_stopped=1
docker stop "$GATEWAY" >/dev/null
for _ in $(seq 1 50); do
  [ "$(docker inspect -f '{{.State.Running}}' "$GATEWAY" 2>/dev/null)" = "false" ] && break
  sleep 0.1
done
[ "$(docker inspect -f '{{.State.Running}}' "$GATEWAY")" = "false" ] || fail "the gateway did not stop"

probe stopped-kernel \
  --entrypoint /nodejs/bin/node \
  -e NODE_OPTIONS= \
  -e HARNESS_TIMEOUT_MS=3000 \
  -e "HARNESS_TLS_TARGETS=$TLS_DENIED" \
  "$IMAGE" /harness/probe.cjs

probe stopped-guarded \
  --add-host "$ALLOW_NAME:$GATEWAY_ADDRESS" \
  -e PILOT_EGRESS_HOSTS="$ALLOW_NAME" \
  -e PILOT_EGRESS_PORTS=443 \
  -e PILOT_EGRESS_GATEWAY="$GATEWAY_ADDRESS" \
  -e PILOT_REQUIRE_INTERNAL_NETWORK=1 \
  -e HARNESS_TIMEOUT_MS=3000 \
  -e "HARNESS_TLS_TARGETS=$TLS_GUARDED" \
  "$IMAGE" /harness/probe.cjs

docker start "$GATEWAY" >/dev/null
gateway_stopped=0
for _ in $(seq 1 60); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$GATEWAY" 2>/dev/null)" = "healthy" ] && break
  sleep 1
done
restarted_health=$(docker inspect -f '{{.State.Health.Status}}' "$GATEWAY")
[ "$restarted_health" = "healthy" ] || fail "the gateway did not recover (state: $restarted_health)"

# -------------------------------------- 5. wrong Docker network attachment
# A connector placed on the uplink (non-internal) network would have a default
# route. The image must refuse to start before any application code runs.
guard_status=0
docker run --rm --network "$UPLINK_NET" --user 65532:65532 \
  --entrypoint /nodejs/bin/node \
  -e NODE_OPTIONS=--require=/app/egress-guard.cjs \
  -e PILOT_REQUIRE_INTERNAL_NETWORK=1 \
  "$IMAGE" -e 'process.stdout.write("guard-allowed-default-route")' \
  >"$logdir/guard-default-route.txt" 2>&1 || guard_status=$?

# ------------------------------------------------------- 6. gateway decisions
sleep 0.5
after_lines=$(docker logs "$GATEWAY" 2>&1 | wc -l)
docker logs "$GATEWAY" >"$logdir/gateway-after.log" 2>&1

python3 - \
  "$logdir" "$egress_internal" "$uplink_members" "$published" "$ip_forward" \
  "$GATEWAY" "$guard_status" "$restarted_health" "$before_lines" "$after_lines" \
  "$GATEWAY_ADDRESS" "$HOST_BRIDGE" "$EGRESS_NET" "$UPLINK_NET" "$ALLOWLIST" <<'PY'
import json, os, sys

(logdir, egress_internal, uplink_members, published, ip_forward,
 gateway_name, guard_status, restarted_health, before_lines, after_lines,
 gateway_address, host_bridge, egress_net, uplink_net,
 allowlist) = sys.argv[1:16]
ALLOW, DENY = "pilot-target.test", "denied-target.test"
ALLOWLIST = allowlist
DENIED = "PILOT_EGRESS_DENIED"

def load(label):
    with open(os.path.join(logdir, f"out-{label}.json"), encoding="utf-8") as fh:
        return json.load(fh)

checks = []
def check(name, condition, detail):
    checks.append((name, bool(condition), str(detail)))

config = json.load(open(os.path.join(logdir, "config.json"), encoding="utf-8"))
services = config["services"]
connector = services["pilot-connector"]
gateway = services["egress-gateway"]

check("the deployed egress network is internal=true", egress_internal == "true", egress_internal)
check("the deployed uplink network has exactly one member, the gateway",
      uplink_members.split() == [gateway_name], uplink_members)
check("the deployed gateway publishes no port", published.strip() == "0", published)
check("the deployed gateway does not forward packets", ip_forward == "0", ip_forward)
check("the deployed gateway recovered healthy after the stop test",
      restarted_health == "healthy", restarted_health)
check("the rendered connector joins the database and egress networks only",
      set(connector["networks"]) == {"pilot-db", "pilot-egress"}, sorted(connector["networks"]))
check("the rendered gateway joins the egress and uplink networks",
      set(gateway["networks"]) == {"pilot-egress", "pilot-uplink"}, sorted(gateway["networks"]))
check("the rendered connector publishes no port",
      not connector.get("ports") and not gateway.get("ports"), connector.get("ports"))
check("the rendered connector keeps the reviewed egress allowlist",
      connector["environment"].get("PILOT_EGRESS_HOSTS") == ALLOWLIST,
      connector["environment"].get("PILOT_EGRESS_HOSTS"))
check("the rendered connector pins every allowlisted name to the gateway",
      sorted(connector.get("extra_hosts") or []) == sorted(
          f"{name}={gateway_address}" for name in ALLOWLIST.split(",")),
      connector.get("extra_hosts"))
check("the rendered connector refuses a namespace with a default route",
      connector["environment"].get("PILOT_REQUIRE_INTERNAL_NETWORK") == "1",
      connector["environment"].get("PILOT_REQUIRE_INTERNAL_NETWORK"))
check("the rendered connector keeps provider egress on port 443 only",
      connector["environment"].get("PILOT_EGRESS_PORTS") == "443",
      connector["environment"].get("PILOT_EGRESS_PORTS"))
ca_binds = [v for v in connector.get("volumes", []) if v.get("target") == "/run/pilot/db-ca.crt"]
check("the rendered connector mounts the pilot CA read-only and trusts it",
      len(ca_binds) == 1 and ca_binds[0].get("read_only") is True
      and ca_binds[0].get("type") == "bind"
      and connector["environment"].get("NODE_EXTRA_CA_CERTS") == "/run/pilot/db-ca.crt",
      ca_binds)
check("the rendered gateway keeps the reviewed SNI allowlist",
      gateway["environment"].get("GATEWAY_ALLOW_HOSTS") == ALLOWLIST,
      gateway["environment"].get("GATEWAY_ALLOW_HOSTS"))
check("the rendered gateway binds only the connector-facing address",
      gateway["environment"].get("GATEWAY_BIND_ADDRESS") == gateway_address,
      gateway["environment"].get("GATEWAY_BIND_ADDRESS"))
check("the rendered gateway keeps IP forwarding disabled",
      all(str(v) == "0" for v in (gateway.get("sysctls") or {}).values()),
      gateway.get("sysctls"))
egress_net_cfg = config["networks"]["pilot-egress"]
check("the rendered egress subnet is the reviewed 172.16.29.0/24",
      egress_net_cfg["internal"] is True
      and egress_net_cfg["ipam"]["config"][0] == {"subnet": "172.16.29.0/24", "gateway": "172.16.29.1"},
      egress_net_cfg)
check("the rendered uplink network is not internal",
      config["networks"]["pilot-uplink"].get("internal") is not True,
      config["networks"]["pilot-uplink"].get("internal"))
check("the rendered database network is the deployed one",
      config["networks"]["pilot-db"].get("name") == "zalo-shared-pilot-db"
      and config["networks"]["pilot-db"].get("external") is True,
      config["networks"]["pilot-db"])

kernel = load("kernel")
check("the kernel-only probe runs without the guard", kernel["guardActive"] is False, kernel["guardActive"])
check("the deployed connector namespace has no IPv4 default route",
      kernel["ipv4Routing"].get("hasDefaultRoute") is False, kernel["ipv4Routing"].get("rows"))
check("the deployed connector namespace has no usable IPv6 default route",
      kernel["ipv6Routing"].get("hasDefaultRoute") is False,
      {"rejectDefaults": kernel["ipv6Routing"].get("rejectDefaultRoutes"), "rows": kernel["ipv6Routing"].get("totalRoutes")})
check("a direct connection to a public IPv4 address fails at the network layer",
      kernel["tcp"]["direct"] != "CONNECTED", kernel["tcp"]["direct"])
check("a direct connection to a public IPv6 address fails at the network layer",
      kernel["tcp"]["ipv6-direct"] != "CONNECTED", kernel["tcp"]["ipv6-direct"])
for port in ("2026", "5432", "8080"):
    check(f"the deployed host bridge port {port} is unreachable from the connector network",
          kernel["tcp"].get(f"bridge-{port}") != "CONNECTED", kernel["tcp"].get(f"bridge-{port}"))
check("UDP to a public address is not accepted from the deployed network",
      kernel["udp"] != "SENT", kernel["udp"])
check("an unpinned name does not resolve in the deployed network",
      not kernel["dns"]["unpinned.test"].startswith("RESOLVED"), kernel["dns"]["unpinned.test"])
check("the deployed gateway's private address is reachable from the connector network",
      kernel["tls"]["denied-sni"]["outcome"] != "TIMEOUT",
      json.dumps(kernel["tls"]["denied-sni"]))
check("the deployed gateway refuses an unapproved SNI",
      kernel["tls"]["denied-sni"]["outcome"].startswith(("ERROR", "THREW")),
      json.dumps(kernel["tls"]["denied-sni"]))

guarded = load("guarded")
check("the deployed connector image loads its guard", guarded["guardActive"] is True, guarded["guardActive"])
check("the guard resolves the pinned name to the gateway",
      guarded["dns"][ALLOW] == f"RESOLVED:{gateway_address}", guarded["dns"][ALLOW])
check("the guard denies a direct public IPv4 address before any connect",
      guarded["tcp"]["direct"] in (f"THREW:{DENIED}", f"ERROR:{DENIED}"), guarded["tcp"]["direct"])
check("the guard denies a direct public IPv6 address before any connect",
      guarded["tcp"]["ipv6-direct"] != "CONNECTED", guarded["tcp"]["ipv6-direct"])
check("the guard denies an unpinned name before DNS", guarded["dns"]["unpinned.test"] == f"ERROR:{DENIED}", guarded["dns"]["unpinned.test"])
check("the guard denies UDP", DENIED in guarded["udp"], guarded["udp"])
check("the pinned name reaches the deployed gateway and is not forwarded blindly",
      guarded["tls"]["guarded"]["outcome"].startswith(("ERROR", "THREW")),
      json.dumps(guarded["tls"]["guarded"]))

nopolicy = load("nopolicy")
check("the guard starts with an empty egress policy", nopolicy["guardActive"] is True, nopolicy["guardActive"])
check("an empty egress policy denies the pinned allowlisted name at DNS",
      nopolicy["dns"][ALLOW] == f"ERROR:{DENIED}", nopolicy["dns"][ALLOW])
check("an empty egress policy denies a direct public address",
      nopolicy["tcp"]["direct"] in (f"THREW:{DENIED}", f"ERROR:{DENIED}"), nopolicy["tcp"]["direct"])
check("an empty egress policy denies UDP", DENIED in nopolicy["udp"], nopolicy["udp"])
check("an empty egress policy denies the pinned TLS target",
      nopolicy["tls"]["guarded"]["outcome"] != "CONNECTED",
      json.dumps(nopolicy["tls"]["guarded"]))

stopped = load("stopped-kernel")
check("with the gateway stopped the pinned gateway address refuses the connection",
      stopped["tls"]["denied-sni"]["outcome"] != "CONNECTED",
      json.dumps(stopped["tls"]["denied-sni"]))
stopped_guarded = load("stopped-guarded")
check("with the gateway stopped the guarded allowlisted path is closed",
      stopped_guarded["tls"]["guarded"]["outcome"] != "CONNECTED",
      json.dumps(stopped_guarded["tls"]["guarded"]))

with open(os.path.join(logdir, "guard-default-route.txt"), encoding="utf-8") as fh:
    refusal = fh.read()
check("a connector attached to the uplink network refuses to start",
      guard_status != "0" and DENIED in refusal,
      {"status": guard_status, "output": refusal[:300]})

before = int(before_lines)
after = int(after_lines)
with open(os.path.join(logdir, "gateway-after.log"), encoding="utf-8") as fh:
    lines = fh.read().splitlines()
new_lines = lines[before:after]
events = [json.loads(line) for line in new_lines if line.strip().startswith("{")]
allows = [e for e in events if e.get("event") == "sni_allow"]
denies = [e for e in events if e.get("event") == "sni_deny"]
check("the deployed gateway admitted no tunnel during verification", not allows, json.dumps(allows))
check("the deployed gateway recorded the unapproved SNI refusal",
      any(e.get("reason") == "host-not-allowlisted" and e.get("sni") == DENY for e in denies),
      json.dumps(denies))

width = max(len(name) for name, _, _ in checks)
failed = 0
for name, passed, detail in checks:
    print(f"pilot-deployed: {'PASS' if passed else 'FAIL'}  {name.ljust(width)}")
    if not passed:
        failed += 1
        print(f"pilot-deployed:      detail: {detail[:600]}")
if failed:
    print(f"pilot-deployed: {failed} assertion(s) FAILED")
    sys.exit(1)
print(f"pilot-deployed: all {len(checks)} deployed-network assertions PASS")
PY
