#!/usr/bin/env bash
# Assert the compose topology keeps inbound exposure loopback-only and the
# database off the edge network. Prints assertions, never the rendered config.
set -euo pipefail
env_file=${1:?Usage: check-compose-topology.sh ENV_FILE}
cd "$(dirname "$0")/../.."

cfg=$(docker compose --profile maintenance --profile dispatch --env-file "$env_file" -f ops/compose.yaml config --format json)
python3 -c '
import json, sys
d = json.load(sys.stdin)
svc = d["services"]
ports = svc["app"].get("ports", [])
assert len(ports) == 1, ports
p = ports[0]
assert p["host_ip"] == "127.0.0.1" and str(p["published"]) == "3100" and p["target"] == 3100, p
for name in ("postgres", "migrate", "worker"):
    assert not svc[name].get("ports"), name
assert d["networks"]["private"]["internal"] is True
assert not d["networks"].get("edge", {}).get("internal", False)
assert set(svc["app"]["networks"]) == {"private", "edge"}
assert set(svc["postgres"]["networks"]) == {"private"}
print("compose: app publishes 127.0.0.1:3100 only; postgres/migrate/worker publish nothing")
print("compose: private network internal=true; edge non-internal (required to publish)")
print("compose: app joins private+edge; postgres stays private-only")
' <<<"$cfg"

container=zalo-shared-g2-app-1
actual=$(docker port "$container" 2>/dev/null || true)
[ "$actual" = "3100/tcp -> 127.0.0.1:3100" ] || { echo "unexpected running port mapping: $actual" >&2; exit 1; }
echo "running: $container $actual"
echo "note: outbound egress from the app/edge network remains host-policy controlled"
