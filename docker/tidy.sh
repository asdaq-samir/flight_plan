#!/usr/bin/env sh
# Reclaim Docker disk without touching anything you would miss.
#
# Written after the disk filled twice. The rule it follows: remove what a
# rebuild or a re-pull can recreate, never a named volume. vfr_route_pgdata
# holds the application rows and the agent's pgvector memory and is only
# ~170 MB, so there is no size argument for deleting it -- and `docker
# system prune --volumes`, the command everyone reaches for, would.
#
#   sh docker/tidy.sh          show what would be reclaimed
#   sh docker/tidy.sh --yes    actually reclaim it
set -eu

DRY=1
[ "${1:-}" = "--yes" ] && DRY=0

echo "== before =="
docker system df
echo

if [ "$DRY" = "1" ]; then
    cat <<'MSG'
Dry run. Would remove:
  - stopped containers
  - dangling (untagged) images
  - the entire build cache

Would KEEP: every named volume, and every tagged image.

Re-run with --yes to do it.
MSG
    exit 0
fi

# Build cache first: it is almost always the largest term and the least
# missed. `docker system df` under-reports it -- it showed 1.7 GB when a
# prune returned 28.8 GB -- so do not use that number to decide.
docker builder prune -af
docker container prune -f
docker image prune -f

echo
echo "== after =="
docker system df
echo
echo "Host disk:"
df -h /System/Volumes/Data 2>/dev/null | tail -1 || df -h / | tail -1
