#!/bin/bash
# Brings the production server up to the latest images and settings:
# writes /srv/flight_plan/.env from the stack's secrets, logs in to ECR,
# pulls and (re)starts docker-compose.prod.yml. Run by the server's first
# boot (the stack's UserData) and by every deploy after it -- by hand over
# SSM Session Manager, or by the GitHub deploy role with ssm send-command.
# Safe to run again: compose only restarts what changed.
set -euo pipefail

# Written by the stack's UserData: AWS_REGION, IMAGE_REGISTRY, IMAGE_TAG,
# PUBLIC_HOST, ORIGIN_HOST, SERVER_BUCKET, APP_SECRET_ARN, DB_SECRET_ARN,
# AGENT_SECRET_ARN, ORIGIN_SECRET_ARN, MAIL_HOST, MAIL_FROM.
# shellcheck source=/dev/null
source /etc/flight_plan.conf

REPO=/srv/flight_plan/repo
ENV_FILE=/srv/flight_plan/.env

git -C "$REPO" pull --ff-only --quiet

secret() { aws secretsmanager get-secret-value --region "$AWS_REGION" --secret-id "$1" --query SecretString --output text; }
# Fetched before anything is written: a failure inside $(...) in an echo
# does not stop set -e, and an empty ORIGIN_SECRET would let Caddy's
# header check pass any request that merely carries the header.
db_password=$(secret "$DB_SECRET_ARN")
origin_secret=$(secret "$ORIGIN_SECRET_ARN")
agent_key=$(secret "$AGENT_SECRET_ARN")
app_values=$(secret "$APP_SECRET_ARN")
umask 077
{
  echo "AWS_REGION=$AWS_REGION"
  echo "LOG_GROUP=$LOG_GROUP"
  echo "IMAGE_REGISTRY=$IMAGE_REGISTRY"
  echo "IMAGE_TAG=${IMAGE_TAG:-latest}"
  echo "PUBLIC_HOST=$PUBLIC_HOST"
  echo "ORIGIN_HOST=$ORIGIN_HOST"
  echo "MAIL_HOST=$MAIL_HOST"
  echo "MAIL_FROM=$MAIL_FROM"
  echo "POSTGRES_PASSWORD=$db_password"
  echo "ORIGIN_SECRET=$origin_secret"
  echo "NAV_LOG_AGENT_API_KEY=$agent_key"
  # The owner's own values (infra/server/env.example lists them), kept as
  # one JSON secret: ANTHROPIC_API_KEY, MAIL_USERNAME, MAIL_PASSWORD, ...
  # Double-quoted, escapes and all: Sign in with Apple's private key is a
  # multi-line PEM, which compose's .env reads back from "\n".
  printf '%s' "$app_values" | python3 -c 'import json, sys
for k, v in json.load(sys.stdin).items():
    print(f"{k}={json.dumps(str(v))}")'
} > "$ENV_FILE.new"
mv "$ENV_FILE.new" "$ENV_FILE"

# The repository's seeds for the data folder, copied once: the checkpoint
# notes written so far, and the corridor the planner warms its charts up
# on. After that the server's copies are the live ones -- pilots add notes
# to them -- and are never overwritten. (The stock aircraft profiles are
# mounted from the repository instead, docker-compose.prod.yml, so they
# follow each deploy.)
for dir in labels processed; do
  install -d -o 1000 -g 1000 "/srv/flight_plan/data/$dir"
  for seed in "$REPO/data/$dir"/*; do
    [ -e "/srv/flight_plan/data/$dir/${seed##*/}" ] || install -o 1000 -g 1000 -m 644 "$seed" "/srv/flight_plan/data/$dir/"
  done
done

aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "${IMAGE_REGISTRY%%/*}" > /dev/null

# The chart model the planner ranks checkpoints with, if one has been
# uploaded (s3://SERVER_BUCKET/models/chart/current/); without it the
# planner ranks by its own rules (planning-service/app/chart_model.py).
aws s3 sync --quiet "s3://$SERVER_BUCKET/models/" /srv/flight_plan/data/models/ || true

cd "$REPO"
docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml pull --quiet
docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml up -d --remove-orphans
docker image prune -f > /dev/null
echo "deployed: $(docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml ps --format '{{.Service}} {{.Status}}' | tr '\n' ';')"
