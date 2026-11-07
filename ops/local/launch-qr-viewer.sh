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
while [ $# -gt 0 ]; do
  case "$1" in
    --fixture) fixture=${2:?}; shift 2 ;;
    --autoclose) autoclose=${2:?}; shift 2 ;;
    --timeout) timeout=${2:?}; shift 2 ;;
    --stage) stage=${2:?}; shift 2 ;;
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
before=0
[ -f "$log" ] && before=$(wc -l <"$log")

args=(-NoProfile -ExecutionPolicy Bypass -File "$script" -TimeoutSeconds "$timeout")
if [ -n "$fixture" ]; then
  [ -f "$fixture" ] || fail "the fixture does not exist: $fixture"
  args+=(-FixturePath "$(wslpath -w "$fixture")")
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
