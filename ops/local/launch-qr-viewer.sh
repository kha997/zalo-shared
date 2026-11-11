#!/usr/bin/env bash
# Start the Windows QR viewer automatically, from WSL, and wait until it has
# staged the QR. The Owner never has to locate qr.png or run a command.
# It prints no image bytes and makes no network request.
set -euo pipefail
repo=$(cd "$(dirname "$0")/../.." && pwd)

fixture=''
autoclose=0
timeout=300
stage='C:\Users\Admin\pilot-private-qr'
source=''
while [ $# -gt 0 ]; do
  case "$1" in
    --fixture) fixture=${2:?}; shift 2 ;;
    --autoclose) autoclose=${2:?}; shift 2 ;;
    --timeout) timeout=${2:?}; shift 2 ;;
    --stage) stage=${2:?}; shift 2 ;;
    # Rehearsal only: watch a synthetic WSL file instead of the private view
    # directory, so the source-cleared close path can be exercised.
    --source) source=${2:?}; shift 2 ;;
    *) printf 'qr-launcher: REFUSED unknown argument %s\n' "$1" >&2; exit 2 ;;
  esac
done

say() { printf 'qr-launcher: %s\n' "$*"; }
fail() { printf 'qr-launcher: REFUSED %s\n' "$*" >&2; exit 4; }

powershell='/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'
[ -x "$powershell" ] || powershell=$(command -v powershell.exe || true)
[ -n "$powershell" ] && [ -x "$powershell" ] || fail "Windows PowerShell is not reachable from WSL"

script=$(wslpath -w "$repo/ops/local/qr-viewer.ps1")
[ -f "$repo/ops/local/qr-viewer.ps1" ] || fail "the viewer script is missing"

stage_wsl=$(wslpath -u "$stage" 2>/dev/null || true)
case "$stage_wsl" in /mnt/[a-z]/*) ;; *) fail "the stage directory is not on a Windows drive" ;; esac
log="$stage_wsl/qr-viewer.log"
mkdir -p "$stage_wsl"

# Serialise launches so two starts cannot sweep or stage at the same time. The
# lock covers the launch window only; a live viewer is recognised afterwards by
# its fresh run file (qr-viewer.ps1 heartbeats it every poll).
if command -v flock >/dev/null 2>&1; then
  exec 9>"$stage_wsl/qr-viewer.lock"
  flock -w 30 9 || fail "another viewer launch is in progress"
fi

# A copy left by a viewer that was killed with its guard (logoff, power loss)
# must not sit on disk until someone notices. Sweep it before starting a new
# run, unless a fresh run file says a viewer may still own it.
run_file="$stage_wsl/qr-viewer-run.txt"
if [ -f "$stage_wsl/qr.png" ]; then
  if [ -f "$run_file" ] && [ -n "$(find "$run_file" -mmin -1 -print -quit 2>/dev/null)" ]; then
    say "a recent run file is present; leaving its staged copy to that run"
  else
    rm -f "$stage_wsl/qr.png"
    printf 'qr-launcher: swept a stale staged copy\n' >&2
  fi
fi

before=0
[ -f "$log" ] && before=$(wc -l <"$log")

args=(-NoProfile -ExecutionPolicy Bypass -File "$script" -TimeoutSeconds "$timeout" -StageDirectory "$stage")
if [ -n "$fixture" ]; then
  [ -f "$fixture" ] || fail "the fixture does not exist: $fixture"
  args+=(-FixturePath "$(wslpath -w "$fixture")")
fi
if [ -n "$source" ]; then
  # The viewer hands this path to `wsl.exe` as a root shell argument.
  case "$source" in /*) ;; *) fail "the source must be an absolute WSL path" ;; esac
  case "$source" in *[!A-Za-z0-9._/-]*) fail "the source contains characters the viewer refuses" ;; esac
  args+=(-SourcePath "$source")
fi
[ "$autoclose" -gt 0 ] && args+=(-AutoCloseSeconds "$autoclose")

"$powershell" "${args[@]}" >/dev/null 2>&1 &
viewer_pid=$!
say "started the viewer (wrapper pid $viewer_pid) for stage $stage"

deadline=$((SECONDS + timeout + 20))
while [ "$SECONDS" -lt "$deadline" ]; do
  if [ -f "$log" ]; then
    new=$(tail -n "+$((before + 1))" "$log")
    if printf '%s\n' "$new" | grep -qE 'viewer-(refused|timeout)'; then
      printf '%s\n' "$new" | grep -E 'viewer-(refused|timeout)' >&2
      exit "$(printf '%s\n' "$new" | grep -qE 'viewer-refused' && echo 4 || echo 3)"
    fi
    # A window raised in a non-interactive session (0) is invisible to the
    # Owner, so that is a refusal even though the viewer itself succeeded.
    if printf '%s\n' "$new" | grep -qE 'viewer-session id=0 interactive=False'; then
      fail "the viewer started in a non-interactive session and its window cannot reach the Owner desktop"
    fi
    if printf '%s\n' "$new" | grep -q 'viewer-staged' &&
       printf '%s\n' "$new" | grep -q 'viewer-shown'; then
      session=$(printf '%s\n' "$new" | sed -n 's/.*viewer-shown .*session=\([0-9][0-9]*\).*/\1/p' | tail -n 1)
      say "QR staged and shown in a foreground window (session ${session:-unknown})"
      exit 0
    fi
  fi
  if ! kill -0 "$viewer_pid" 2>/dev/null; then
    sleep 1
    new=$(tail -n "+$((before + 1))" "$log" 2>/dev/null || true)
    if printf '%s\n' "$new" | grep -q 'viewer-staged' && printf '%s\n' "$new" | grep -q 'viewer-shown'; then
      say "QR staged and shown in a foreground window"
      exit 0
    fi
    fail "the viewer exited before presenting a QR"
  fi
  sleep 0.3
done
fail "the viewer did not present a QR within ${timeout}s"
