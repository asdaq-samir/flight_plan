#!/bin/bash
# The nightly database backup (cron, from the stack's UserData): a
# pg_dump of every pilot's account, aircraft, flights and notes, streamed
# to s3://SERVER_BUCKET/postgres/<date>.dump. The bucket keeps 14 days.
#
# To restore one (docs/README-AWS.md, "Restore the database"):
#   aws s3 cp s3://$SERVER_BUCKET/postgres/<date>.dump - | \
#     docker compose --env-file /srv/flight_plan/.env -f docker-compose.prod.yml \
#     exec -T db pg_restore -U vfr -d vfr_route --clean --if-exists
set -euo pipefail
# shellcheck source=/dev/null
source /etc/flight_plan.conf
cd /srv/flight_plan/repo
docker compose --env-file /srv/flight_plan/.env -f docker-compose.prod.yml exec -T db \
  pg_dump -U vfr -d vfr_route --format=custom \
  | aws s3 cp - "s3://$SERVER_BUCKET/postgres/$(date -u +%F).dump" --region "$AWS_REGION"
