#!/usr/bin/env bash
# Generate the synthetic, nonsecret manifest used by the offline dry-run gate.
# The file is installed outside the repository, owned by the connector UID 65532.
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
base=${PILOT_PRIVATE_DIR:-"$HOME/pilot-private/zalo-shared"}
cd "$(dirname "$0")/../.."
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
GITHUB_SHA=$(git rev-parse HEAD) node --import tsx ops/ci-pilot-manifest.ts "$tmp"
sudo install -o 65532 -g 65532 -m 0600 "$tmp" "$base/pilot/manifest.synthetic.json"
sudo stat -c 'mode=%a owner=%U:%G size=%s name=%n' "$base/pilot/manifest.synthetic.json"
