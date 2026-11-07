#!/usr/bin/env bash
# Heavy runs on the owner's Mac take turns -- a test suite, an image build,
# a browser run, a speed measurement -- however many Claude sessions are at
# work on it. On the 2016 MacBook (four cores) two suites at once took the
# load to 9 to 11 and their tests timed out (2026-10-15), so there was one
# turn. The Mac mini (12 cores, Docker given 16 GB) runs a few at once: the
# owner asked to make full use of it (2026-11-06), so there are
# ONE_AT_A_TIME_SLOTS turns (4 by default). A speed measurement needs a quiet
# machine: `--alone` waits until no other turn is held and then holds them
# all. Waits for its turn, says whose turn it is, runs the command, and gives
# the turn back however the command ends.
#
#   scripts/one-at-a-time.sh [--alone] "<who and what>" <command> [args...]
#
# Each turn is a directory (mkdir is atomic) holding the runner's pid and
# label: a turn whose runner has gone -- killed, its shell closed -- is
# taken back by the next in line. The first turn is the lock's own path, as
# the one-turn script had it, so a copy of the old script in another
# checkout still holds a turn the new one sees.
set -u
alone=${ONE_AT_A_TIME_ALONE:-}
if [ "${1:-}" = "--alone" ]; then alone=1; shift; fi
label=${1:?usage: one-at-a-time.sh [--alone] "<who and what>" <command> [args...]}
shift
[ $# -gt 0 ] || { echo "one-at-a-time: no command to run" >&2; exit 64; }
lock=${ONE_AT_A_TIME_LOCK:-/tmp/flight-plan-heavy.lock}
slots=${ONE_AT_A_TIME_SLOTS:-4}
# At most this long in line, in seconds: a turn held longer than a suite
# and its reruns take is something wrong to look at, not to wait out.
wait_max=${ONE_AT_A_TIME_WAIT:-2700}
started=$(date +%s)
said=""
held=()
# In line in the order asked, not whoever looks first as a turn ends: a
# ticket each, named by when it was taken, and the next turn goes to the
# oldest whose runner is still there. Without it two sessions' agents,
# asking every five seconds, took turn after turn while the other session's
# run waited 40 minutes and more, twice (2026-10-28). It also keeps an
# `--alone` run from waiting for ever behind a stream of short ones: while it
# is first in line, no one behind it takes a turn.
line="$lock.line"
mkdir -p "$line"
ticket="$line/$(date +%s)$(printf '%05d' $((RANDOM % 100000))).$$"
: > "$ticket"
release() { local d; for d in "${held[@]+"${held[@]}"}"; do rm -rf "$d"; done; rm -f "$ticket"; }
trap release EXIT
trap 'exit 130' INT TERM HUP

slot() { if [ "$1" -eq 1 ]; then echo "$lock"; else echo "$lock.$1"; fi; }

first_in_line() {
  local t pid
  for t in $(ls "$line" 2>/dev/null | sort); do
    pid=${t##*.}
    if ! kill -0 "$pid" 2>/dev/null; then rm -f "$line/$t"; continue; fi
    [ "$line/$t" = "$ticket" ] && return 0
    return 1
  done
  return 0
}

# A turn whose runner has gone is free again; so is one made but never
# named (its runner gone between the two), a minute on.
reclaim() {
  local dir=$1 holder pid
  [ -d "$dir" ] || return 0
  holder=$(cat "$dir/owner" 2>/dev/null || true)
  pid=${holder%% *}
  if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
    echo "one-at-a-time: taking back the turn of ${holder#* }, which has gone" >&2
    rm -rf "$dir"
  elif [ -z "$holder" ] && [ -n "$(find "$dir" -maxdepth 0 -mmin +1 2>/dev/null)" ]; then
    rm -rf "$dir"
  fi
}

name() { echo "$$ $label (since $(date +%H:%M))" > "$1/owner"; }

# One free turn, or with --alone every turn; gives back what it took when it
# cannot have all it needs.
take() {
  local i dir
  for i in $(seq 1 "$slots"); do reclaim "$(slot "$i")"; done
  if [ -n "$alone" ]; then
    for i in $(seq 1 "$slots"); do
      dir=$(slot "$i")
      if mkdir "$dir" 2>/dev/null; then name "$dir"; held+=("$dir"); else
        for dir in "${held[@]+"${held[@]}"}"; do rm -rf "$dir"; done
        held=()
        return 1
      fi
    done
    return 0
  fi
  for i in $(seq 1 "$slots"); do
    dir=$(slot "$i")
    if mkdir "$dir" 2>/dev/null; then name "$dir"; held=("$dir"); return 0; fi
  done
  return 1
}

holders() {
  local i o
  for i in $(seq 1 "$slots"); do
    if [ -d "$(slot "$i")" ]; then o=$(cat "$(slot "$i")/owner" 2>/dev/null || true); echo "${o#* }"; fi
  done | paste -sd ';' -
}

while ! { first_in_line && take; }; do
  if ! first_in_line; then
    now="line"
    msg="in line behind $(( $(ls "$line" | sort | sed -n "/$(basename "$ticket")/=" ) - 1 )) earlier"
  else
    now="busy:$(holders)"
    msg="waiting for ${now#busy:}${alone:+ (alone: for every turn to be free)}"
  fi
  if [ "$now" != "$said" ]; then echo "one-at-a-time: $msg" >&2; said=$now; fi
  if [ $(( $(date +%s) - started )) -ge "$wait_max" ]; then
    echo "one-at-a-time: not my turn after ${wait_max}s; giving up ($msg)" >&2
    exit 75
  fi
  sleep 5
done
rm -f "$ticket"
"$@"
