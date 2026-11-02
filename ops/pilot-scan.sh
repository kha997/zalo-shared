#!/usr/bin/env bash
# Separately scans the intentional SDK-bearing pilot connector image.
# The application image is scanned by ops/scan-image.sh and must stay SDK-free.
set -euo pipefail
image=${1:?Usage: pilot-scan.sh IMAGE}
mkdir -p docs/evidence
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
curl --fail --location --silent --show-error --retry 3 --output "$work/trivy.tar.gz" https://github.com/aquasecurity/trivy/releases/download/v0.76.1/trivy_0.76.1_Linux-64bit.tar.gz
printf '%s  %s\n' c7cbe3137fb8a48a17574bede3dd6beb16742d1e9772929940fc90082c39d9c0 "$work/trivy.tar.gz" | sha256sum -c -
tar -xzf "$work/trivy.tar.gz" -C "$work" trivy
docker save "$image" -o "$work/image.tar"
"$work/trivy" --version
"$work/trivy" image --input "$work/image.tar" --scanners vuln --severity HIGH,CRITICAL --format json --output docs/evidence/connector-container-vulnerabilities.json --exit-code 0
"$work/trivy" image --input "$work/image.tar" --scanners license --format json --output "$work/licenses.json" --exit-code 0

# Runtime identity of the intentional SDK surface. Nothing here reads a
# credential, manifest or network resource.
docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true "$image" -e '
const read = (name) => require(`/app/node_modules/${name}/package.json`);
const zca = read("zca-js");
const cryptoJs = read("crypto-js");
console.log(JSON.stringify({
  uid: process.getuid(),
  zcaJs: zca.version,
  zcaResolved: require.resolve("zca-js"),
  cryptoJs: cryptoJs.version
}));
' | tee docs/evidence/connector-image-inventory.json

python3 - "$image" "$work/licenses.json" <<'PY'
import json, subprocess, sys
from pathlib import Path
image, license_path = sys.argv[1], sys.argv[2]
report = json.loads(Path("docs/evidence/connector-container-vulnerabilities.json").read_text())
findings = []
for result in report.get("Results", []):
    for v in result.get("Vulnerabilities", []):
        findings.append({
            "target": result.get("Target"),
            "id": v.get("VulnerabilityID"),
            "package": v.get("PkgName"),
            "installed": v.get("InstalledVersion"),
            "fixed": v.get("FixedVersion"),
            "severity": v.get("Severity"),
            "url": v.get("PrimaryURL"),
        })
licenses = []
for result in json.loads(Path(license_path).read_text()).get("Results", []):
    for item in result.get("Licenses", []):
        licenses.append({
            "target": result.get("Target"),
            "package": item.get("PkgName"),
            "license": item.get("Name"),
            "severity": item.get("Severity"),
        })
inventory = json.loads(Path("docs/evidence/connector-image-inventory.json").read_text())
config = json.loads(subprocess.check_output([
    "docker", "image", "inspect", image
]))[0].get("Config", {})
ports = config.get("ExposedPorts") or {}
summary = {
    "scanner": "Trivy0.76.1",
    "image": image,
    "highCriticalCount": len(findings),
    "fixableHighCriticalCount": sum(bool(x["fixed"]) for x in findings),
    "findings": findings,
    "licenses": licenses,
    "exposedPorts": ports,
    "runtime": inventory,
    "residualRisks": [
        "crypto-js is deprecated/unmaintained but required transitively by zca-js 2.2.0",
        "unofficial client behavior and account restrictions remain unproven until the approved live pilot",
    ],
}
Path("docs/evidence/connector-image-scan-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
print(json.dumps(summary))
if summary["fixableHighCriticalCount"]:
    raise SystemExit("Fixable high/critical connector image vulnerabilities remain")
if summary["exposedPorts"]:
    raise SystemExit("Pilot connector image must not expose ports")
if inventory.get("uid") == 0:
    raise SystemExit("Pilot connector image must run as non-root")
if inventory.get("zcaJs") != "2.2.0" or not inventory.get("zcaResolved"):
    raise SystemExit("Pilot connector image must pin and resolve zca-js 2.2.0")
if inventory.get("cryptoJs") != "4.2.0":
    raise SystemExit("Unexpected crypto-js version; review the connector lock")
PY
