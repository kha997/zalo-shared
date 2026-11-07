#!/usr/bin/env bash
# Scan the private G5-A diagnostic connector and evaluate the time-boxed
# disposition. The unfiltered scan always runs first and its failure is kept
# visible; the disposition is evaluated only against the resulting report and
# only for the exact image and OS release it names. Any deviation, any new
# finding, or the expiry stops the caller.
set -euo pipefail
image=${1:?Usage: scan-diagnostic-connector.sh IMAGE [LABEL]}
label=${2:-g5a-diag}
repo=$(cd "$(dirname "$0")/../.." && pwd)
cd "$repo"

vulnerabilities="docs/evidence/$label-container-vulnerabilities.json"
summary="docs/evidence/$label-image-scan-summary.json"
report="docs/evidence/$label-cve-disposition-report.json"
ledger="docs/evidence/G5A-CVE-DISPOSITION-LEDGER.jsonl"
log="docs/evidence/$label-unfiltered-scan.log"
mkdir -p docs/evidence

say() { printf 'g5a-scan: %s\n' "$*"; }
fail() { printf 'g5a-scan: REFUSED %s\n' "$*" >&2; exit 1; }

say "running the unfiltered gate for $image (its failure is expected and retained)"
set +e
ops/pilot-scan.sh "$image" "$label" >"$log" 2>&1
scan_status=$?
set -e
cat "$log"
[ "$scan_status" -ne 0 ] || fail "the unfiltered scan passed; the disposition basis changed and must be re-reviewed"
[ -f "$summary" ] || fail "the unfiltered scan produced no summary"

python3 - "$summary" "$vulnerabilities" <<'PY'
import json, sys
summary_path, vuln_path = sys.argv[1], sys.argv[2]
summary = json.loads(open(summary_path).read())
report = json.loads(open(vuln_path).read())
expected = {"CVE-2026-76844", "CVE-2026-85091"}
findings = [
    (v.get("VulnerabilityID"), v.get("PkgName"), v.get("InstalledVersion"), v.get("Severity"), v.get("FixedVersion") or None)
    for result in report.get("Results", [])
    for v in (result.get("Vulnerabilities") or [])
]
ids = {f[0] for f in findings}
if summary.get("highCriticalCount") != 2 or len(findings) != 2 or ids != expected:
    raise SystemExit(f"the unfiltered report is not exactly the two reviewed findings: {sorted(ids)}")
for cve, package, version, severity, fixed in findings:
    if package != "zlib1g" or severity != "HIGH" or fixed is not None:
        raise SystemExit(f"unexpected finding shape for {cve}: {package} {version} {severity} fixed={fixed}")
    print(f"g5a-scan: retained residual risk {cve} {package} {version} {severity} fixed={fixed}")
PY

image_id=$(docker inspect -f '{{.Id}}' "$image") || fail "the image is not in the local store"

# Trivy names the config blob while docker names the tag's index. Derive the
# config digest from this tag independently and require the report to describe
# that same blob, so a report for another artifact cannot satisfy the pin.
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
docker save "$image" -o "$work/image.tar"
config_blob=$(tar -xOf "$work/image.tar" manifest.json | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["Config"])')
derived_config="sha256:$(tar -xOf "$work/image.tar" "$config_blob" | sha256sum | cut -d' ' -f1)"
reported=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["Metadata"]["ImageID"])' "$vulnerabilities")
[ "$derived_config" = "$reported" ] ||
  fail "the scan report describes $reported but the tag's config blob is $derived_config"

say "evaluating the disposition for $image ($image_id) config=$derived_config"
# The interpreter environment is stripped of NODE_OPTIONS: a preload could shadow
# Date.now and turn the real-clock expiry back into something a caller controls.
env -u NODE_OPTIONS node ops/g5a-cve-disposition.cjs evaluate \
  --vulnerabilities "$vulnerabilities" \
  --disposition ops/g5a-cve-disposition.json \
  --image-ref "$image" \
  --image-id "$image_id" \
  --scope private-g5a-diagnostic \
  --report "$report" \
  --ledger "$ledger"
say "disposition accepted; the unfiltered failure above remains the record"
