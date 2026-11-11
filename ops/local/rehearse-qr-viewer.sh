#!/usr/bin/env bash
# Rehearse the automatic Windows QR presentation with synthetic fixtures only.
# Asserts: a valid fixture is staged, logged and shown in an interactive
# foreground window; a corrupt fixture is refused; the connector clearing its
# live source closes the window and removes the staged copy; a forced viewer
# kill is followed by the termination guard removing it; a timeout leaves
# nothing behind. Prints sanitized JSON (no image bytes) for the report.
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
powershell='/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'
[ -x "$powershell" ] || powershell=$(command -v powershell.exe || true)
[ -n "$powershell" ] && [ -x "$powershell" ] ||
  fail "Windows PowerShell is not reachable from WSL"
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
  rm -f "$stage_wsl/qr-viewer-run.txt"
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

# ---- rehearsal 4: the live source path, cleared while the window is open ----
# This is the 2026-11-11 shape: the connector clears qr.png after a denied
# attempt, the viewer sees the source disappear, and the staged copy must go.
cp "$fixture" "$work/live-source.png"
mark=$(before)
set +e
launcher_out=$(bash "$launcher" --source "$work/live-source.png" --timeout 60 2>&1)
rc4=$?
set -e
[ "$rc4" -eq 0 ] ||
  fail "the live-source viewer did not present a QR (exit $rc4): $launcher_out"
[ -e "$staged" ] || fail "the live-source rehearsal staged nothing"
rm -f "$work/live-source.png"
waited=0
while [ "$waited" -lt 20 ]; do
  slice "$mark" | grep -q 'viewer-closed' && break
  sleep 1
  waited=$((waited + 1))
done
run4=$(slice "$mark")
printf '%s\n' "$run4" | grep -q 'viewer-close source-cleared' ||
  fail "the viewer did not observe the connector clearing its QR"
printf '%s\n' "$run4" | grep -q 'viewer-form-closing staged-copy-removed' ||
  fail "the viewer did not remove the staged copy when the source cleared"
printf '%s\n' "$run4" | grep -q 'viewer-closed cleanup=final' ||
  fail "the source-cleared close did not report a clean final cleanup"
[ ! -e "$staged" ] || fail "a staged QR survived the source-cleared rehearsal"

# ---- rehearsal 5: a terminated viewer must leave no QR (guard is last resort) ----
mark=$(before)
bash "$launcher" --fixture "$fixture" --timeout 60 >/dev/null 2>&1 &
launcher_pid=$!
present=0
for _ in $(seq 1 60); do
  if slice "$mark" | grep -q 'viewer-shown'; then present=1; break; fi
  sleep 0.5
done
[ "$present" -eq 1 ] || fail "the termination rehearsal never showed a QR"
wait "$launcher_pid" 2>/dev/null || true
viewer_pid=$(slice "$mark" | sed -n 's/.*viewer-start pid=\([0-9][0-9]*\) .*/\1/p' | tail -n 1)
[ -n "$viewer_pid" ] || fail "the viewer did not log its own pid"
taskkill='/mnt/c/Windows/System32/taskkill.exe'
if [ -x "$taskkill" ]; then
  "$taskkill" /PID "$viewer_pid" /F >/dev/null 2>&1 || true
else
  "$powershell" -NoProfile -Command "Stop-Process -Id $viewer_pid -Force" >/dev/null 2>&1 || true
fi
waited=0
while [ "$waited" -lt 40 ]; do
  slice "$mark" | grep -qE 'viewer-guard (removed-staged|nothing-to-remove)' && break
  sleep 0.5
  waited=$((waited + 1))
done
run5=$(slice "$mark")
printf '%s\n' "$run5" | grep -q 'viewer-guard removed-staged' ||
  fail "the termination guard did not remove the staged copy after a forced kill"
[ ! -e "$staged" ] || fail "a staged QR survived a forced kill"

# ---- rehearsal 6: a timeout with no source must leave no QR ----
mark=$(before)
set +e
bash "$launcher" --source "$work/absent-source.png" --timeout 3 >/dev/null 2>&1
rc6=$?
set -e
run6=$(slice "$mark")
printf '%s\n' "$run6" | grep -q 'viewer-timeout no-qr' ||
  fail "the timeout rehearsal did not report its refusal (exit $rc6)"
[ "$rc6" -eq 3 ] || fail "the timeout rehearsal exited $rc6, expected 3"
[ ! -e "$staged" ] || fail "a staged copy survived the timeout rehearsal"

# ---- rehearsal 7: display is bounded even if the connector stops clearing ----
cp "$fixture" "$work/never-cleared.png"
mark=$(before)
set +e
launcher_out=$(bash "$launcher" --source "$work/never-cleared.png" --timeout 4 2>&1)
rc7=$?
set -e
[ "$rc7" -eq 0 ] ||
  fail "the bounded-display viewer did not present a QR (exit $rc7): $launcher_out"
waited=0
while [ "$waited" -lt 20 ]; do
  slice "$mark" | grep -q 'viewer-closed' && break
  sleep 1
  waited=$((waited + 1))
done
run7=$(slice "$mark")
printf '%s\n' "$run7" | grep -q 'viewer-close display-timeout' ||
  fail "the viewer did not bound its own display time"
printf '%s\n' "$run7" | grep -q 'viewer-closed cleanup=final' ||
  fail "the bounded-display close did not report a clean final cleanup"
[ ! -e "$staged" ] || fail "a staged QR survived the bounded-display rehearsal"
rm -f "$work/never-cleared.png"

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
  "sourceCleared": {"exit": $rc4, "close": "source-cleared",
                    "cleanup": "final", "stagedCopyRemains": False},
  "forcedTermination": {"guard": "removed-staged", "stagedCopyRemains": False},
  "timeout": {"exit": $rc6, "refused": "no-qr", "stagedCopyRemains": False},
  "displayTimeout": {"exit": $rc7, "close": "display-timeout",
                     "cleanup": "final", "stagedCopyRemains": False},
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
