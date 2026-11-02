#!/usr/bin/env bash
# Offline dry-run of the SDK-bearing connector image against a private manifest
# (default: the synthetic manifest). No network namespace, no SDK import, no
# vault or database access.
set -euo pipefail
image=${1:?Usage: dry-run-connector.sh IMAGE [MANIFEST]}
base=${PILOT_PRIVATE_DIR:-"$HOME/pilot-private/zalo-shared"}
manifest=${2:-"$base/pilot/manifest.synthetic.json"}
# The parent directory is 0700 owned by the connector UID, so the login user
# cannot stat the file; the Docker daemon performs the read.
sudo test -f "$manifest" || { echo "missing manifest: $manifest; run make-synthetic-manifest.sh for the default" >&2; exit 2; }
docker run --rm --network none --read-only --tmpfs /tmp:rw,nosuid,size=16m \
  --cap-drop ALL --security-opt no-new-privileges:true \
  -v "$manifest:/run/pilot/manifest.json:ro" \
  -e PILOT_MANIFEST=/run/pilot/manifest.json "$image"
