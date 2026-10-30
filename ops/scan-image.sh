#!/usr/bin/env bash
# Reproducible scanner binary from the official release; no Docker socket is given to it.
set -euo pipefail
image=${1:?Usage: scan-image.sh IMAGE}
mkdir -p docs/evidence
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
curl --fail --location --silent --show-error --retry 3 --output "$work/trivy.tar.gz" https://github.com/aquasecurity/trivy/releases/download/v0.76.1/trivy_0.76.1_Linux-64bit.tar.gz
printf '%s  %s\n' c7cbe3137fb8a48a17574bede3dd6beb16742d1e9772929940fc90082c39d9c0 "$work/trivy.tar.gz" | sha256sum -c -
tar -xzf "$work/trivy.tar.gz" -C "$work" trivy
docker save "$image" -o "$work/image.tar"
"$work/trivy" --version
"$work/trivy" image --input "$work/image.tar" --scanners vuln --severity HIGH,CRITICAL --format json --output docs/evidence/container-vulnerabilities.json --exit-code 0
python3 - <<'PY'
import json
from pathlib import Path
report=json.loads(Path('docs/evidence/container-vulnerabilities.json').read_text())
findings=[]
for result in report.get('Results',[]):
 for v in result.get('Vulnerabilities',[]):
  findings.append({'target':result.get('Target'),'id':v.get('VulnerabilityID'),'package':v.get('PkgName'),'installed':v.get('InstalledVersion'),'fixed':v.get('FixedVersion'),'severity':v.get('Severity'),'url':v.get('PrimaryURL')})
summary={'scanner':'Trivy0.76.1','highCriticalCount':len(findings),'fixableHighCriticalCount':sum(bool(x['fixed']) for x in findings),'findings':findings}
Path('docs/evidence/container-scan-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary))
if summary['fixableHighCriticalCount']: raise SystemExit('Fixable high/critical image vulnerabilities remain')
PY
