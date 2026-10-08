#!/usr/bin/env bash
# Rehearses the production stack on this machine
# (docker-compose.rehearsal.yml): builds the four images the server runs,
# seeds a data folder as deploy.sh does, writes a .env of its own and
# starts docker-compose.prod.yml with the rehearsal's stand-ins for
# CloudFront and SES, as the project "wingtip-prod" beside the
# development stack. Then:
#   https://localhost:9443/app/plan   the app, through the CDN stand-in
#                                     (accept Caddy's local certificate)
#   http://localhost:9025             the sign-in mail
#
# REHEARSAL_DIR  where its data and .env live (~/.wingtip-rehearsal)
# TILES_DIR      a chart pyramid to serve as the S3 bucket
#                (this checkout's data/raw/chart_tiles.nosync)
# SKIP_BUILD=1   use the images already built
# ANTHROPIC_API_KEY, else this checkout's .env's: for briefings and notes
#
# Stop it with: docker compose -p wingtip-prod down   (add -v to forget it)
set -euo pipefail
cd "$(dirname "$0")/../.."
export REHEARSAL_DIR=${REHEARSAL_DIR:-$HOME/.wingtip-rehearsal}
export TILES_DIR=${TILES_DIR:-$PWD/data/raw/chart_tiles.nosync}

if [ "${SKIP_BUILD:-}" != 1 ]; then
  docker build -t wingtip-local/model-service:rehearsal model-service
  for service in nav-log-agent planning-service; do
    docker build -t "wingtip-local/$service:rehearsal" -f "$service/Dockerfile" .
  done
  docker build -t wingtip-local/webapp:rehearsal -f springboot-app/Dockerfile .
fi

# deploy.sh's seeds: the notes so far and the corridor the planner warms
# up on, copied once.
for dir in labels processed; do
  mkdir -p "$REHEARSAL_DIR/data/$dir"
  for seed in "data/$dir"/*; do
    [ -e "$REHEARSAL_DIR/data/$dir/${seed##*/}" ] || cp "$seed" "$REHEARSAL_DIR/data/$dir/"
  done
done

# The chart model, as deploy.sh copies it from the server bucket.
if [ -d data/models/chart/current ] && [ ! -d "$REHEARSAL_DIR/data/models/chart/current" ]; then
  mkdir -p "$REHEARSAL_DIR/data/models/chart"
  cp -R data/models/chart/current "$REHEARSAL_DIR/data/models/chart/"
fi

env_file=$REHEARSAL_DIR/.env
if [ ! -f "$env_file" ]; then
  key=${ANTHROPIC_API_KEY:-$(sed -n 's/^ANTHROPIC_API_KEY=//p' .env 2>/dev/null || true)}
  umask 077
  cat > "$env_file" <<CONF
IMAGE_REGISTRY=wingtip-local
IMAGE_TAG=rehearsal
PUBLIC_HOST=cdn:9443
ORIGIN_HOST=origin.localhost
ORIGIN_SECRET=$(openssl rand -hex 20)
POSTGRES_PASSWORD=$(openssl rand -hex 20)
NAV_LOG_AGENT_API_KEY=$(openssl rand -hex 20)
MAIL_HOST=mailpit
MAIL_PORT=1025
MAIL_USERNAME=rehearsal
MAIL_PASSWORD=rehearsal
MAIL_FROM=no-reply@wingtip.local
APP_DEVELOPER_EMAILS=developer@example.com
ANTHROPIC_API_KEY=$key
REHEARSAL_DIR=$REHEARSAL_DIR
TILES_DIR=$TILES_DIR
CONF
fi

docker compose -p wingtip-prod --env-file "$env_file" \
  -f docker-compose.prod.yml -f infra/rehearsal/docker-compose.rehearsal.yml up -d
echo "Up: https://localhost:9443/app/plan (the planner fetches its FAA data first; give it a few minutes), mail at http://localhost:9025"
