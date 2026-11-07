#!/usr/bin/env bash
# Build the diagnostic connector from the committed tree and prove the embedded
# identity. No push, no registry, no deployment.
set -euo pipefail
repo=$(cd "$(dirname "$0")/../.." && pwd)
cd "$repo"
tag=${1:-}
fail() { printf 'g5a-build: REFUSED %s\n' "$*" >&2; exit 1; }
say() { printf 'g5a-build: %s\n' "$*"; }

[ -z "$(git status --porcelain)" ] || fail "the working tree must be clean so the embedded commit describes the built source"
commit=$(git rev-parse HEAD)
[[ $commit =~ ^[a-f0-9]{40}$ ]] || fail "HEAD is not a full commit"
tag=${tag:-"zalo-shared-connector:g5-diag-${commit:0:7}"}

# The disposition pins the image id that this build produces, so it can only be
# written after the build. It never enters the image: ops/g5a-cve-disposition.json
# is read by ops/local/scan-diagnostic-connector.sh, which refuses an expired,
# wrong-scope or wrong-image disposition, and by the deployment verification.
say "building $tag from $commit"
docker build --build-arg SOURCE_COMMIT="$commit" -f ops/Dockerfile.connector -t "$tag" .
ops/local/check-connector-identity.sh "$tag" "$commit"
image_id=$(docker inspect -f '{{.Id}}' "$tag")
say "built $tag id=$image_id sourceCommit=$commit"
printf '%s %s\n' "$tag" "$image_id"
