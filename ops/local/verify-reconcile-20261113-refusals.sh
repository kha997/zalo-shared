#!/usr/bin/env bash
# Offline refusal tests for ops/local/reconcile-20261113.sh.
# Every case must fail before the wrapper reaches `docker stop`; after each case
# the deployed app, the fence and the audit table are re-read.
#
# Run as the pilot user on the pilot host: the wrapper is invoked in execute
# mode with fixtures for the window, the request and the attempt marker, and
# every case must be refused. Nothing is stopped, sent or reconciled.
set -uo pipefail
repo=/home/zen/Projects/zalo-shared
state=$HOME/pilot-private/zalo-shared/pilot-admin
w=$repo/ops/local/reconcile-20261113.sh
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
chmod 0700 "$tmp"

pass=0; failn=0
ck() { if [ "$2" = "$3" ]; then printf 'PASS %s (%s)\n' "$1" "$3"; pass=$((pass+1)); else printf 'FAIL %s (expected [%s] got [%s])\n' "$1" "$2" "$3"; failn=$((failn+1)); fi; }
dbq() { docker exec pilot-postgres psql -U zs_owner -d zalo -At -v ON_ERROR_STOP=1 -c "$1"; }
fence() { dbq "SELECT phase||'|'||epoch||'|'||coalesce(owner_id::text,'')||'|'||coalesce(fault_code,'')||'|'||coalesce(to_char(uncertain_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS'),'')||'|'||coalesce(last_fenced_owner_id::text,'')||'|'||coalesce(last_fenced_epoch::text,'') FROM connector_ownership"; }
audit() { dbq "SELECT count(*)||'|'||coalesce(max(id),0) FROM audit"; }
invariant() {
  local tag=$1
  ck "$tag: the app was not stopped" running "$(docker inspect -f '{{.State.Status}}' zalo-shared-pilot-app-1)"
  ck "$tag: the fence did not move" "$fence_before" "$(fence)"
  ck "$tag: the audit table did not change" "$audit_before" "$(audit)"
  ck "$tag: no real attempt marker" absent "$([ -e "$state/reconcile-attempt-20261113.json" ] && echo present || echo absent)"
  ck "$tag: no one-shot container" "" "$(docker ps -a --format '{{.Names}}' | grep -x pilot-reconcile-app || true)"
}

fence_before=$(fence)
audit_before=$(audit)
now=$(date -u +%s)
ts() { date -u -d "@$1" +%Y-%m-%dT%H:%M:%SZ; }
mkwin() { # path start end ref
  printf '{"notBefore":"%s","notAfter":"%s","authorizationRef":"%s"}\n' "$2" "$3" "$4" >"$1"
  chmod 0600 "$1"
}
ref=G5A-OWNER-AUTH-2026-11-13-RECONCILIATION
mkwin "$tmp/expired.json" "$(ts $((now-3600)))" "$(ts $((now-600)))" "$ref"
mkwin "$tmp/future.json" "$(ts $((now+3600)))" "$(ts $((now+4200)))" "$ref"
mkwin "$tmp/open.json" "$(ts $((now-60)))" "$(ts $((now+1200)))" "$ref"
mkwin "$tmp/wrongref.json" "$(ts $((now-60)))" "$(ts $((now+1200)))" G5A-OWNER-AUTH-2026-11-11-RECONCILIATION

run() { local out=$1; shift; env "$@" bash "$w" "${MODE:-execute}" >"$out" 2>&1; echo $?; }

printf 'reconcile-20261113-tests: baseline fence=%s audit=%s\n' "$fence_before" "$audit_before"

s=$(run "$tmp/noconfirm.out" -u PILOT_RECONCILE_CONFIRM)
ck "no confirmation is refused" 3 "$s"
ck "no confirmation names the guard" "PILOT_RECONCILE_CONFIRM=ONE_SHOT is required" "$(grep -o 'PILOT_RECONCILE_CONFIRM=ONE_SHOT is required' "$tmp/noconfirm.out")"
invariant "no-confirm"

s=$(run "$tmp/nowindow.out" -u PILOT_RECONCILE_WINDOW_FILE PILOT_RECONCILE_CONFIRM=ONE_SHOT)
ck "a missing window file is refused" 3 "$s"
ck "a missing window reports window-missing" '"outcome":"window-missing"' "$(grep -o '"outcome":"window-missing"' "$tmp/nowindow.out")"
invariant "no-window"

s=$(run "$tmp/expired.out" PILOT_RECONCILE_CONFIRM=ONE_SHOT PILOT_RECONCILE_WINDOW_FILE="$tmp/expired.json")
ck "an expired window is refused" 2 "$s"
ck "an expired window reports expiry" '"outcome":"expired"' "$(grep -o '"outcome":"expired"' "$tmp/expired.out")"
ck "an expired window returns the expiry token" G5A_RECONCILIATION_AUTHORIZATION_EXPIRED "$(grep -o 'G5A_RECONCILIATION_AUTHORIZATION_EXPIRED' "$tmp/expired.out")"
invariant "expired"

s=$(run "$tmp/future.out" PILOT_RECONCILE_CONFIRM=ONE_SHOT PILOT_RECONCILE_WINDOW_FILE="$tmp/future.json")
ck "a not-yet-open window is refused" 2 "$s"
ck "a not-yet-open window reports outside-window" '"outcome":"outside-window"' "$(grep -o '"outcome":"outside-window"' "$tmp/future.out")"
invariant "outside-window"

s=$(run "$tmp/wrongref.out" PILOT_RECONCILE_CONFIRM=ONE_SHOT PILOT_RECONCILE_WINDOW_FILE="$tmp/wrongref.json")
ck "a window bound to another authorization is refused" 3 "$s"
ck "the mismatch names the authorization reference" "the window authorization reference does not match the prepared request" "$(grep -o 'the window authorization reference does not match the prepared request' "$tmp/wrongref.out")"
invariant "wrong-ref"

( flock -n 9; sleep 6 ) 9>"$state/reconcile-20261113.lock" &
lock_holder=$!
sleep 0.5
MODE=preflight
s=$(run "$tmp/lock.out" -u PILOT_RECONCILE_CONFIRM)
unset MODE
wait "$lock_holder" 2>/dev/null || true
ck "a concurrent invocation is refused by the host lock" 3 "$s"
ck "the lock refusal is explicit" '"outcome":"concurrent-invocation"' "$(grep -o '"outcome":"concurrent-invocation"' "$tmp/lock.out")"
invariant "host-lock"

printf '{"outcome":"started"}\n' >"$tmp/fixture-attempt.json"
chmod 0600 "$tmp/fixture-attempt.json"
s=$(run "$tmp/attempt.out" PILOT_RECONCILE_CONFIRM=ONE_SHOT PILOT_RECONCILE_WINDOW_FILE="$tmp/open.json" PILOT_RECONCILE_ATTEMPT_FILE="$tmp/fixture-attempt.json")
ck "a recorded attempt blocks a second run" 3 "$s"
ck "the duplicate refusal is explicit" '"outcome":"already-attempted"' "$(grep -o '"outcome":"already-attempted"' "$tmp/attempt.out")"
invariant "duplicate-attempt"

python3 - "$state/reconcile-request-2026-11-13.json" "$tmp" <<'PY'
import json, os, shutil, sys
src, tmp = sys.argv[1], sys.argv[2]
base = json.load(open(src))
cases = {
    "owner": ("body", "expectedOwnerId", "00000000-0000-4000-8000-000000000000"),
    "epoch": ("body", "expectedOwnerEpoch", "10"),
    "gap": ("body", "expectedGapVersion", "10"),
    "notsent": ("top", "notSent", False),
    "approved": ("body", "confirmOwnerApproved", False),
    "requestid": ("body", "requestId", "not-a-uuid"),
}
for name, (where, key, value) in cases.items():
    d = json.loads(json.dumps(base))
    (d["body"] if where == "body" else d)[key] = value
    path = os.path.join(tmp, f"request-{name}.json")
    json.dump(d, open(path, "w"), indent=2)
    os.chmod(path, 0o600)
PY
for case in owner epoch gap notsent approved requestid; do
  s=$(run "$tmp/tamper-$case.out" PILOT_RECONCILE_CONFIRM=ONE_SHOT PILOT_RECONCILE_WINDOW_FILE="$tmp/open.json" PILOT_RECONCILE_REQUEST_FILE="$tmp/request-$case.json")
  ck "a tampered request is refused before the window ($case)" 3 "$s"
  ck "the tampered request names the guard ($case)" yes "$(grep -q 'reconcile-20261113: FAIL' "$tmp/tamper-$case.out" && echo yes || echo no)"
  ck "the tampered request was refused early ($case)" "" "$(grep -o '"outcome"' "$tmp/tamper-$case.out")"
  invariant "tamper-$case"
done

cp "$state/reconcile-request-2026-11-13.json" "$tmp/request-mode.json"
chmod 0644 "$tmp/request-mode.json"
s=$(run "$tmp/mode.out" PILOT_RECONCILE_CONFIRM=ONE_SHOT PILOT_RECONCILE_WINDOW_FILE="$tmp/open.json" PILOT_RECONCILE_REQUEST_FILE="$tmp/request-mode.json")
ck "a request file with broad permissions is refused" 3 "$s"
ck "the permission refusal is explicit" "the prepared request file is not 0600 and owned by the invoking user" "$(grep -o 'the prepared request file is not 0600 and owned by the invoking user' "$tmp/mode.out")"
invariant "request-mode"

docker run --rm --network none --user "$(id -u):$(id -g)" --read-only \
  --entrypoint /nodejs/bin/node \
  -v "$state:/run/pilot-admin:ro" \
  zalo-shared:g5-patched-af2be54 \
  -e "process.exit(require('node:fs').existsSync('/run/pilot-admin/admin.env')?0:1)" >/dev/null 2>&1
ck "the one-shot mount exposes the credential to the invoking uid" 0 "$?"

printf 'reconcile-20261113-tests: %s passed, %s failed\n' "$pass" "$failn"
[ "$failn" = 0 ]
