#!/usr/bin/env bash
# Start the Windows QR viewer automatically, from WSL, and wait until it has
# staged the QR. The Owner never has to locate qr.png or run a command.
# It prints no image bytes and makes no network request.
#
# One live attempt gets one window. Two launches that carry the same --attempt
# id are the same attempt: the second returns without opening anything. A new
# attempt carries a new id; the launcher hands ownership over, waits for the old
# viewer to close, sweeps its copy and only then starts the new window.
set -euo pipefail
repo=$(cd "$(dirname "$0")/../.." && pwd)

fixture=''
autoclose=0
timeout=300
stage='C:\Users\Admin\pilot-private-qr'
source=''
attempt=''
offscreen=0
while [ $# -gt 0 ]; do
  case "$1" in
    --fixture) fixture=${2:?}; shift 2 ;;
    --autoclose) autoclose=${2:?}; shift 2 ;;
    --timeout) timeout=${2:?}; shift 2 ;;
    --stage) stage=${2:?}; shift 2 ;;
    # Rehearsal only: watch a synthetic WSL file instead of the private view
    # directory, so the source-cleared and refresh paths can be exercised.
    --source) source=${2:?}; shift 2 ;;
    # The attempt identity. Duplicate launches of one attempt share it.
    --attempt) attempt=${2:?}; shift 2 ;;
    # Rehearsal only: keep the window off every desktop. A live attempt never
    # passes this, and it is refused unless a fixture or rehearsal source is set.
    --offscreen) offscreen=1; shift ;;
    *) printf 'qr-launcher: REFUSED unknown argument %s\n' "$1" >&2; exit 2 ;;
  esac
done

say() { printf 'qr-launcher: %s\n' "$*"; }
fail() { printf 'qr-launcher: REFUSED %s\n' "$*" >&2; exit 4; }

case "$attempt" in
  *[!A-Za-z0-9._-]*) fail "the attempt id may contain only letters, digits, dot, underscore and dash" ;;
esac
[ "${#attempt}" -le 64 ] || fail "the attempt id is longer than 64 characters"

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

owner_file="$stage_wsl/qr-viewer-owner.txt"
run_file="$stage_wsl/qr-viewer-run.txt"
staged="$stage_wsl/qr.png"
owner=''
[ -f "$owner_file" ] && owner=$(tr -d '\r\n' <"$owner_file" 2>/dev/null || true)

# A viewer heartbeats its run file every poll. Touched within 10 s means a live
# window owns the stage; untouched for 60 s means the run and its guard are gone.
fresh_run() {
  [ -f "$run_file" ] && [ -n "$(find "$run_file" -newermt "@$(( $(date +%s) - 10 ))" -print -quit 2>/dev/null)" ]
}
stale_run() {
  [ ! -f "$run_file" ] || [ -z "$(find "$run_file" -newermt "@$(( $(date +%s) - 60 ))" -print -quit 2>/dev/null)" ]
}
# The owner file is written just before the viewer starts, so a just-launched
# run is recognised even before its first heartbeat.
fresh_owner() {
  [ -f "$owner_file" ] && [ -n "$(find "$owner_file" -newermt "@$(( $(date +%s) - 20 ))" -print -quit 2>/dev/null)" ]
}

before=0
[ -f "$log" ] && before=$(wc -l <"$log")

# The same attempt must never open a second window, whatever called us again.
if [ -n "$attempt" ] && [ "$owner" = "$attempt" ] && { fresh_run || fresh_owner; }; then
  say "attempt $attempt is already showing its QR; no second window"
  exit 0
fi
if [ -z "$attempt" ] && [ -n "$owner" ] && { fresh_run || fresh_owner; }; then
  say "attempt $owner is already showing its QR; no second window"
  exit 0
fi

# No attempt id: this is the first launch of a new attempt.
if [ -z "$attempt" ]; then
  attempt="auto-$(date -u +%Y%m%dT%H%M%SZ)-$$"
fi

# A different live attempt is superseded: hand over ownership and wait for the
# old viewer to close on its next tick before touching the stage. A dead owner
# is not waited for; its leftovers are swept below.
if [ -n "$owner" ] && [ "$owner" != "$attempt" ] && { fresh_run || fresh_owner; }; then
  say "superseding attempt $owner"
  printf '%s' "$attempt" >"$owner_file.tmp.$$"
  mv -f "$owner_file.tmp.$$" "$owner_file"
  deadline=$((SECONDS + 15))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if [ -f "$log" ] && tail -n "+$((before + 1))" "$log" | grep -q 'viewer-close superseded'; then
      break
    fi
    [ ! -f "$run_file" ] && break
    sleep 0.2
  done
  # The superseded viewer logs its close before it removes its run file and its
  # copy, so give that cleanup a short grace period before deciding it is stuck.
  for _ in $(seq 1 25); do
    [ ! -f "$run_file" ] && break
    sleep 0.2
  done
  if [ -f "$run_file" ] && fresh_run; then
    fail "the previous viewer (attempt $owner) did not release the stage"
  fi
  # The superseded viewer removes its own copy; give it a moment to finish.
  for _ in $(seq 1 10); do
    [ ! -f "$staged" ] && break
    sleep 0.2
  done
  if [ -f "$staged" ]; then
    rm -f "$staged" || fail "the superseded staged copy could not be removed"
    printf 'qr-launcher: swept a superseded staged copy\n' >&2
  fi
fi

# A copy left by a viewer that was killed with its guard (logoff, power loss)
# must not sit on disk until someone notices. Sweep it before starting a new
# run, unless a fresh run file says a viewer may still own it.
if [ -f "$staged" ]; then
  if [ -n "$owner" ] && [ "$owner" = "$attempt" ] && ! stale_run; then
    say "a recent run file is present; leaving its staged copy to that run"
  else
    rm -f "$staged"
    printf 'qr-launcher: swept a stale staged copy\n' >&2
  fi
fi

printf '%s' "$attempt" >"$owner_file.tmp.$$"
mv -f "$owner_file.tmp.$$" "$owner_file"

args=(-NoProfile -ExecutionPolicy Bypass -File "$script" -TimeoutSeconds "$timeout" -StageDirectory "$stage" -RunId "$attempt")
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
if [ "$offscreen" -eq 1 ]; then
  [ -n "$fixture" ] || [ -n "$source" ] ||
    fail "offscreen is a rehearsal mode and requires a fixture or a rehearsal source"
  args+=(-Offscreen)
fi

# 9>&- keeps the viewer from inheriting the launch lock; otherwise the lock
# would stay held by the live window and every later launch would be refused.
"$powershell" "${args[@]}" 9>&- >/dev/null 2>&1 &
viewer_pid=$!
say "started the viewer (wrapper pid $viewer_pid, attempt $attempt) for stage $stage"

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
      say "QR staged and shown in a foreground window (session ${session:-unknown}, attempt $attempt)"
      exit 0
    fi
  fi
  if ! kill -0 "$viewer_pid" 2>/dev/null; then
    sleep 1
    new=$(tail -n "+$((before + 1))" "$log" 2>/dev/null || true)
    if printf '%s\n' "$new" | grep -q 'viewer-staged' && printf '%s\n' "$new" | grep -q 'viewer-shown'; then
      say "QR staged and shown in a foreground window (attempt $attempt)"
      exit 0
    fi
    fail "the viewer exited before presenting a QR"
  fi
  sleep 0.3
done
fail "the viewer did not present a QR within ${timeout}s"
