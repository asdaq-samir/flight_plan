#!/usr/bin/env bash
# One heavy run at a time on the owner's Mac -- the browser suite, a stack
# image build, a speed measurement -- however many Claude sessions are at
# work on it. Two suites at once took its four cores to a load of 9 to 11,
# and their tests timed out and had to be run again one by one to tell the
# load from a real failure (2026-10-15). Waits for its turn, says whose turn
# it is, runs the command, and gives the turn back however the command ends.
#
#   scripts/one-at-a-time.sh "<who and what>" <command> [args...]
#
# The turn is a directory (mkdir is atomic), holding the runner's pid and
# label: a turn whose runner has gone -- killed, its shell closed -- is
# taken back by the next in line.
set -u
label=${1:?usage: one-at-a-time.sh "<who and what>" <command> [args...]}
shift
[ $# -gt 0 ] || { echo "one-at-a-time: no command to run" >&2; exit 64; }
lock=${ONE_AT_A_TIME_LOCK:-/tmp/flight-plan-heavy.lock}
# At most this long in line, in seconds: a turn held longer than a suite
# and its reruns take is something wrong to look at, not to wait out.
wait_max=${ONE_AT_A_TIME_WAIT:-2700}
started=$(date +%s)
said=""
while ! mkdir "$lock" 2>/dev/null; do
  holder=$(cat "$lock/owner" 2>/dev/null || true)
  pid=${holder%% *}
  if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
    echo "one-at-a-time: taking back the turn of ${holder#* }, which has gone" >&2
    rm -rf "$lock"
    continue
  fi
  # Made but never named (its runner gone between the two): a minute on, free.
  if [ -z "$holder" ] && [ -n "$(find "$lock" -maxdepth 0 -mmin +1 2>/dev/null)" ]; then
    rm -rf "$lock"
    continue
  fi
  if [ "$holder" != "$said" ]; then
    echo "one-at-a-time: waiting for ${holder#* }" >&2
    said=$holder
  fi
  if [ $(( $(date +%s) - started )) -ge "$wait_max" ]; then
    echo "one-at-a-time: not my turn after ${wait_max}s; giving up (${holder#* } still has it)" >&2
    exit 75
  fi
  sleep 5
done
echo "$$ $label (since $(date +%H:%M))" > "$lock/owner"
trap 'rm -rf "$lock"' EXIT
trap 'exit 130' INT TERM HUP
"$@"
