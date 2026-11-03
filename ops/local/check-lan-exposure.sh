#!/usr/bin/env bash
# LAN exposure check for the running application stack.
#
# The pilot resources must not be reachable from any device other than this
# host. That is asserted here from OS state (bind address and network
# attachment), and then exercised from a container whose packets leave the host
# with a non-loopback source, which is the closest thing to an independent
# device that can be done without a second physical host.
#
# What this cannot prove is stated plainly in the output: only a device on the
# same LAN can exercise the Windows firewall and the mirrored-WSL interface
# path. The bind scope shown here is what makes the pilot resources independent
# of that answer.
#
# Read-only with respect to host configuration: it inspects Docker state, starts
# one short-lived probe container on the default bridge and removes it.
set -euo pipefail
cd "$(dirname "$0")/../.."

APP_CONTAINER=${APP_CONTAINER:-zalo-shared-g2-app-1}
DB_CONTAINER=${DB_CONTAINER:-zalo-shared-g2-postgres-1}
PRIVATE_NET=${PRIVATE_NET:-zalo-shared-g2_private}
PILOT_CONNECTOR_CONTAINER=${PILOT_CONNECTOR_CONTAINER:-zalo-shared-pilot-pilot-connector-1}
PROBE_IMAGE=${PROBE_IMAGE:-zalo-shared-connector:g5-8d40c0f9}

# Exclude loopback and Docker's default pools so a container bridge address is
# never mistaken for the LAN address of this host.
lan_ip=$(hostname -I 2>/dev/null | tr ' ' '\n' \
  | grep -E '^(10\.|192\.168\.|172\.)' \
  | grep -vE '^172\.(1[6-9]|2[0-9]|3[01])\.' \
  | grep -vE '^127\.' | head -n1)
[ -n "$lan_ip" ] || { echo "FAIL: no LAN-facing RFC1918 address found for this host" >&2; exit 2; }
# The host-side listener table is the direct proof that the app is loopback-only.
host_listen=$(ss -ltnH 2>/dev/null | awk '$4 ~ /:3100$/ {print $4}' | paste -sd, -)

for container in "$APP_CONTAINER" "$DB_CONTAINER"; do
  docker inspect "$container" >/dev/null 2>&1 || {
    echo "FAIL: $container is not present; start the application stack first" >&2
    exit 2
  }
done
docker image inspect "$PROBE_IMAGE" >/dev/null 2>&1 || {
  echo "FAIL: probe image $PROBE_IMAGE not found" >&2
  exit 2
}

app_ports=$(docker port "$APP_CONTAINER" 2>/dev/null | tr '\n' ' ' | sed 's/ $//')
db_ports=$(docker port "$DB_CONTAINER" 2>/dev/null | tr '\n' ' ' | sed 's/ $//')
net_internal=$(docker network inspect "$PRIVATE_NET" --format '{{.Internal}}')
net_members=$(docker network inspect "$PRIVATE_NET" --format '{{range .Containers}}{{.Name}} {{end}}' | xargs)
db_ip=$(docker inspect "$DB_CONTAINER" --format "{{(index .NetworkSettings.Networks \"$PRIVATE_NET\").IPAddress}}")
app_network_mode=$(docker inspect "$APP_CONTAINER" --format '{{.HostConfig.NetworkMode}}')
db_network_mode=$(docker inspect "$DB_CONTAINER" --format '{{.HostConfig.NetworkMode}}')

report=$(docker run --rm --network bridge --entrypoint /nodejs/bin/node \
  -e NODE_OPTIONS= \
  -e "LAN_IP=$lan_ip" -e "DB_IP=$db_ip" \
  "$PROBE_IMAGE" -e '
const net = require("node:net");
const dial = (host, port) => new Promise((resolve) => {
  const socket = net.connect({ host, port });
  const timer = setTimeout(() => { socket.destroy(); resolve("TIMEOUT"); }, 3000);
  socket.once("connect", () => { clearTimeout(timer); socket.destroy(); resolve("CONNECTED"); });
  socket.once("error", (error) => { clearTimeout(timer); resolve(`ERROR:${error.code || error.message}`); });
});
(async () => {
  const out = {};
  out.lanApp = await dial(process.env.LAN_IP, 3100);
  out.database = await dial(process.env.DB_IP, 5432);
  process.stdout.write(JSON.stringify(out));
})();
')

python3 - "$app_ports" "$db_ports" "$net_internal" "$net_members" \
  "$app_network_mode" "$db_network_mode" "$lan_ip" "$db_ip" "$report" \
  "$APP_CONTAINER" "$DB_CONTAINER" "$host_listen" "$PILOT_CONNECTOR_CONTAINER" <<'PY'
import json, sys

(app_ports, db_ports, net_internal, net_members, app_mode, db_mode, lan_ip, db_ip,
 report, app_name, db_name, host_listen, connector_name) = sys.argv[1:14]
probe = json.loads(report)

checks = []
def check(name, condition, detail):
    checks.append((name, bool(condition), str(detail)))

check("the application publishes exactly one port, on loopback only",
      app_ports == "3100/tcp -> 127.0.0.1:3100", app_ports)
check("PostgreSQL publishes no host port", db_ports == "", db_ports or "<none>")
check("the application is not in host networking",
      app_mode not in ("host", "container"), app_mode)
check("PostgreSQL is not in host networking",
      db_mode not in ("host", "container"), db_mode)
check("the private network is internal=true", net_internal == "true", net_internal)
members = set(net_members.split())
expected_members = {app_name, db_name}
connector_present = connector_name in members
if connector_present:
    expected_members.add(connector_name)
check(
    "the private network holds only the application, its database and the pilot connector"
    if connector_present
    else "the private network holds only the application and its database (connector not running)",
    members == expected_members,
    net_members,
)
check("the host listener table shows the application only on 127.0.0.1:3100",
      host_listen == "127.0.0.1:3100", host_listen or "<none>")
check("the database has an address on the private network",
      db_ip.startswith(("10.", "172.", "192.168.")), db_ip or "<none>")
check(f"the application is not reachable at the LAN address ({lan_ip}:3100)",
      probe["lanApp"] != "CONNECTED", probe["lanApp"])
check(f"the database is not reachable from another bridge network ({db_ip}:5432)",
      probe["database"] != "CONNECTED", probe["database"])

width = max(len(name) for name, _, _ in checks)
failed = 0
for name, passed, detail in checks:
    print(f"lan: {'PASS' if passed else 'FAIL'}  {name.ljust(width)}")
    if not passed:
        failed += 1
        print(f"lan:      detail: {detail[:400]}")
print("lan: authorized host-local access is unchanged: the app still binds 127.0.0.1:3100")
print("lan: an independent device on the LAN is still required to exercise the Windows firewall")
print("lan: and the mirrored-WSL interface path; bind scope, not that firewall, is what")
print("lan: keeps these ports off the LAN.")
if failed:
    print(f"lan: {failed} assertion(s) FAILED")
    sys.exit(1)
print(f"lan: all {len(checks)} assertions PASS")
PY
