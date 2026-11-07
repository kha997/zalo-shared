#!/usr/bin/env bash
# Rehearse the automatic Windows QR presentation with synthetic fixtures only.
# Asserts: a valid fixture is staged, logged and shown in an interactive
# foreground window; a corrupt fixture is refused; no staged copy survives.
# Prints sanitized JSON (no image bytes) for the evidence report.
set -euo pipefail
repo=$(cd "$(dirname "$0")/../.." && pwd)
launcher="$repo/ops/local/launch-qr-viewer.sh"

fixture=''
stage='C:\Users\Admin\pilot-private-qr'
out='/dev/stdout'
while [ $# -gt 0 ]; do
  case "$1" in
    --fixture) fixture=${2:?}; shift 2 ;;
    --stage) stage=${2:?}; shift 2 ;;
    --out) out=${2:?}; shift 2 ;;
    *) printf 'qr-rehearsal: REFUSED unknown argument %s\n' "$1" >&2; exit 2 ;;
  esac
done

say() { printf 'qr-rehearsal: %s\n' "$*" >&2; }
fail() { printf 'qr-rehearsal: FAIL %s\n' "$*" >&2; exit 1; }

[ -f "$launcher" ] || fail "the launcher is missing"
stage_wsl=$(wslpath -u "$stage")
[ -d "$stage_wsl" ] || fail "the stage directory does not exist: $stage"
log="$stage_wsl/qr-viewer.log"
staged="$stage_wsl/qr.png"

if [ -z "$fixture" ]; then
  fixture="$stage_wsl/synthetic-fixture.png"
fi
[ -f "$fixture" ] || fail "no synthetic fixture at $fixture"
case "$fixture" in "$staged" | */qr.png) fail "the fixture must not be the staged copy" ;; esac
fixture_sha=$(sha256sum "$fixture" | cut -d' ' -f1)
fixture_bytes=$(stat -c %s "$fixture")

work=$(mktemp -d)
cleanup_all() {
  rm -f "$staged"
  rm -rf "$work"
}
trap cleanup_all EXIT

before() { if [ -f "$log" ]; then wc -l <"$log"; else printf '0\n'; fi; }
slice() { [ -f "$log" ] && tail -n "+$(($1 + 1))" "$log" || true; }

# ---- rehearsal 1: a valid synthetic fixture must be shown, then cleaned up ----
mark=$(before)
set +e
launcher_out=$(bash "$launcher" --fixture "$fixture" --autoclose 3 --timeout 60 2>&1)
rc=$?
set -e
run1=$(slice "$mark")
printf '%s\n' "$run1" | grep -q "viewer-staged sha256=$fixture_sha" ||
  fail "the valid fixture was not staged with its own digest (exit $rc): $launcher_out"
printf '%s\n' "$run1" | grep -qE 'viewer-shown .*visible=True .*image=[0-9]+x[0-9]+' ||
  fail "no visible foreground window was reported for the valid fixture: $launcher_out"
session=$(printf '%s\n' "$run1" | sed -n 's/.*viewer-shown .*session=\([0-9][0-9]*\).*/\1/p' | tail -n 1)
[ -n "$session" ] && [ "$session" != 0 ] ||
  fail "the window was not shown in the interactive desktop session"
image_size=$(printf '%s\n' "$run1" | sed -n 's/.*image=\([0-9][0-9]*x[0-9][0-9]*\).*/\1/p' | tail -n 1)
if [ "$rc" -ne 0 ]; then
  fail "the valid fixture was not presented (launcher exit $rc): $launcher_out"
fi
# The launcher returns once the window is shown; --autoclose then ends the
# window, so wait for its own clean-close record.
waited=0
while [ "$waited" -lt 15 ]; do
  slice "$mark" | grep -q 'viewer-closed' && break
  sleep 1
  waited=$((waited + 1))
done
run1=$(slice "$mark")
printf '%s\n' "$run1" | grep -q 'viewer-closed cleanup=final' ||
  fail "the viewer did not report a clean final cleanup"
[ ! -e "$staged" ] || fail "a staged QR survived the valid-fixture rehearsal"

# ---- rehearsal 2: a file that is not a PNG must be refused and removed ----
printf 'this is not a png\n' >"$work/corrupt.png"
mark=$(before)
set +e
bash "$launcher" --fixture "$work/corrupt.png" --autoclose 3 --timeout 30 >/dev/null 2>&1
rc2=$?
set -e
run2=$(slice "$mark")
printf '%s\n' "$run2" | grep -q 'viewer-refused invalid-png' ||
  fail "the corrupt fixture was not refused (exit $rc2)"
[ "$rc2" -eq 4 ] || fail "the corrupt fixture refused with exit $rc2, expected 4"
[ ! -e "$staged" ] || fail "a staged copy survived the corrupt-fixture rehearsal"

# ---- rehearsal 3: a header-valid but undecodable PNG must not survive ----
head -c 33 "$fixture" >"$work/truncated.png"
head -c 128 /dev/zero >>"$work/truncated.png"
mark=$(before)
set +e
bash "$launcher" --fixture "$work/truncated.png" --autoclose 3 --timeout 30 >/dev/null 2>&1
rc3=$?
set -e
run3=$(slice "$mark")
truncated='refused'
if [ "$rc3" -eq 0 ]; then
  truncated='ADMITTED'
  waited=0
  while [ "$waited" -lt 10 ]; do
    slice "$mark" | grep -q 'viewer-closed' && break
    sleep 1
    waited=$((waited + 1))
  done
fi
[ ! -e "$staged" ] || fail "a staged copy survived the truncated-PNG rehearsal"
[ "$truncated" = 'refused' ] ||
  fail "a header-valid but undecodable PNG was admitted instead of refused"

# ---- log hygiene: the viewer never writes image bytes ----
longest=$(awk '{ if (length($0) > m) m = length($0) } END { print m + 0 }' "$log")
[ "$longest" -lt 400 ] || fail "qr-viewer.log has a $longest-byte line; it may contain image data"

python3 - "$out" <<PY
import json, sys
report = {
  "fixtureSha256": "$fixture_sha",
  "fixtureBytes": $fixture_bytes,
  "validFixture": {"exit": $rc, "shown": True, "session": int("$session"),
                   "imageSize": "$image_size", "cleanup": "final", "stagedCopyRemains": False},
  "corruptFixture": {"exit": $rc2, "refused": "invalid-png", "stagedCopyRemains": False},
  "truncatedPng": {"exit": $rc3, "outcome": "$truncated", "stagedCopyRemains": False},
  "logLongestLine": $longest,
  "verdict": "PASS",
}
text = json.dumps(report, indent=1) + "\n"
if sys.argv[1] == "/dev/stdout":
    sys.stdout.write(text)
else:
    open(sys.argv[1], "w", encoding="utf-8").write(text)
    sys.stdout.write(text)
PY
say "all viewer rehearsals passed"
