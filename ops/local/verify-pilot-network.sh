#!/usr/bin/env bash
# Container-level proof of the pilot network boundary.
#
# ops/local/check-pilot-network.sh proves the rendered compose topology is the
# intended one. This script proves the topology actually behaves as a boundary
# on a real Docker network, from inside a container built from the reviewed
# connector image:
#
#   * the kernel, not the Node guard, refuses every route out. The first probe
#     runs with NODE_OPTIONS cleared and a plain entrypoint, so the guard is
#     provably absent and only the network namespace is left.
#   * the guard, when present, refuses the same attempts earlier.
#   * the egress gateway refuses every SNI it was not given, refuses a name it
#     cannot resolve instead of forwarding blindly, and is the only container
#     attached to the uplink network.
#
# The allow path itself (real TLS spliced to a synthetic provider) is proven
# separately by ops/local/verify-egress-allowpath.sh, because the gateway
# requires its upstream to be a public address and spoofing one on a Docker
# network would modify host routing.
#
# Nothing here contacts a provider or any real host: the only destinations are
# a reserved .test name, the gateway's private address and public IP literals
# dialled from a network that has no route to them.
set -euo pipefail
cd "$(dirname "$0")/../.."
repo=$(pwd)

IMAGE=${PILOT_CONNECTOR_IMAGE:-zalo-shared-connector:g5-8d40c0f9}
GATEWAY_IMAGE=${PILOT_EGRESS_GATEWAY_IMAGE:-zalo-shared-egress-gateway:verify}
ALLOW_NAME=pilot-target.test
DENY_NAME=denied-target.test
GATEWAY_ADDRESS=${PILOT_VERIFY_GATEWAY:-172.16.29.10}
EGRESS_SUBNET=${PILOT_VERIFY_SUBNET:-172.16.29.0/24}
HOST_BRIDGE=${GATEWAY_ADDRESS%.*}.1
PUBLIC_CANARY=1.1.1.1
PUBLIC_UDP=8.8.8.8

suffix=$$
egress_net=pilot-verify-egress-$suffix
uplink_net=pilot-verify-uplink-$suffix
gateway=pilot-verify-gateway-$suffix
logdir=$(mktemp -d)

cleanup() {
  docker rm -f "$gateway" >/dev/null 2>&1 || true
  docker network rm "$egress_net" "$uplink_net" >/dev/null 2>&1 || true
  rm -rf "$logdir"
}
trap cleanup EXIT

for cmd in docker python3; do
  command -v "$cmd" >/dev/null || { echo "FAIL: $cmd is required" >&2; exit 2; }
done
docker image inspect "$IMAGE" >/dev/null 2>&1 || { echo "FAIL: $IMAGE not found (build the connector image first)" >&2; exit 2; }
docker image inspect "$GATEWAY_IMAGE" >/dev/null 2>&1 || { echo "FAIL: $GATEWAY_IMAGE not found (build ops/Dockerfile.gateway first)" >&2; exit 2; }

share() {
  case "$1" in
    /*) printf '%s' "$1" ;;
    *) printf '%s' "$repo/$1" ;;
  esac
}

# ---------------------------------------------------------------- topology
# Same subnet as the reviewed allowlist, so this also proves it can be created
# without colliding with an existing network.
docker network create --driver bridge --internal \
  --subnet "$EGRESS_SUBNET" --gateway "$HOST_BRIDGE" "$egress_net" >/dev/null
docker network create --driver bridge "$uplink_net" >/dev/null

docker run -d --name "$gateway" \
  --network "$egress_net" --ip "$GATEWAY_ADDRESS" \
  --init --restart no --read-only \
  --tmpfs /tmp:rw,nosuid,size=8m \
  --cap-drop ALL --cap-add NET_BIND_SERVICE \
  --security-opt no-new-privileges:true \
  --sysctl net.ipv4.ip_forward=0 \
  --sysctl net.ipv6.conf.all.forwarding=0 \
  --user 65532:65532 \
  -e GATEWAY_BIND_ADDRESS="$GATEWAY_ADDRESS" \
  -e GATEWAY_PORT=443 \
  -e GATEWAY_UPSTREAM_PORT=443 \
  -e GATEWAY_ALLOW_HOSTS="$ALLOW_NAME" \
  -e GATEWAY_MAX_TUNNELS=8 \
  -e GATEWAY_HANDSHAKE_TIMEOUT_MS=3000 \
  -e GATEWAY_IDLE_TIMEOUT_MS=15000 \
  "$GATEWAY_IMAGE" >/dev/null
docker network connect "$uplink_net" "$gateway"

for _ in $(seq 1 100); do
  docker logs "$gateway" 2>&1 | grep -q '"event":"startup"' && break
  sleep 0.1
done
docker logs "$gateway" >"$logdir/gateway.log" 2>&1
grep -q '"event":"startup"' "$logdir/gateway.log" || {
  echo "FAIL: gateway did not start" >&2
  cat "$logdir/gateway.log" >&2
  exit 1
}

TLS_DENIED="[{\"label\":\"denied-sni\",\"host\":\"$GATEWAY_ADDRESS\",\"port\":443,\"servername\":\"$DENY_NAME\"}]"
TLS_ALLOWED="[{\"label\":\"allowed-sni\",\"host\":\"$GATEWAY_ADDRESS\",\"port\":443,\"servername\":\"$ALLOW_NAME\"}]"
TLS_GUARDED="[{\"label\":\"guarded\",\"host\":\"$ALLOW_NAME\",\"port\":443,\"servername\":\"$ALLOW_NAME\"}]"
TCP_DIRECT="[{\"label\":\"direct\",\"host\":\"$PUBLIC_CANARY\",\"port\":443},{\"label\":\"bridge-2026\",\"host\":\"$HOST_BRIDGE\",\"port\":2026},{\"label\":\"bridge-5432\",\"host\":\"$HOST_BRIDGE\",\"port\":5432},{\"label\":\"bridge-8080\",\"host\":\"$HOST_BRIDGE\",\"port\":8080}]"
UDP_PUBLIC="{\"label\":\"public-udp\",\"host\":\"$PUBLIC_UDP\",\"port\":53}"
DNS_NAMES="[\"$ALLOW_NAME\",\"unpinned.test\"]"

probe() {
  local out=$1; shift
  docker run --rm --network "$egress_net" --user 65532:65532 \
    -v "$(share ops/local/harness):/harness:ro" \
    "$@" >"$logdir/out-$out.json" 2>"$logdir/err-$out.txt" || true
  if [ ! -s "$logdir/out-$out.json" ]; then
    echo "FAIL: probe $out produced no report" >&2
    tail -20 "$logdir/err-$out.txt" >&2 || true
    exit 1
  fi
}

# -------------------------------------------------- 1. kernel boundary only
# Plain entrypoint and an empty NODE_OPTIONS, so the image's preloaded guard is
# absent. Anything still refused here is refused by the network namespace.
probe kernel-only \
  --entrypoint /nodejs/bin/node \
  -e NODE_OPTIONS= \
  -e HARNESS_TIMEOUT_MS=4000 \
  -e "HARNESS_DNS_NAMES=$DNS_NAMES" \
  -e "HARNESS_TCP_TARGETS=$TCP_DIRECT" \
  -e "HARNESS_UDP_TARGET=$UDP_PUBLIC" \
  -e "HARNESS_TLS_TARGETS=$TLS_DENIED" \
  "$IMAGE" /harness/probe.cjs

# ------------------------------------------- 2. connector guard on top of it
# The working-tree guard and its shared address policy are mounted over the
# image copies, so this tests the files under review rather than the image's
# older build. `--add-host` is the compose `extra_hosts` pin.
probe guarded \
  -v "$(share ops/pilot-egress-guard.cjs):/app/egress-guard.cjs:ro" \
  -v "$(share ops/egress-address-policy.cjs):/app/egress-address-policy.cjs:ro" \
  --add-host "$ALLOW_NAME:$GATEWAY_ADDRESS" \
  -e NODE_OPTIONS=--require=/app/egress-guard.cjs \
  -e PILOT_EGRESS_HOSTS="$ALLOW_NAME" \
  -e PILOT_EGRESS_PORTS=443 \
  -e PILOT_EGRESS_GATEWAY="$GATEWAY_ADDRESS" \
  -e PILOT_REQUIRE_INTERNAL_NETWORK=1 \
  -e HARNESS_TIMEOUT_MS=4000 \
  -e "HARNESS_DNS_NAMES=$DNS_NAMES" \
  -e "HARNESS_TCP_TARGETS=$TCP_DIRECT" \
  -e "HARNESS_UDP_TARGET=$UDP_PUBLIC" \
  -e "HARNESS_TLS_TARGETS=$TLS_GUARDED" \
  "$IMAGE" /harness/probe.cjs

# The image now refuses a namespace with a usable default route, because the
# external database network is operator-supplied. Run the working-tree guard on
# the non-internal uplink fixture: it must abort before the application starts.
guard_status=0
docker run --rm --network "$uplink_net" --user 65532:65532 \
  -v "$(share ops/pilot-egress-guard.cjs):/app/egress-guard.cjs:ro" \
  -v "$(share ops/egress-address-policy.cjs):/app/egress-address-policy.cjs:ro" \
  --entrypoint /nodejs/bin/node \
  -e NODE_OPTIONS=--require=/app/egress-guard.cjs \
  -e PILOT_REQUIRE_INTERNAL_NETWORK=1 \
  "$IMAGE" -e 'process.stdout.write("guard-allowed-default-route")' \
  >"$logdir/guard-default-route.txt" 2>&1 || guard_status=$?

# ------------------------------------------------------- 3. gateway decisions
# The guarded probe dialled the allowlisted name, which the pin sends to the
# gateway. The gateway has no pin of its own and no public resolver for a
# reserved name, so it must refuse rather than forward.
sleep 0.5
docker logs "$gateway" >"$logdir/gateway.log" 2>&1

egress_internal=$(docker network inspect "$egress_net" --format '{{.Internal}}')
uplink_members=$(docker network inspect "$uplink_net" --format '{{range .Containers}}{{.Name}} {{end}}' | xargs)
published=$(docker port "$gateway" 2>/dev/null | wc -l)
ip_forward=$(docker exec "$gateway" /nodejs/bin/node -e 'process.stdout.write(require("node:fs").readFileSync("/proc/sys/net/ipv4/ip_forward","utf8").trim())')

python3 - "$logdir" "$egress_internal" "$uplink_members" "$published" "$ip_forward" "$gateway" "$guard_status" "$GATEWAY_ADDRESS" <<'PY'
import json, os, sys

logdir, egress_internal, uplink_members, published, ip_forward, gateway_name, guard_status, GATEWAY = sys.argv[1:9]
ALLOW, DENY = "pilot-target.test", "denied-target.test"
DENIED = "PILOT_EGRESS_DENIED"

def load(label):
    with open(os.path.join(logdir, f"out-{label}.json"), encoding="utf-8") as fh:
        return json.load(fh)

checks = []
def check(name, condition, detail):
    checks.append((name, bool(condition), str(detail)))

kernel = load("kernel-only")
check("the kernel-only probe runs without the guard", kernel["guardActive"] is False, kernel["guardActive"])
check("the connector namespace has no IPv4 default route",
      kernel["ipv4Routing"].get("hasDefaultRoute") is False, kernel["ipv4Routing"].get("rows"))
check("the connector namespace has no usable IPv6 default route",
      kernel["ipv6Routing"].get("hasDefaultRoute") is False,
      {"rejectDefaults": kernel["ipv6Routing"].get("rejectDefaultRoutes"), "rows": kernel["ipv6Routing"].get("totalRoutes")})
check("a direct connection to a public address fails at the network layer",
      kernel["tcp"]["direct"] != "CONNECTED", kernel["tcp"]["direct"])
for port in ("2026", "5432", "8080"):
    check(f"the host bridge port {port} is not reachable from the internal network",
          kernel["tcp"].get(f"bridge-{port}") != "CONNECTED", kernel["tcp"].get(f"bridge-{port}"))
check("UDP to a public address is not accepted",
      kernel["udp"] != "SENT", kernel["udp"])
check("an unpinned name does not resolve",
      not kernel["dns"]["unpinned.test"].startswith("RESOLVED"), kernel["dns"]["unpinned.test"])
check("the gateway's private address is reachable from the connector network",
      kernel["tls"]["denied-sni"]["outcome"] != "TIMEOUT",
      json.dumps(kernel["tls"]["denied-sni"]))
check("the gateway refuses a non-allowlisted SNI",
      kernel["tls"]["denied-sni"]["outcome"].startswith(("ERROR", "THREW")),
      json.dumps(kernel["tls"]["denied-sni"]))

guarded = load("guarded")
check("the guarded probe loads the connector guard", guarded["guardActive"] is True, guarded["guardActive"])
check("the guard resolves the allowlisted name to the pinned gateway",
      guarded["dns"][ALLOW] == f"RESOLVED:{GATEWAY}", guarded["dns"][ALLOW])
check("the guard denies a direct public address before any connect",
      guarded["tcp"]["direct"] in (f"THREW:{DENIED}", f"ERROR:{DENIED}"), guarded["tcp"]["direct"])
check("the guard denies an unpinned name before DNS",
      guarded["dns"]["unpinned.test"] == f"ERROR:{DENIED}", guarded["dns"]["unpinned.test"])
check("the guard denies UDP", DENIED in guarded["udp"], guarded["udp"])
check("the pinned name reaches the gateway and is not forwarded blindly",
      guarded["tls"]["guarded"]["outcome"].startswith(("ERROR", "THREW")),
      json.dumps(guarded["tls"]["guarded"]))

with open(os.path.join(logdir, "guard-default-route.txt"), encoding="utf-8") as fh:
    refusal = fh.read()
check("a namespace with a default route is refused before the connector starts",
      guard_status != "0" and DENIED in refusal,
      {"status": guard_status, "output": refusal[:300]})

with open(os.path.join(logdir, "gateway.log"), encoding="utf-8") as fh:
    events = [json.loads(line) for line in fh if line.strip().startswith("{")]
allows = [e for e in events if e["event"] == "sni_allow"]
denies = [e for e in events if e["event"] == "sni_deny"]
check("the gateway admitted no tunnel in this verification",
      not allows, json.dumps(allows))
check("the gateway refused the non-allowlisted SNI and recorded its name",
      any(e.get("reason") == "host-not-allowlisted" and e.get("sni") == DENY for e in denies),
      json.dumps(denies))
check("the gateway refused an allowlisted name it could not resolve instead of forwarding",
      any(e.get("reason") in ("unresolvable", "resolution-failed") and e.get("sni") == ALLOW for e in denies),
      json.dumps(denies))

check("the verification egress fixture is internal=true", egress_internal == "true", egress_internal)
check("the verification uplink fixture has exactly one member, the gateway",
      uplink_members.split() == [gateway_name], uplink_members)
check("the verification gateway was started with no published port", published.strip() == "0", published)
check("the gateway does not forward packets between its networks",
      ip_forward == "0", ip_forward)

width = max(len(name) for name, _, _ in checks)
failed = 0
for name, passed, detail in checks:
    print(f"pilot-net: {'PASS' if passed else 'FAIL'}  {name.ljust(width)}")
    if not passed:
        failed += 1
        print(f"pilot-net:      detail: {detail[:600]}")
if failed:
    print(f"pilot-net: {failed} assertion(s) FAILED")
    sys.exit(1)
print(f"pilot-net: all {len(checks)} container-level assertions PASS")
PY
