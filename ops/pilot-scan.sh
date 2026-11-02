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
const fs = require("fs");
const path = require("path");
const read = (name) => require(`/app/node_modules/${name}/package.json`);
const zca = read("zca-js");
const cryptoJs = read("crypto-js");
const forbidden = new Set(["manifest.json", "session.key", "session.enc", "qr.png"]);
const privateFiles = [];
const walk = (dir) => {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== ".cache") walk(full);
    } else if (forbidden.has(entry.name)) privateFiles.push(full);
  }
};
walk("/app");
walk("/run");
console.log(JSON.stringify({
  uid: process.getuid(),
  zcaJs: zca.version,
  zcaResolved: require.resolve("zca-js"),
  cryptoJs: cryptoJs.version,
  buildIdentity: JSON.parse(fs.readFileSync("/app/build-identity.json", "utf8")),
  privateFiles
}));
' | tee docs/evidence/connector-image-inventory.json

python3 - "$image" "$work/licenses.json" <<'PY'
import json, re, subprocess, sys
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
if inventory.get("privateFiles"):
    raise SystemExit("Pilot connector image must not contain private pilot material")
identity = inventory.get("buildIdentity") or {}
if (
    sorted(identity) != ["lockSha256", "sdkIntegrity", "sourceCommit", "version"]
    or identity.get("version") != 1
    or not re.fullmatch(r"[a-f0-9]{40}", identity.get("sourceCommit") or "")
    or not re.fullmatch(r"[a-f0-9]{64}", identity.get("lockSha256") or "")
    or not re.fullmatch(r"sha512-[A-Za-z0-9+/]+={0,2}", identity.get("sdkIntegrity") or "")
):
    raise SystemExit("Pilot connector image must embed a valid build identity")
PY
