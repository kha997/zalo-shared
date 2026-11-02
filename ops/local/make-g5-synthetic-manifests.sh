#!/usr/bin/env bash
# Generate the three synthetic G5 stage manifests for offline preflight.
# They contain no real account, peer, key or session material. Installed
# outside the repository as 0600 owned by the connector runtime UID.
set -euo pipefail
base=${PILOT_PRIVATE_DIR:-"$HOME/pilot-private/zalo-shared"}
target="$base/g5-synthetic"
cd "$(dirname "$0")/../.."
sudo install -d -o 65532 -g 65532 -m 0700 "$target"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
for stage in bootstrap observe send-test; do
  node --import tsx ops/g5-synthetic-manifest.ts "$tmp/$stage.json" "$stage" >/dev/null
  sudo install -o 65532 -g 65532 -m 0600 "$tmp/$stage.json" "$target/manifest.$stage.json"
done
node --import tsx ops/g5-synthetic-manifest.ts "$tmp/invalid.json" observe --invalid-scope >/dev/null
sudo install -o 65532 -g 65532 -m 0600 "$tmp/invalid.json" "$target/manifest.invalid.json"
sudo stat -c 'mode=%a owner=%U:%G name=%n' "$target"/manifest.*.json
