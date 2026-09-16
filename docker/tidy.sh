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
  - build cache older than 72h, or however much exceeds 15GB

Would KEEP: every named volume, every tagged image, and recent build
cache -- so the next build still hits cache instead of starting over.

Re-run with --yes to do it.
MSG
    exit 0
fi

# Build cache first: it is almost always the largest term and the least
# missed. `docker system df` under-reports it -- it showed 1.7 GB when a
# prune returned 28.8 GB -- so do not use that number to decide.
#
# Not `-af` (that wipes the cache down to nothing, so the very next
# build re-downloads and re-installs everything from scratch instead of
# hitting a single cached layer -- discovered the hard way when a
# `pip install` that normally takes seconds took 40). An age/size filter
# keeps cache still backing a recent build, and only evicts what's
# actually stale or over budget.
#
# `--keep-storage` silently deprecated to `--max-used-space` (the
# buildx-based prune now underneath `docker builder prune`) -- the old
# flag name still "succeeds" but reclaims nothing, which is worse than
# an error since nothing announces it stopped working.
docker builder prune -f --filter until=72h --max-used-space 15GB
docker container prune -f
docker image prune -f

echo
echo "== after =="
docker system df
echo
echo "Host disk:"
df -h /System/Volumes/Data 2>/dev/null | tail -1 || df -h / | tail -1
