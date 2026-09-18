#!/usr/bin/env sh
# Reclaim Docker disk without touching running services or named volumes.
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
  - images unused by any container, including tagged images
  - unused build cache until no more than 15GB remains

Would KEEP: every named volume, every image used by a container, and
recent build cache -- so active services keep running and the next build
still hits cache instead of starting over.

Re-run with --yes to do it.
MSG
    exit 0
fi

# Prune inactive images before cache: deleting an image releases its tagged
# layers into the build cache. Enforcing the cache budget first can therefore
# miss most reclaimable storage.
#
# `-a` removes any image unused by a container, whether it is tagged or not.
# It never removes images backing the active stack and it never touches volumes;
# removed images can be rebuilt or re-pulled later.
docker image prune -a -f

# Build cache is almost always the largest remaining term and the least missed.
# `docker system df` under-reports it -- it showed 1.7 GB when a prune returned
# 28.8 GB -- so do not use that number to decide.
#
# `-a` includes all unused cache, not just dangling cache; without it,
# Docker leaves the large cache entries this script is meant to control.
# `--max-used-space` keeps a 15GB cache budget instead of wiping cache down
# to nothing, so the next build can still reuse recent layers.
#
# `--keep-storage` silently deprecated to `--max-used-space` (the
# buildx-based prune now underneath `docker builder prune`) -- the old
# flag name still "succeeds" but reclaims nothing, which is worse than
# an error since nothing announces it stopped working.
docker builder prune -a -f --max-used-space 15GB
docker container prune -f

echo
echo "== after =="
docker system df
echo
echo "Host disk:"
df -h /System/Volumes/Data 2>/dev/null | tail -1 || df -h / | tail -1
