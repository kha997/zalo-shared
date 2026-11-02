#!/usr/bin/env bash
# Offline G5 preflight: validate the manifest against the approved G5 scope in
# the reviewed connector image with no network namespace. No SDK import, vault,
# database or provider action.
set -euo pipefail
image=${1:?Usage: preflight-connector.sh IMAGE bootstrap|observe|send-test|invalid [MANIFEST]}
stage=${2:?Usage: preflight-connector.sh IMAGE bootstrap|observe|send-test|invalid [MANIFEST]}
base=${PILOT_PRIVATE_DIR:-"$HOME/pilot-private/zalo-shared"}
manifest=${3:-"$base/g5-synthetic/manifest.$stage.json"}
# The parent directory is 0700 owned by the connector UID, so the login user
# cannot stat the file; the Docker daemon performs the read.
sudo test -f "$manifest" || { echo "missing manifest: $manifest; run make-g5-synthetic-manifests.sh" >&2; exit 2; }
docker run --rm --network none --read-only --tmpfs /tmp:rw,nosuid,size=16m \
  --cap-drop ALL --security-opt no-new-privileges:true \
  -v "$manifest:/run/pilot/manifest.json:ro" \
  -e PILOT_MANIFEST=/run/pilot/manifest.json "$image" \
  dist/connector/tools/pilot-connector.js preflight
