#!/usr/bin/env bash
# Rehearse the automatic Windows QR presentation with synthetic fixtures only.
#
# One window is opened for the Owner-facing acceptance: it is shown once, a
# duplicate launch of the same attempt is refused, a rewritten source refreshes
# that window in place, and the connector clearing its source closes it and
# removes the staged copy. Every other lifecycle path runs off-screen or without
# a window at all, so the Owner never sees a stream of synthetic QR dialogs:
#   - off-screen: bounded display, forced termination, attempt handover, and a
#     viewer that must survive the exit of the shell that launched it;
#   - window-less: corrupt/truncated PNG, timeout, stale-owner start refusal,
#     direct guard ownership tests.
# Prints sanitized JSON (no image bytes) for the report.
set -euo pipefail
repo=$(cd "$(dirname "$0")/../.." && pwd)
launcher="$repo/ops/local/launch-qr-viewer.sh"
viewer="$repo/ops/local/qr-viewer.ps1"
guard="$repo/ops/local/qr-viewer-guard.ps1"

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
[ -f "$viewer" ] || fail "the viewer is missing"
[ -f "$guard" ] || fail "the guard is missing"
powershell='/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'
[ -x "$powershell" ] || powershell=$(command -v powershell.exe || true)
[ -n "$powershell" ] && [ -x "$powershell" ] ||
  fail "Windows PowerShell is not reachable from WSL"
taskkill='/mnt/c/Windows/System32/taskkill.exe'
tasklist='/mnt/c/Windows/System32/tasklist.exe'
stage_wsl=$(wslpath -u "$stage")
[ -d "$stage_wsl" ] || fail "the stage directory does not exist: $stage"
log="$stage_wsl/qr-viewer.log"
staged="$stage_wsl/qr.png"
run_file="$stage_wsl/qr-viewer-run.txt"
owner_file="$stage_wsl/qr-viewer-owner.txt"
refresh="$stage_wsl/qr-refresh.tmp"

if [ -z "$fixture" ]; then
  fixture="$stage_wsl/synthetic-fixture.png"
fi
[ -f "$fixture" ] || fail "no synthetic fixture at $fixture"
case "$fixture" in "$staged" | */qr.png) fail "the fixture must not be the staged copy" ;; esac
fixture_sha=$(sha256sum "$fixture" | cut -d' ' -f1)
fixture_bytes=$(stat -c %s "$fixture")

before() { if [ -f "$log" ]; then wc -l <"$log"; else printf '0\n'; fi; }
slice() { [ -f "$log" ] && tail -n "+$(($1 + 1))" "$log" || true; }
origin=$(before)
slice_of() { slice "$origin"; }

# The same rehearsal run must never start with state another run already owns.
for f in "$staged" "$run_file" "$owner_file" "$refresh"; do
  [ ! -e "$f" ] || fail "the stage is not clean: $f exists"
done
leftover=$("$powershell" -NoProfile -Command \
  'Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match "qr-viewer(-guard)?\.ps1" } | ForEach-Object { $_.ProcessId }' \
  2>/dev/null | tr -d '\r' | tr '\n' ' ')
[ -z "${leftover// /}" ] || fail "a viewer or guard is still running: $leftover"

work=$(mktemp -d)
cleanup_all() {
  if [ -f "$log" ]; then
    for pid in $(tail -n "+$((origin + 1))" "$log" 2>/dev/null |
      sed -n 's/.*viewer-start pid=\([0-9][0-9]*\).*/\1/p' | sort -u); do
      "$taskkill" /PID "$pid" /F >/dev/null 2>&1 || true
    done
  fi
  rm -f "$staged" "$run_file" "$owner_file" "$refresh"
  rm -rf "$work"
}
trap cleanup_all EXIT

wait_for() { # fixed-string pattern, mark, attempts of 200 ms
  local pat=$1 mark=$2 limit=${3:-300} i=0
  while [ "$i" -lt "$limit" ]; do
    slice "$mark" | grep -qF -- "$pat" && return 0
    sleep 0.2
    i=$((i + 1))
  done
  return 1
}
count() { slice "$2" | grep -cE -- "$1" || true; }

base="reh-$(date -u +%Y%m%dT%H%M%SZ)-$$"
visible="$base-visible"
bounded="$base-bounded"
killed="$base-killed"
old="$base-old"
new="$base-new"

# A second valid PNG (same picture, a tEXt chunk changes the bytes) so an
# in-place refresh is observable by digest without a second visible image.
python3 - "$fixture" "$work/fixture2.png" <<'PY'
import struct, sys, zlib
src, dst = sys.argv[1], sys.argv[2]
data = open(src, "rb").read()
assert data[:8] == b"\x89PNG\r\n\x1a\n"
iend = data.rfind(b"IEND") - 4
assert iend > 0
payload = b"Comment\x00synthetic-refresh-fixture"
chunk = struct.pack(">I", len(payload)) + b"tEXt" + payload + \
        struct.pack(">I", zlib.crc32(b"tEXt" + payload) & 0xffffffff)
open(dst, "wb").write(data[:iend] + chunk + data[iend:])
PY
fixture2="$work/fixture2.png"
fixture2_sha=$(sha256sum "$fixture2" | cut -d' ' -f1)

# ---- 1. the single visible window: show, duplicate refusal, refresh, close ----
# This is the only window opened for the Owner. Everything below is off-screen
# or window-less, so no second synthetic QR can appear without a deliberate run.
say "opening ONE synthetic QR window (local fixture, not a Zalo code); it will close automatically"
live="$work/live-source.png"
cp "$fixture" "$live"
mark=$(before)
set +e
launcher_out=$(bash "$launcher" --source "$live" --attempt "$visible" --timeout 60 2>&1)
rc_visible=$?
set -e
[ "$rc_visible" -eq 0 ] ||
  fail "the visible viewer did not present a QR (exit $rc_visible): $launcher_out"
wait_for "viewer-staged sha256=$fixture_sha run=$visible" "$mark" 100 ||
  fail "the visible fixture was not staged with its own digest"
wait_for "viewer-shown " "$mark" 100 ||
  fail "no foreground window was reported for the visible fixture"
slice "$mark" | grep -q 'viewer-shown .*visible=True .*offscreen=False .*run='"$visible" ||
  fail "the visible window was not reported as a visible foreground window"
session=$(slice "$mark" | sed -n 's/.*viewer-shown .*session=\([0-9][0-9]*\).*/\1/p' | tail -n 1)
[ -n "$session" ] && [ "$session" != 0 ] ||
  fail "the window was not shown in the interactive desktop session"
image_size=$(slice "$mark" | sed -n 's/.*image=\([0-9][0-9]*x[0-9][0-9]*\).*/\1/p' | tail -n 1)

set +e
duplicate_out=$(bash "$launcher" --source "$live" --attempt "$visible" --timeout 60 2>&1)
rc_duplicate=$?
set -e
[ "$rc_duplicate" -eq 0 ] || fail "the duplicate launch failed (exit $rc_duplicate): $duplicate_out"
printf '%s\n' "$duplicate_out" | grep -q 'already showing its QR; no second window' ||
  fail "a duplicate launch was not refused as a second window: $duplicate_out"
[ "$(count 'viewer-shown ' "$mark")" -eq 1 ] ||
  fail "a duplicate launch created a second window"

# The connector rewriting its QR during the same attempt must refresh in place.
cp "$fixture2" "$work/live.next"
mv -f "$work/live.next" "$live"
wait_for "viewer-refreshed sha256=$fixture2_sha run=$visible" "$mark" 100 ||
  fail "the rewritten source did not refresh the existing window in place"
[ "$(count 'viewer-shown ' "$mark")" -eq 1 ] ||
  fail "a refresh opened a second window instead of updating the first"
[ "$(sha256sum "$staged" 2>/dev/null | cut -d' ' -f1)" = "$fixture2_sha" ] ||
  fail "the staged copy was not updated to the refreshed bytes"

rm -f "$live"
wait_for "viewer-close source-cleared run=$visible" "$mark" 150 ||
  fail "the viewer did not observe the connector clearing its QR"
wait_for "viewer-closed cleanup=final run=$visible" "$mark" 150 ||
  fail "the source-cleared close did not report a clean final cleanup"
slice "$mark" | grep -q "viewer-form-closing staged-copy-removed run=$visible" ||
  fail "the viewer did not remove the staged copy when the source cleared"
[ ! -e "$staged" ] || fail "a staged QR survived the visible rehearsal"
wait_for "viewer-guard " "$mark" 100 || true

# ---- 2. a header-valid but undecodable PNG must not survive (window-less) ----
head -c 33 "$fixture" >"$work/truncated.png"
head -c 128 /dev/zero >>"$work/truncated.png"
mark=$(before)
set +e
bash "$launcher" --fixture "$work/truncated.png" --autoclose 3 --timeout 30 >/dev/null 2>&1
rc_truncated=$?
set -e
[ "$rc_truncated" -eq 4 ] || fail "the truncated PNG exited $rc_truncated, expected 4"
slice "$mark" | grep -q 'viewer-refused undecodable-png' ||
  fail "a header-valid but undecodable PNG was not refused"
[ "$(count 'viewer-shown ' "$mark")" -eq 0 ] ||
  fail "the truncated-PNG rehearsal opened a window"
[ ! -e "$staged" ] || fail "a staged copy survived the truncated-PNG rehearsal"

# ---- 3. a file that is not a PNG must be refused and removed (window-less) ----
printf 'this is not a png\n' >"$work/corrupt.png"
mark=$(before)
set +e
bash "$launcher" --fixture "$work/corrupt.png" --autoclose 3 --timeout 30 >/dev/null 2>&1
rc_corrupt=$?
set -e
[ "$rc_corrupt" -eq 4 ] || fail "the corrupt fixture exited $rc_corrupt, expected 4"
slice "$mark" | grep -q 'viewer-refused invalid-png' ||
  fail "the corrupt fixture was not refused"
[ "$(count 'viewer-shown ' "$mark")" -eq 0 ] ||
  fail "the corrupt-fixture rehearsal opened a window"
[ ! -e "$staged" ] || fail "a staged copy survived the corrupt-fixture rehearsal"

# ---- 4. a timeout with no source must leave no QR (window-less) ----
mark=$(before)
set +e
bash "$launcher" --source "$work/absent-source.png" --timeout 3 >/dev/null 2>&1
rc_timeout=$?
set -e
[ "$rc_timeout" -eq 3 ] || fail "the timeout rehearsal exited $rc_timeout, expected 3"
slice "$mark" | grep -q 'viewer-timeout no-qr' ||
  fail "the timeout rehearsal did not report its refusal"
[ "$(count 'viewer-shown ' "$mark")" -eq 0 ] ||
  fail "the timeout rehearsal opened a window"
[ ! -e "$staged" ] || fail "a staged copy survived the timeout rehearsal"

# ---- 5. display is bounded even if the connector stops clearing (off-screen) ----
cp "$fixture" "$work/bounded-source.png"
mark=$(before)
set +e
launcher_out=$(bash "$launcher" --source "$work/bounded-source.png" --offscreen \
  --attempt "$bounded" --timeout 4 2>&1)
rc_bounded=$?
set -e
[ "$rc_bounded" -eq 0 ] ||
  fail "the bounded-display viewer did not present a QR (exit $rc_bounded): $launcher_out"
wait_for "viewer-close display-timeout run=$bounded" "$mark" 150 ||
  fail "the viewer did not bound its own display time"
wait_for "viewer-closed cleanup=final run=$bounded" "$mark" 150 ||
  fail "the bounded-display close did not report a clean final cleanup"
[ ! -e "$staged" ] || fail "a staged QR survived the bounded-display rehearsal"

# ---- 6. a terminated viewer must leave no QR (off-screen, guard last resort) ----
cp "$fixture" "$work/kill-source.png"
mark=$(before)
set +e
launcher_out=$(bash "$launcher" --source "$work/kill-source.png" --offscreen \
  --attempt "$killed" --timeout 60 2>&1)
rc_killed=$?
set -e
[ "$rc_killed" -eq 0 ] ||
  fail "the termination rehearsal did not present a QR (exit $rc_killed): $launcher_out"
viewer_pid=$(slice "$mark" | sed -n 's/.*viewer-start pid=\([0-9][0-9]*\) .*run='"$killed"'.*/\1/p' | tail -n 1)
[ -n "$viewer_pid" ] || fail "the viewer did not log its own pid"
"$taskkill" /PID "$viewer_pid" /F >/dev/null 2>&1 || true
wait_for "viewer-guard removed-staged run=$killed" "$mark" 200 ||
  fail "the termination guard did not remove the staged copy after a forced kill"
[ ! -e "$staged" ] || fail "a staged QR survived a forced kill"
[ "$(count 'viewer-closed cleanup=final' "$mark")" -eq 0 ] ||
  fail "the forced kill was reported as a clean viewer close"

# ---- 7. a new attempt supersedes an old viewer without showing its QR ----
# Off-screen: the old viewer must close on the ownership change and must never
# refresh to the new session's bytes; the new viewer stages them exactly once.
cp "$fixture" "$work/handover-source.png"
handover="$work/handover-source.png"
mark=$(before)
set +e
launcher_out=$(bash "$launcher" --source "$handover" --offscreen \
  --attempt "$old" --timeout 60 2>&1)
rc_old=$?
set -e
[ "$rc_old" -eq 0 ] ||
  fail "the old attempt did not present a QR (exit $rc_old): $launcher_out"
wait_for "viewer-shown " "$mark" 100 || fail "the old attempt never showed"
bash "$launcher" --source "$handover" --offscreen --attempt "$new" --timeout 60 \
  >"$work/new-launch.out" 2>&1 &
new_launcher=$!
claimed=0
for _ in $(seq 1 100); do
  if [ -f "$owner_file" ] && [ "$(tr -d '\r\n' <"$owner_file")" = "$new" ]; then
    claimed=1
    break
  fi
  sleep 0.1
done
[ "$claimed" -eq 1 ] || fail "the new attempt never claimed the stage"
cp "$fixture2" "$work/handover.next"
mv -f "$work/handover.next" "$handover"
set +e
wait "$new_launcher"
rc_new=$?
set -e
[ "$rc_new" -eq 0 ] ||
  fail "the new attempt did not present a QR (exit $rc_new): $(cat "$work/new-launch.out")"
wait_for "viewer-close superseded run=$old" "$mark" 100 ||
  fail "the superseded viewer did not close on the ownership change"
[ "$(count "viewer-refreshed sha256=$fixture2_sha run=$old" "$mark")" -eq 0 ] ||
  fail "the superseded viewer refreshed to the new attempt's QR"
[ "$(sha256sum "$staged" 2>/dev/null | cut -d' ' -f1)" = "$fixture2_sha" ] ||
  fail "the new attempt is not showing the new session's bytes"
[ "$(count 'viewer-shown .*run='"$old" "$mark")" -eq 1 ] ||
  fail "the old viewer showed more than one window"
[ "$(count 'viewer-shown .*run='"$new" "$mark")" -eq 1 ] ||
  fail "the new viewer did not show exactly one window"
old_close=$(slice "$mark" | grep -nF "viewer-close superseded run=$old" | tail -n 1 | cut -d: -f1)
new_stage=$(slice "$mark" | grep -nE "viewer-(staged sha256=$fixture2_sha|refreshed sha256=$fixture2_sha) run=$new" | head -n 1 | cut -d: -f1)
[ -n "$old_close" ] && [ -n "$new_stage" ] && [ "$old_close" -lt "$new_stage" ] ||
  fail "the new session's QR was staged before the old viewer closed"
rm -f "$handover"
wait_for "viewer-close source-cleared run=$new" "$mark" 150 ||
  fail "the new viewer did not observe its source clearing"
wait_for "viewer-closed cleanup=final run=$new" "$mark" 150 ||
  fail "the new attempt did not report a clean final cleanup"
[ ! -e "$staged" ] || fail "a staged QR survived the attempt handover"

# ---- 8. a viewer that does not own the stage must refuse before staging ----
printf '%s' "$base-other-owner" >"$owner_file"
mark=$(before)
set +e
"$powershell" -NoProfile -ExecutionPolicy Bypass -File "$(wslpath -w "$viewer")" \
  -StageDirectory "$stage" -RunId "$base-mismatch" -TimeoutSeconds 3 \
  >/dev/null 2>&1
rc_mismatch=$?
set -e
[ "$rc_mismatch" -eq 0 ] || fail "the stale viewer exited $rc_mismatch, expected 0"
slice "$mark" | grep -q "viewer-refused superseded owner=$base-other-owner run=$base-mismatch" ||
  fail "a viewer that did not own the stage did not refuse"
[ "$(count 'viewer-shown ' "$mark")" -eq 0 ] ||
  fail "a non-owning viewer opened a window"
[ ! -e "$staged" ] || fail "a non-owning viewer staged a copy"
rm -f "$owner_file"

# ---- 9. the guard must not remove a newer run's copy (window-less) ----
cp "$fixture" "$staged"
printf '%s' "$base-newer-run" >"$run_file"
mark=$(before)
set +e
"$powershell" -NoProfile -ExecutionPolicy Bypass -File "$(wslpath -w "$guard")" \
  -ViewerPid 999999 -RunId "$base-stale-run" -StageDirectory "$stage"
rc_guard_stale=$?
set -e
[ "$rc_guard_stale" -eq 0 ] || fail "the superseded guard exited $rc_guard_stale"
slice "$mark" | grep -q "viewer-guard superseded run=$base-stale-run" ||
  fail "the guard did not leave a newer run's copy alone"
[ -e "$staged" ] || fail "the superseded guard deleted a newer run's copy"
rm -f "$staged" "$run_file"

# ---- 10. the guard removes its own run's copy (window-less) ----
cp "$fixture" "$staged"
printf '%s' "$base-owned-run" >"$run_file"
mark=$(before)
set +e
"$powershell" -NoProfile -ExecutionPolicy Bypass -File "$(wslpath -w "$guard")" \
  -ViewerPid 999999 -RunId "$base-owned-run" -StageDirectory "$stage"
rc_guard_owned=$?
set -e
[ "$rc_guard_owned" -eq 0 ] || fail "the owning guard exited $rc_guard_owned"
slice "$mark" | grep -q "viewer-guard removed-staged run=$base-owned-run" ||
  fail "the guard did not remove its own run's staged copy"
[ ! -e "$staged" ] || fail "the owning guard left a staged copy"
[ ! -e "$run_file" ] || fail "the owning guard left its run id"

# ---- 11. the viewer must outlive the shell that started it ----
# On 2026-11-11 the live QR window closed about a second after it appeared,
# because the WSL shell that started it exited and took its process tree with
# it; the Owner never had time to scan. Start a viewer from a short-lived shell,
# kill that shell's whole process group, and require the window to stay up.
cp "$fixture" "$work/detach-source.png"
detach="$base-detach"
mark=$(before)
setsid bash -c "bash '$launcher' --source '$work/detach-source.png' --offscreen --attempt '$detach' --timeout 30 >/dev/null 2>&1" &
group=$!
wait_for "viewer-shown " "$mark" 150 || fail "the detached viewer never showed its QR"
slice "$mark" | grep -q "viewer-shown .*run=$detach" ||
  fail "the shown window did not belong to the detached attempt"
kill -KILL -- "-$group" 2>/dev/null || true
sleep 2
detach_pid=$(slice "$mark" | sed -n 's/.*viewer-start pid=\([0-9][0-9]*\) .*run='"$detach"'.*/\1/p' | tail -n 1)
[ -n "$detach_pid" ] || fail "the detached viewer did not log its pid"
"$tasklist" /FI "PID eq $detach_pid" /NH 2>/dev/null | tr -d '\r' | grep -q "$detach_pid" ||
  fail "the viewer died when the launching shell's process group was killed"
[ -n "$(find "$run_file" -newermt "@$(( $(date +%s) - 10 ))" -print -quit 2>/dev/null)" ] ||
  fail "the detached viewer stopped heartbeating after the shell exit"
rm -f "$work/detach-source.png"
wait_for "viewer-close source-cleared run=$detach" "$mark" 150 ||
  fail "the detached viewer did not close when its source cleared"
wait_for "viewer-closed cleanup=final run=$detach" "$mark" 150 ||
  fail "the detached viewer did not report a clean close"
[ ! -e "$staged" ] || fail "a staged QR survived the detached-viewer test"

# ---- 12. only one visible window and no image bytes in the log ----
visible_total=$(slice_of | grep -c 'viewer-shown .*offscreen=False' || true)
[ "$visible_total" -eq 1 ] ||
  fail "the rehearsal opened $visible_total visible windows; exactly one was planned"
[ ! -e "$staged" ] || fail "a staged QR survived the rehearsal"
[ ! -e "$refresh" ] || fail "the refresh temp file survived the rehearsal"
longest=$(slice_of | awk '{ if (length($0) > m) m = length($0) } END { print m + 0 }')
[ "$longest" -lt 400 ] || fail "qr-viewer.log has a $longest-byte line; it may contain image data"
leftover=$("$powershell" -NoProfile -Command \
  'Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match "qr-viewer(-guard)?\.ps1" } | ForEach-Object { $_.ProcessId }' \
  2>/dev/null | tr -d '\r' | tr '\n' ' ')
[ -z "${leftover// /}" ] || fail "a viewer or guard is still running: $leftover"

export R_FIX1="$fixture_sha" R_FIX2="$fixture2_sha" R_BYTES="$fixture_bytes"
export R_VIS_ATTEMPT="$visible" R_SESSION="$session" R_IMAGE="$image_size"
export R_VIS_RC="$rc_visible" R_DUP_RC="$rc_duplicate"
export R_TRUNC_RC="$rc_truncated" R_CORRUPT_RC="$rc_corrupt" R_TIMEOUT_RC="$rc_timeout"
export R_BOUNDED_RC="$rc_bounded" R_KILLED_RC="$rc_killed"
export R_OLD_RC="$rc_old" R_NEW_RC="$rc_new" R_LOG_LONGEST="$longest"
python3 - "$out" <<'PY'
import json, os, sys
env = os.environ
report = {
  "fixtureSha256": env["R_FIX1"],
  "fixtureBytes": int(env["R_BYTES"]),
  "secondFixtureSha256": env["R_FIX2"],
  "visibleWindow": 1,
  "singleVisibleWindow": {
    "attempt": env["R_VIS_ATTEMPT"], "exit": int(env["R_VIS_RC"]),
    "shown": 1, "session": int(env["R_SESSION"]), "imageSize": env["R_IMAGE"],
    "offscreen": False, "imageMeta": "synthetic fixture (not a Zalo code)",
    "duplicateLaunchExit": int(env["R_DUP_RC"]), "duplicateWindows": 0,
    "refreshedSha256": env["R_FIX2"], "refreshWindows": 0,
    "close": "source-cleared", "cleanup": "final", "stagedCopyRemains": False,
  },
  "corruptFixture": {"exit": int(env["R_CORRUPT_RC"]), "refused": "invalid-png", "windows": 0},
  "truncatedPng": {"exit": int(env["R_TRUNC_RC"]), "refused": "undecodable-png", "windows": 0},
  "timeout": {"exit": int(env["R_TIMEOUT_RC"]), "refused": "no-qr", "windows": 0},
  "boundedDisplay": {"exit": int(env["R_BOUNDED_RC"]), "offscreen": True,
                     "close": "display-timeout", "cleanup": "final"},
  "forcedTermination": {"exit": int(env["R_KILLED_RC"]), "offscreen": True,
                        "guard": "removed-staged", "viewerReportedClose": False},
  "attemptHandover": {"oldExit": int(env["R_OLD_RC"]), "newExit": int(env["R_NEW_RC"]),
                      "offscreen": True, "oldClose": "superseded",
                      "oldRefreshedNewQr": False, "order": "old-closed-before-new-staged",
                      "newShowingSha256": env["R_FIX2"], "cleanup": "final"},
  "staleViewerStart": {"refused": "superseded", "windows": 0},
  "guardSuperseded": {"leftNewerCopy": True},
  "guardOwned": {"removedStaged": True},
  "detachedLifetime": {"offscreen": True, "survivedProcessGroupKill": True,
                       "close": "source-cleared", "cleanup": "final"},
  "logLongestLine": int(env["R_LOG_LONGEST"]),
  "verdict": "PASS",
}
text = json.dumps(report, indent=1) + "\n"
if sys.argv[1] == "/dev/stdout":
    sys.stdout.write(text)
else:
    open(sys.argv[1], "w", encoding="utf-8").write(text)
    sys.stdout.write(text)
PY
say "all viewer rehearsals passed with exactly one visible window"
