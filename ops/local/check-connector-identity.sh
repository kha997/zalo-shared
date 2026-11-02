#!/usr/bin/env bash
# Assert the connector image is nonroot, SDK-bearing and bound to the reviewed
# source commit. Defaults to HEAD; pass the artifact commit for a live package.
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
image=${1:?Usage: check-connector-identity.sh IMAGE [SOURCE_COMMIT]}
expected=${2:-${PILOT_SOURCE_COMMIT:-HEAD}}
cd "$(dirname "$0")/../.."
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
docker run --rm --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges:true --entrypoint /nodejs/bin/node "$image" -e '
const fs = require("node:fs");
const zca = require("/app/node_modules/zca-js/package.json");
console.log(JSON.stringify({
  uid: process.getuid(),
  zcaJs: zca.version,
  buildIdentity: JSON.parse(fs.readFileSync("/app/build-identity.json", "utf8")),
}));
' >"$work/identity.json"
node - "$work/identity.json" "$expected" <<'NODE'
const crypto = require("node:crypto");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const observed = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const lock = fs.readFileSync("connector/package-lock.json");
const sdk = JSON.parse(lock.toString("utf8")).packages["node_modules/zca-js"].integrity;
const expected = execFileSync("git", ["rev-parse", process.argv[3]], { encoding: "utf8" }).trim();
const lockSha = crypto.createHash("sha256").update(lock).digest("hex");
if (observed.uid !== 65532) throw new Error("unexpected connector UID");
if (observed.zcaJs !== "2.2.0") throw new Error("unexpected SDK version");
if (observed.buildIdentity.sourceCommit !== expected) throw new Error("commit mismatch");
if (observed.buildIdentity.lockSha256 !== lockSha) throw new Error("lock mismatch");
if (observed.buildIdentity.sdkIntegrity !== sdk) throw new Error("SDK integrity mismatch");
console.log(JSON.stringify({ ...observed, expectedSourceCommit: expected, sourceCommitMatches: true, lockMatches: true, sdkMatches: true }));
NODE
