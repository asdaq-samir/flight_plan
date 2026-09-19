#!/usr/bin/env sh
# Reclaim Docker disk while retaining recently used build layers.
#
# Written after the disk filled twice. The rule it follows: remove what a
# rebuild or a re-pull can recreate, never a named volume. vfr_route_pgdata
# holds the application rows and the agent's pgvector memory and is only
# ~170 MB, so there is no size argument for deleting it -- and `docker
# system prune --volumes`, the command everyone reaches for, would.
#
#   sh docker/tidy.sh                     show normal cleanup
#   sh docker/tidy.sh --yes               remove stopped containers and cache unused for 7 days
#   sh docker/tidy.sh --aggressive --yes  also remove unused images and build cache
set -eu

DRY=1
AGGRESSIVE=0

for arg in "$@"; do
    case "$arg" in
        --yes) DRY=0 ;;
        --aggressive) AGGRESSIVE=1 ;;
        *)
            echo "Usage: sh docker/tidy.sh [--aggressive] [--yes]" >&2
            exit 2
            ;;
    esac
done

echo "== before =="
docker system df
echo

if [ "$DRY" = "1" ]; then
    cat <<'MSG'
Dry run. Would remove:
  - stopped containers
  - build-cache entries unused for 7 days

Would KEEP: every named volume and image, plus recently used build-cache
layers so active services keep running and the next build reuses its
dependency cache.

Re-run with --yes to do it.
MSG
    if [ "$AGGRESSIVE" = "1" ]; then
        cat <<'MSG'

Aggressive cleanup would also remove images unused by containers and prune
build cache to 15GB. That reclaims substantially more disk but can make the
next build slow by forcing dependency downloads.
MSG
    fi
    exit 0
fi

docker container prune -f
docker builder prune -a -f --filter "until=168h"

if [ "$AGGRESSIVE" = "1" ]; then
    docker image prune -a -f
    docker builder prune -a -f --max-used-space 15GB
fi

echo
echo "== after =="
docker system df
echo
echo "Host disk:"
df -h /System/Volumes/Data 2>/dev/null | tail -1 || df -h / | tail -1
