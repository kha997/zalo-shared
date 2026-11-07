#!/usr/bin/env bash
# Print only variable names from a private env file or container. Values are
# never emitted, so this is the approved way to inspect pilot configuration.
set -euo pipefail

usage() {
  echo "Usage: private-env-keys.sh FILE | --container NAME" >&2
  exit 2
}

if [[ ${1:-} == --container ]]; then
  [[ $# -eq 2 && -n $2 ]] || usage
  docker inspect "$2" --format '{{range .Config.Env}}{{println .}}{{end}}' \
    | sed -nE 's/^(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=.*/\2/p' \
    | sort -u
elif [[ $# -eq 1 && -n $1 ]]; then
  [[ -f $1 ]] || { echo "not a regular file: $1" >&2; exit 2; }
  sed -nE 's/^(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=.*/\2/p' "$1" \
    | sort -u
else
  usage
fi
