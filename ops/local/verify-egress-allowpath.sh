#!/usr/bin/env bash
# Offline proof of the egress gateway's admit path and of the connector guard's
# gateway pin, using real TLS through the real gateway code.
#
# Everything runs inside an unprivileged user+mount+network namespace that
# contains only loopback. There is no default route in that namespace, so the
# harness cannot reach the internet or a provider even if the code under test
# were wrong. A synthetic provider is bound to 93.184.216.20 on loopback to
# supply the public address the gateway requires; nothing outside the namespace
# is modified and no host route is added.
#
# Two mount namespaces inside the one network namespace reproduce the two views
# that compose creates in production:
#   gateway view  /etc/hosts: pilot-target.test -> 93.184.216.20  (the provider)
#   client view   /etc/hosts: pilot-target.test -> 127.0.0.2      (the gateway)
# The client view is what `extra_hosts` gives the connector, and the gateway view
# is what the gateway resolves for its own upstream.
#
# The inner run executes staged copies of the code under test. Inside an
# unprivileged user namespace only one uid is mapped, so a checkout under another
# account's home — which is how CI reaches this script, through sudo — is not
# traversable there. Staging makes the harness independent of where the checkout
# lives; the digests printed below prove the executed files are the repository's
# own bytes.
set -euo pipefail
export PATH="${PATH}"

PROVIDER_ADDRESS=93.184.216.20
GATEWAY_ADDRESS=127.0.0.2
WRONG_PIN_ADDRESS=127.0.0.9
ALLOW_NAME=pilot-target.test
DENY_NAME=denied-target.test

# Exit 77 means "this host cannot run the harness", which CI records as SKIP.
# Exit 2 means the harness ran but its own setup is broken, which must fail.
node_bin=$(command -v node) || { echo "SKIP: node is required" >&2; exit 77; }
command -v openssl >/dev/null || { echo "SKIP: openssl is required" >&2; exit 77; }
command -v unshare >/dev/null || { echo "SKIP: unshare is required" >&2; exit 77; }

# The outer run creates the fixture directory and owns its removal. The inner
# run re-enters the staged copy of this script inside the namespace and must
# reuse the same directory, which is how the certificates, host files and staged
# sources reach it.
if [ "${HARNESS_IN_NETNS:-0}" = "1" ]; then
  dir=${HARNESS_DIR:?HARNESS_DIR is required inside the namespace}
  src=${HARNESS_SRC:?HARNESS_SRC is required inside the namespace}
  [ -f "$dir/ca.crt" ] || { echo "FAIL: harness fixtures missing from $dir" >&2; exit 2; }
  [ -r "$src/ops/local/harness/provider.cjs" ] || {
    echo "FAIL: staged harness sources are unreadable at $src" >&2
    exit 2
  }
else
  cd "$(dirname "$0")/../.."
  repo=$(pwd)
  dir=$(mktemp -d)
  trap 'rm -rf "$dir"' EXIT
fi

if [ "${HARNESS_IN_NETNS:-0}" != "1" ]; then
  # ---------- outer: build the fixtures, then re-enter inside the namespace ----------
  "$node_bin" --version >/dev/null
  if ! unshare -n -m -r true 2>/dev/null; then
    echo "SKIP: unprivileged user+mount+net namespaces are unavailable" >&2
    echo "SKIP: the allow path cannot be proven offline on this host" >&2
    exit 77
  fi

  openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
    -keyout "$dir/ca.key" -out "$dir/ca.crt" \
    -subj "/CN=Boundary Harness CA" \
    -addext "basicConstraints=critical,CA:TRUE" 2>/dev/null
  openssl req -newkey rsa:2048 -nodes \
    -keyout "$dir/provider.key" -out "$dir/provider.csr" \
    -subj "/CN=$ALLOW_NAME" 2>/dev/null
  printf 'subjectAltName=DNS:%s\nbasicConstraints=CA:FALSE\n' "$ALLOW_NAME" > "$dir/provider.ext"
  openssl x509 -req -in "$dir/provider.csr" -CA "$dir/ca.crt" -CAkey "$dir/ca.key" \
    -CAcreateserial -out "$dir/provider.crt" -days 1 \
    -extfile "$dir/provider.ext" 2>/dev/null
  # Computed independently of the provider process, so the fingerprint check
  # below is not circular.
  expected=$(openssl x509 -in "$dir/provider.crt" -noout -fingerprint -sha256 | sed 's/.*=//')

  printf '127.0.0.1 localhost\n%s %s\n' "$PROVIDER_ADDRESS" "$ALLOW_NAME" > "$dir/hosts-gateway"
  printf '127.0.0.1 localhost\n%s %s\n' "$GATEWAY_ADDRESS" "$ALLOW_NAME" > "$dir/hosts-client"

  # Stage the code under test and this script inside the fixture directory,
  # preserving the repository layout so relative requires still resolve, and
  # stage the one runtime dependency the address policy loads.
  : > "$dir/src.sha256"
  for rel in ops/egress-gateway.cjs ops/egress-address-policy.cjs \
             ops/pilot-egress-guard.cjs ops/local/harness/probe.cjs \
             ops/local/harness/provider.cjs; do
    mkdir -p "$dir/src/$(dirname "$rel")"
    cp "$repo/$rel" "$dir/src/$rel"
    chmod 0444 "$dir/src/$rel"
    ( cd "$repo" && sha256sum "$rel" | sed "s|$rel|src/$rel|" ) >> "$dir/src.sha256"
  done
  mkdir -p "$dir/src/node_modules"
  cp -R "$repo/node_modules/ipaddr.js" "$dir/src/node_modules/ipaddr.js"
  cp "$repo/ops/local/verify-egress-allowpath.sh" "$dir/harness.sh"
  chmod 0555 "$dir/harness.sh"
  ( cd "$dir" && sha256sum -c src.sha256 )
  dependency_digest() {
    ( cd "$1" && find . -type f -print0 | sort -z | xargs -0 sha256sum ) \
      | sha256sum | cut -d' ' -f1
  }
  staged_dependency=$(dependency_digest "$dir/src/node_modules/ipaddr.js")
  installed_dependency=$(dependency_digest "$repo/node_modules/ipaddr.js")
  if [ "$staged_dependency" != "$installed_dependency" ]; then
    echo "FAIL: staged ipaddr.js differs from the installed dependency" >&2
    exit 2
  fi
  echo "allowpath: staged sources match the repository; ipaddr.js $staged_dependency"

  unshare -n -m -r env \
      HARNESS_IN_NETNS=1 \
      HARNESS_DIR="$dir" HARNESS_SRC="$dir/src" \
      HARNESS_EXPECTED_FINGERPRINT="$expected" PATH="$PATH" \
      bash "$dir/harness.sh"
  exit $?
fi

# ---------- inner: one loopback-only network namespace ----------
ip link set lo up
ip addr add 127.0.0.1/8 dev lo 2>/dev/null || true
ip addr add "$PROVIDER_ADDRESS/32" dev lo
mount --bind "$dir/hosts-gateway" /etc/hosts

cleanup() {
  for pid in "${pids[@]:-}"; do kill "$pid" 2>/dev/null || true; done
  umount /etc/hosts 2>/dev/null || true
}
trap cleanup EXIT
pids=()

HARNESS_CERT_DIR=$dir HARNESS_PROVIDER_BIND=$PROVIDER_ADDRESS HARNESS_PROVIDER_PORT=443 \
  "$node_bin" "$src/ops/local/harness/provider.cjs" > "$dir/provider.log" 2>&1 &
pids+=($!)

GATEWAY_BIND_ADDRESS=$GATEWAY_ADDRESS GATEWAY_PORT=443 GATEWAY_UPSTREAM_PORT=443 \
GATEWAY_ALLOW_HOSTS=$ALLOW_NAME GATEWAY_HANDSHAKE_TIMEOUT_MS=3000 \
  "$node_bin" "$src/ops/egress-gateway.cjs" > "$dir/gateway.log" 2>&1 &
pids+=($!)

for _ in $(seq 1 100); do
  grep -q '"event":"listen"' "$dir/provider.log" 2>/dev/null \
    && grep -q '"event":"startup"' "$dir/gateway.log" 2>/dev/null && break
  sleep 0.1
done
grep -q '"event":"listen"' "$dir/provider.log" || { echo "FAIL: provider did not start"; cat "$dir/provider.log"; exit 1; }
grep -q '"event":"startup"' "$dir/gateway.log" || { echo "FAIL: gateway did not start"; cat "$dir/gateway.log"; exit 1; }

# Runs the probe with the client's /etc/hosts view, in the same network
# namespace as the gateway. The guard is preloaded only for the guard cases.
run_probe() {
  local label=$1 mode=$2; shift 2
  local args=("$src/ops/local/harness/probe.cjs")
  [ "$mode" = guard ] && args=("-r" "$src/ops/pilot-egress-guard.cjs" "${args[@]}")
  unshare -m env \
    HARNESS_CA_FILE="$dir/ca.crt" \
    HARNESS_DNS_NAMES="[\"$ALLOW_NAME\",\"$DENY_NAME\"]" \
    HARNESS_TCP_TARGETS="[]" \
    HARNESS_TIMEOUT_MS=6000 \
    "$@" \
    bash -c "mount --bind '$dir/hosts-client' /etc/hosts; exec '$node_bin' $(
      for a in "${args[@]}"; do printf "'%s' " "$a"; done
    )" > "$dir/out-$label.json" 2> "$dir/err-$label.txt" || true
}

TLS_ALLOW="HARNESS_TLS_TARGETS=[{\"label\":\"allow\",\"host\":\"$ALLOW_NAME\",\"port\":443,\"servername\":\"$ALLOW_NAME\"}]"
TLS_DENY_SNI="HARNESS_TLS_TARGETS=[{\"label\":\"denied-sni\",\"host\":\"$ALLOW_NAME\",\"port\":443,\"servername\":\"$DENY_NAME\"}]"
TCP_DIRECT="HARNESS_TCP_TARGETS=[{\"label\":\"provider-direct\",\"host\":\"$PROVIDER_ADDRESS\",\"port\":443}]"

# 1. No guard: an allowlisted SNI is spliced to the synthetic provider and the
#    TLS session is intact end to end.
run_probe plain-allow plain "$TLS_ALLOW"
# 2. No guard: a non-allowlisted SNI on the same TCP destination is refused.
run_probe plain-denied-sni plain "$TLS_DENY_SNI"
# 3. No guard: reaching the provider directly, bypassing the gateway. Inside
#    this namespace that succeeds, which is why the production boundary is the
#    connector's separate internal namespace and not this harness. The Docker
#    verifier proves that half.
run_probe plain-direct plain "$TCP_DIRECT"
# 4. Guard: the pin matches the gateway address the name resolves to.
run_probe guard-pin-matches guard \
  PILOT_EGRESS_HOSTS=$ALLOW_NAME PILOT_EGRESS_PORTS=443 \
  PILOT_EGRESS_GATEWAY=$GATEWAY_ADDRESS "$TLS_ALLOW"
# 5. Guard: no pin, so the gateway's loopback address is not a valid provider
#    address and the connection is refused.
run_probe guard-pin-absent guard \
  PILOT_EGRESS_HOSTS=$ALLOW_NAME PILOT_EGRESS_PORTS=443 "$TLS_ALLOW"
# 6. Guard: a pin that does not match the resolved address.
run_probe guard-pin-mismatch guard \
  PILOT_EGRESS_HOSTS=$ALLOW_NAME PILOT_EGRESS_PORTS=443 \
  PILOT_EGRESS_GATEWAY=$WRONG_PIN_ADDRESS "$TLS_ALLOW"
# 7. Guard: a name outside PILOT_EGRESS_HOSTS, with a valid pin.
run_probe guard-host-not-allowlisted guard \
  PILOT_EGRESS_HOSTS=$ALLOW_NAME PILOT_EGRESS_PORTS=443 \
  PILOT_EGRESS_GATEWAY=$GATEWAY_ADDRESS "$TLS_DENY_SNI"
# 8. Guard: a direct connection to the provider's public address, bypassing the
#    gateway. An IP literal is never an allowlisted provider host.
run_probe guard-direct-ip guard \
  PILOT_EGRESS_HOSTS=$ALLOW_NAME PILOT_EGRESS_PORTS=443 \
  PILOT_EGRESS_GATEWAY=$GATEWAY_ADDRESS "$TCP_DIRECT"

umount /etc/hosts
for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
wait 2>/dev/null || true

# The expected fingerprint was computed by the outer run, independently of the
# provider process, and reaches this shell only through the environment.
expected=${HARNESS_EXPECTED_FINGERPRINT:?expected certificate fingerprint is required}
HARNESS_EXPECTED_FINGERPRINT="$expected" HARNESS_DIR="$dir" \
  python3 - <<'PY'
import json, os, sys

d = os.environ["HARNESS_DIR"]
expected = os.environ["HARNESS_EXPECTED_FINGERPRINT"]
ALLOW, DENY = "pilot-target.test", "denied-target.test"
GATEWAY, PROVIDER, WRONG = "127.0.0.2", "93.184.216.20", "127.0.0.9"

def load(label):
    path = os.path.join(d, f"out-{label}.json")
    with open(path, encoding="utf-8") as fh:
        text = fh.read().strip()
    if not text:
        err = open(os.path.join(d, f"err-{label}.txt"), encoding="utf-8").read()
        raise AssertionError(f"{label}: probe produced no report; stderr={err[-2000:]}")
    return json.loads(text)

checks = []
def check(name, condition, detail):
    checks.append((name, bool(condition), detail))

# Namespace containment: loopback only, no default route, so nothing here could
# have reached a real host.
report = load("plain-allow")
check("harness namespace has no IPv4 default route",
      report["ipv4Routing"]["hasDefaultRoute"] is False,
      json.dumps(report["ipv4Routing"]["rows"]))
check("harness namespace has no IPv6 default route",
      report["ipv6Routing"]["hasDefaultRoute"] is False,
      json.dumps(report["ipv6Routing"]))
check("client view resolves the allowlisted name to the gateway address",
      report["dns"][ALLOW] == f"RESOLVED:{GATEWAY}", report["dns"][ALLOW])

# 1. Allow path: real TLS, spliced, certificate intact.
allow = report["tls"]["allow"]
check("allowlisted SNI completes a TLS handshake through the gateway",
      allow["outcome"] == "CONNECTED", json.dumps(allow))
check("the gateway does not intercept TLS (peer certificate validates)",
      allow.get("authorized") is True, json.dumps(allow))
check("the peer certificate is the one generated for this run",
      allow.get("fingerprint256") == expected,
      f"observed={allow.get('fingerprint256')} expected={expected}")
check("the provider received the connection and answered",
      allow.get("data") == "SYNTHETIC-PROVIDER-OK", json.dumps(allow))
check("the probe did not run under the guard",
      report["guardActive"] is False, str(report["guardActive"]))

provider_log = [json.loads(l) for l in open(os.path.join(d, "provider.log"), encoding="utf-8") if l.strip()]
handshakes = [l for l in provider_log if l["event"] == "handshake"]
check("the synthetic provider saw the allowlisted SNI",
      any(h.get("sni") == ALLOW for h in handshakes), json.dumps(handshakes))
check("the synthetic provider never saw the denied SNI",
      not any(h.get("sni") == DENY for h in handshakes), json.dumps(handshakes))

gateway_log = [json.loads(l) for l in open(os.path.join(d, "gateway.log"), encoding="utf-8") if l.strip()]
allows = [l for l in gateway_log if l["event"] == "sni_allow"]
denies = [l for l in gateway_log if l["event"] == "sni_deny"]
check("the gateway logged exactly the admitted tunnels",
      # Two tunnels carry an allowlisted SNI: the unguarded allow probe and the
      # guarded pin-matches probe. Every other probe is refused before connect.
      len(allows) == 2 and all(a["sni"] == ALLOW and a["address"] == PROVIDER for a in allows),
      json.dumps(allows))
check("the gateway refused the non-allowlisted SNI and recorded the name",
      any(x["reason"] == "host-not-allowlisted" and x.get("sni") == DENY for x in denies),
      json.dumps(denies))

# 2. Deny path: same TCP destination, different SNI.
denied = load("plain-denied-sni")["tls"]["denied-sni"]
check("a non-allowlisted SNI is refused on the same TCP destination",
      denied["outcome"].startswith(("ERROR", "TIMEOUT")), json.dumps(denied))

# 3. Direct-to-provider reference case, no guard.
direct = load("plain-direct")["tcp"]["provider-direct"]
check("without a boundary the provider address is reachable (reference case)",
      direct == "CONNECTED", direct)

# 4-8. Guard cases.
pinned = load("guard-pin-matches")
check("the guarded probe preloaded the connector guard",
      pinned["guardActive"] is True, str(pinned["guardActive"]))
check("guard admits the provider name when it resolves to the pinned gateway",
      pinned["tls"]["allow"]["outcome"] == "CONNECTED", json.dumps(pinned["tls"]["allow"]))
check("guard-admitted TLS still terminates at the synthetic provider",
      pinned["tls"]["allow"].get("fingerprint256") == expected,
      json.dumps(pinned["tls"]["allow"]))

absent = load("guard-pin-absent")["tls"]["allow"]
check("guard refuses the gateway address when no pin is configured",
      absent["outcome"] == "ERROR:PILOT_EGRESS_DENIED", json.dumps(absent))

mismatch = load("guard-pin-mismatch")["tls"]["allow"]
check(f"guard refuses a pin that does not match ({WRONG} != {GATEWAY})",
      mismatch["outcome"] == "ERROR:PILOT_EGRESS_DENIED", json.dumps(mismatch))

offlist = load("guard-host-not-allowlisted")
check("guard refuses a name outside PILOT_EGRESS_HOSTS even with a valid pin",
      offlist["dns"][DENY] == "ERROR:PILOT_EGRESS_DENIED", offlist["dns"][DENY])

direct_ip = load("guard-direct-ip")["tcp"]["provider-direct"]
check("guard refuses a direct connection to the provider's public address",
      # An IP literal is refused synchronously, so the probe records it as a
      # throw rather than a socket error. Both encodings mean the same denial.
      direct_ip in ("THREW:PILOT_EGRESS_DENIED", "ERROR:PILOT_EGRESS_DENIED"),
      direct_ip)

width = max(len(name) for name, _, _ in checks)
failed = 0
for name, passed, detail in checks:
    print(f"allowpath: {'PASS' if passed else 'FAIL'}  {name.ljust(width)}")
    if not passed:
        failed += 1
        print(f"allowpath:      detail: {detail[:600]}")

print("allowpath: harness contained to loopback; no route to any real host existed")
if failed:
    print(f"allowpath: {failed} assertion(s) FAILED")
    sys.exit(1)
print(f"allowpath: all {len(checks)} assertions PASS")
PY
