#!/bin/bash
# The nightly backup (cron, from the stack's UserData), to
# s3://SERVER_BUCKET/backups/<date>/; the bucket keeps 14 days.
# - postgres.dump: every pilot's account, aircraft and flights, and the
#   briefing agent's memory (pg_dump, custom format).
# - labels.tar.gz: the checkpoint notes pilots and Claude have written,
#   and any chart ratings -- the planner keeps those as files in
#   data/labels, not in the database.
#
# To restore (docs/README-AWS.md, "Backups and restore"):
#   aws s3 cp s3://$SERVER_BUCKET/backups/<date>/postgres.dump - | \
#     docker compose --env-file /srv/flight_plan/.env -f docker-compose.prod.yml \
#     exec -T db pg_restore -U vfr -d vfr_route --clean --if-exists
#   aws s3 cp s3://$SERVER_BUCKET/backups/<date>/labels.tar.gz - | tar -xz -C /srv/flight_plan/data
set -euo pipefail
# shellcheck source=/dev/null
source /etc/flight_plan.conf
cd /srv/flight_plan/repo
to="s3://$SERVER_BUCKET/backups/$(date -u +%F)"
docker compose --env-file /srv/flight_plan/.env -f docker-compose.prod.yml exec -T db \
  pg_dump -U vfr -d vfr_route --format=custom \
  | aws s3 cp - "$to/postgres.dump" --region "$AWS_REGION"
tar -cz -C /srv/flight_plan/data labels | aws s3 cp - "$to/labels.tar.gz" --region "$AWS_REGION"
