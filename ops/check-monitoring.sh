#!/usr/bin/env bash
set -euo pipefail
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
curl --fail --location --silent --show-error --retry 3 -o "$work/prometheus.tar.gz" https://github.com/prometheus/prometheus/releases/download/v3.15.1/prometheus-3.15.1.linux-amd64.tar.gz
printf '%s  %s\n' 6a726885328ad9efebbf36e876ce2fb6225468a71fd1e7ce3ba666d5f4d97a84 "$work/prometheus.tar.gz" | sha256sum -c -
tar -xzf "$work/prometheus.tar.gz" -C "$work" prometheus-3.15.1.linux-amd64/promtool
printf 'synthetic-config-validation-only\n' > "$work/metrics-token"
python3 - "$work" <<'PY'
import sys
from pathlib import Path
work=Path(sys.argv[1])
text=Path('ops/monitoring/prometheus.yml').read_text().replace('/etc/prometheus/alerts.yml',str(Path('ops/monitoring/alerts.yml').resolve())).replace('/run/secrets/metrics_token',str(work/'metrics-token'))
(work/'prometheus.yml').write_text(text)
PY
"$work/prometheus-3.15.1.linux-amd64/promtool" check config "$work/prometheus.yml"
(cd ops/monitoring && "$work/prometheus-3.15.1.linux-amd64/promtool" test rules alerts.test.yml)
