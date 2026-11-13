#!/usr/bin/env bash
# Offline enrollment readiness: bind the private template to the reviewed image,
# admit the synthetic enrollment fixture, deny every out-of-scope variant, prove
# the enrollment grant cannot drive observe/send-test, and exercise the private
# QR view with synthetic fixtures in the reviewed image.
#
# No SDK login, QR generation for a real account, network egress or provider
# action occurs. All identities and timestamps are synthetic.
set -euo pipefail
cd "$(dirname "$0")/../.."
repo=$(pwd)

image=${PILOT_CONNECTOR_IMAGE:-zalo-shared-connector:g5-local}
base=${PILOT_PRIVATE_DIR:-"$HOME/pilot-private/zalo-shared"}
root=$base/g5-enroll
template=$root/manifest.enroll.template.json
fixtures=$root/fixtures
export PILOT_DB_NETWORK=${PILOT_DB_NETWORK:-zalo-shared-pilot-db}
export PILOT_PRIVATE_DIR=$base

say() { printf 'pilot-enroll: %s\n' "$*"; }
fail() { printf 'pilot-enroll: FAIL %s\n' "$*" >&2; exit 1; }

for cmd in docker python3 node; do
  command -v "$cmd" >/dev/null || fail "$cmd is required"
done
docker image inspect "$image" >/dev/null 2>&1 || fail "$image not found"

# The denial fixtures assert behaviour around absolute synthetic timestamps
# (expired, issued-in-the-future). Regenerate them immediately before the run so
# a stale fixture cannot silently become a valid grant while still expecting
# denial. The generator reads the build block from the reviewed image.
say "regenerating synthetic fixtures"
PILOT_CONNECTOR_IMAGE=$image PILOT_PRIVATE_DIR=$base \
  node ops/local/make-enroll-fixtures.mjs >/dev/null
[ -f "$template" ] || fail "the fixture generator did not write the template"
[ -d "$fixtures" ] || fail "the fixture generator did not write the fixtures"

tmp=$(mktemp -d)
cleanup() { rm -rf "$tmp" 2>/dev/null || sudo rm -rf "$tmp"; }
trap cleanup EXIT

say "image: $image"
docker run --rm --network none --entrypoint /nodejs/bin/node "$image" \
  -e 'process.stdout.write(require("fs").readFileSync("/app/build-identity.json","utf8"))' \
  >"$tmp/identity.json"

# ---------------------------------------------- template binds to the artifact
python3 - "$template" "$tmp/identity.json" "$repo/connector/package-lock.json" <<'PY'
import hashlib, json, sys
template_path, identity_path, lock_path = sys.argv[1:4]
template = json.load(open(template_path, encoding="utf-8"))
identity = json.load(open(identity_path, encoding="utf-8"))
lock_bytes = open(lock_path, "rb").read()
lock = json.loads(lock_bytes)
checks = []
def check(name, ok, detail=""):
    checks.append((name, bool(ok), str(detail)))
check("the template has exactly the four manifest sections",
      list(template) == ["version", "build", "consent", "grant"], list(template))
check("the template build block equals the image's embedded identity",
      template["build"] == {key: identity.get(key) for key in ("sourceCommit", "lockSha256", "sdkIntegrity")},
      {"template": template["build"], "image": identity})
check("the image source commit is a reviewed 40-character SHA",
      len(identity.get("sourceCommit", "")) == 40, identity.get("sourceCommit"))
check("the template lock hash equals connector/package-lock.json",
      identity.get("lockSha256") == hashlib.sha256(lock_bytes).hexdigest(), identity.get("lockSha256"))
check("the template SDK integrity equals the locked zca-js integrity",
      identity.get("sdkIntegrity") == lock["packages"]["node_modules/zca-js"]["integrity"],
      identity.get("sdkIntegrity"))
check("the template consent is enrollment-only with no account or peer",
      template["consent"]["allowedPurposes"] == ["enroll-session"]
      and template["consent"]["expectedAccountId"] is None
      and template["consent"]["allowedPeerIds"] == [],
      template["consent"])
check("the template grant is enrollment-only with no account or peer",
      template["grant"]["purpose"] == "enroll-session"
      and template["grant"]["expectedAccountId"] is None
      and template["grant"]["allowedPeerIds"] == [],
      template["grant"])
check("the template carries no timestamp or consent reference of its own",
      template["consent"]["consentRef"].startswith("<")
      and template["grant"]["ownerConsentRef"].startswith("<")
      and template["grant"]["issuedAt"].startswith("<")
      and template["grant"]["expiresAt"].startswith("<"),
      {"consentRef": template["consent"]["consentRef"], "issuedAt": template["grant"]["issuedAt"]})
width = max(len(name) for name, _, _ in checks)
failed = 0
for name, ok, detail in checks:
    print(f"pilot-enroll: {'PASS' if ok else 'FAIL'}  {name.ljust(width)}")
    if not ok:
        failed += 1
        print(f"pilot-enroll:      detail: {detail[:500]}")
if failed:
    sys.exit(1)
PY

# ------------------------------------------------ synthetic grant is admitted
PILOT_DB_NETWORK=$PILOT_DB_NETWORK bash ops/local/preflight-connector.sh \
  "$image" bootstrap "$fixtures/enroll.synthetic.json" >"$tmp/admitted.json" ||
  fail "the synthetic enrollment fixture was not admitted"
cat "$tmp/admitted.json"
python3 - "$tmp/admitted.json" <<'PY'
import json, sys
text = open(sys.argv[1], encoding="utf-8").read().splitlines()
out = json.loads(text[-1])
checks = []
def check(name, ok, detail=""):
    checks.append((name, bool(ok), str(detail)))
check("preflight admits the synthetic enrollment manifest", out.get("gate") == "admitted" and out.get("ok") is True, out)
check("the admitted stage is enrollment only", out.get("purpose") == "enroll-session", out.get("purpose"))
check("the admitted grant is not account-bound", out.get("accountBound") is False, out.get("accountBound"))
check("the admitted grant has zero peers", out.get("peerCount") == 0, out.get("peerCount"))
check("the admitted budget is 10 parts per day", out.get("maxPartsPerDay") == 10, out.get("maxPartsPerDay"))
check("the admitted interval is 2000 ms", out.get("minIntervalMs") == 2000, out.get("minIntervalMs"))
check("the admitted lifetime is at most one hour",
      isinstance(out.get("lifetimeMs"), int) and 0 < out["lifetimeMs"] <= 3600000,
      out.get("lifetimeMs"))
width = max(len(name) for name, _, _ in checks)
failed = 0
for name, ok, detail in checks:
    print(f"pilot-enroll: {'PASS' if ok else 'FAIL'}  {name.ljust(width)}")
    if not ok:
        failed += 1
        print(f"pilot-enroll:      detail: {detail[:500]}")
if failed:
    sys.exit(1)
PY

# ------------------------------------------------ every out-of-scope case denied
for fixture in "$fixtures"/deny-*.json; do
  name=$(basename "$fixture")
  # The wrapper exits 0 only when it observed the denial; a nonzero exit means
  # the out-of-scope manifest was admitted, which must fail this verification.
  if ! out=$(bash ops/local/preflight-connector.sh "$image" invalid "$fixture" 2>&1); then
    printf '%s\n' "$out" >&2
    fail "$name was admitted"
  fi
  grep -q '"gate":"denied"' <<<"$out" || fail "$name did not return a denial"
  say "PASS  denied: $name"
done

# ------------------------------------- enrollment manifest cannot drive later stages
for stage in observe send-test; do
  if out=$(bash ops/local/preflight-connector.sh "$image" "$stage" "$fixtures/enroll.synthetic.json" 2>&1); then
    fail "the enrollment manifest satisfied the $stage host stage check"
  fi
  grep -q '"purpose":"enroll-session"' <<<"$out" ||
    fail "the $stage stage check did not fail on the enrollment purpose"
  say "PASS  the enrollment manifest is refused for the $stage stage"
done

for command in run-observe run-send-test; do
  status=0
  docker run --rm --network none --read-only --tmpfs /tmp:rw,nosuid,size=16m \
    --cap-drop ALL --security-opt no-new-privileges:true \
    -v "$fixtures/enroll.synthetic.json:/run/pilot/manifest.json:ro" \
    -e PILOT_MANIFEST=/run/pilot/manifest.json \
    "$image" dist/connector/tools/pilot-connector.js "$command" --acknowledge-pilot-risk \
    >"$tmp/$command.json" 2>&1 || status=$?
  [ "$status" -ne 0 ] || fail "$command accepted an enrollment manifest"
  grep -q '"gate":"denied"' "$tmp/$command.json" || fail "$command did not report a denial"
  say "PASS  $command refuses the enrollment-only grant"
done

# --------------------------------------------- private QR view with synthetic PNG
mkdir "$tmp/foreign"
chmod 0700 "$tmp/foreign"
sudo chown 0:0 "$tmp/foreign"
docker run --rm --network none --read-only --tmpfs /tmp:rw,nosuid,size=8m \
  --user 65532:65532 --cap-drop ALL --security-opt no-new-privileges:true \
  --entrypoint /nodejs/bin/node \
  -v "$(pwd)/ops/local/harness:/harness:ro" \
  -v "$tmp/foreign:/foreign" \
  -e FIXTURE_ROOT=/tmp/qrfixture \
  -e FIXTURE_FOREIGN_DIR=/foreign \
  "$image" /harness/qr-fixture.mjs >"$tmp/qr.json" 2>"$tmp/qr.err" ||
  { cat "$tmp/qr.err" >&2; fail "the QR fixture run failed"; }

python3 - "$tmp/qr.json" <<'PY'
import json, sys
report = json.load(open(sys.argv[1], encoding="utf-8"))
results = report["results"]
checks = []
def check(name, ok, detail=""):
    checks.append((name, bool(ok), str(detail)))
check("the fixture runs as the connector UID", report.get("uid") == 65532, report.get("uid"))
check("the QR file is written 0600 and owned by the connector UID",
      results["written"]["mode"] == "600" and results["written"]["uid"] == 65532
      and results["written"]["isFile"] is True and results["written"]["isSymlink"] is False,
      results.get("written"))
check("the QR view directory is 0700 and owned by the connector UID",
      results["directory"]["mode"] == "700" and results["directory"]["uid"] == 65532,
      results.get("directory"))
check("only qr.png is left in the view after display", results["entries"] == ["qr.png"], results.get("entries"))
check("clear() removes the QR file", results.get("cleared") is True, results.get("cleared"))
check("clear() is safe when the file is absent", results.get("clearWhenAbsent") == "OK", results.get("clearWhenAbsent"))
check("a world-readable view directory is refused",
      results.get("looseDirectory") == "REFUSED", results.get("looseDirectory"))
check("a symlinked qr.png is refused and the target is untouched",
      results.get("symlinkTarget") == "REFUSED" and results.get("decoyUnchanged") is True,
      {"target": results.get("symlinkTarget"), "decoy": results.get("decoyUnchanged")})
check("non-PNG bytes are refused", results.get("nonPng") == "REFUSED", results.get("nonPng"))
check("a view directory owned by another UID is refused",
      results.get("foreignOwner") == "REFUSED", results.get("foreignOwner"))
check("the fixture cleans every synthetic directory",
      results.get("cleanup") == [], results.get("cleanup"))
width = max(len(name) for name, _, _ in checks)
failed = 0
for name, ok, detail in checks:
    print(f"pilot-enroll: {'PASS' if ok else 'FAIL'}  {name.ljust(width)}")
    if not ok:
        failed += 1
        print(f"pilot-enroll:      detail: {detail[:500]}")
if failed:
    sys.exit(1)
PY

# ------------------------------------------- private material permissions
check_mode() {
  local path=$1 mode=$2 owner=${3:-} label=$4
  sudo test -e "$path" || fail "$label is missing: $path"
  local actual
  actual=$(sudo stat -c '%a %u' "$path")
  [ "${actual%% *}" = "$mode" ] || fail "$label has mode ${actual%% *}, expected $mode"
  if [ -n "$owner" ]; then
    [ "${actual##* }" = "$owner" ] || fail "$label is owned by ${actual##* }, expected $owner"
  fi
  say "PASS  $label is mode $mode${owner:+ owned by $owner}"
}
check_mode "$template" 600 "" "the enrollment template"
check_mode "$fixtures" 700 "" "the synthetic fixture directory"
check_mode "$base/pilot/session.key" 600 65532 "the session key"
check_mode "$base/pilot/state" 700 65532 "the private state directory"
[ -z "$(find "$root" -name 'qr.png' -print -quit)" ] || fail "a QR image was left under the enrollment material"
[ -z "$(sudo ls -A "$tmp/foreign")" ] || fail "the refused foreign view directory was written to"
say "PASS  no QR image or foreign write was left behind"
say "all enrollment-readiness assertions PASS"
