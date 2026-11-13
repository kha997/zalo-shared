#!/usr/bin/env bash
# Assert the application image is nonroot and free of the pilot SDK.
set -euo pipefail
image=${1:?Usage: check-app-image.sh IMAGE}
docker run --rm --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges:true --entrypoint /nodejs/bin/node "$image" -e '
const fs = require("node:fs");
const result = {
  uid: process.getuid(),
  sdkPresent: fs.existsSync("/app/node_modules/zca-js"),
  connectorArtifacts: fs.existsSync("/app/dist/connector"),
};
console.log(JSON.stringify(result));
if (result.uid === 0 || result.sdkPresent || result.connectorArtifacts) process.exit(1);
'
