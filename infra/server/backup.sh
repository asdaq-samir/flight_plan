#!/bin/bash
# The nightly backup (cron, from the stack's UserData), to
# s3://SERVER_BUCKET/backups/<date>/; the bucket keeps 14 days.
# - postgres.dump: every pilot's account, aircraft and flights
#   (pg_dump, custom format).
# - labels.tar.gz: the checkpoint notes pilots and Claude have written,
#   and any chart ratings -- the planner keeps those as files in
#   data/labels, not in the database.
#
# To restore (docs/README-AWS.md, "Backups and restore"):
#   aws s3 cp s3://$SERVER_BUCKET/backups/<date>/postgres.dump - | \
#     docker compose --env-file /srv/wingtip/.env -f docker-compose.prod.yml \
#     exec -T db pg_restore -U wingtip -d wingtip --clean --if-exists
#   aws s3 cp s3://$SERVER_BUCKET/backups/<date>/labels.tar.gz - | tar -xz -C /srv/wingtip/data
set -euo pipefail
# shellcheck source=/dev/null
source /etc/wingtip.conf
cd /srv/wingtip/repo
# A failed or truncated dump must not replace a good day: dump to a file,
# check that pg_restore can read it, and only then upload. Any failure
# emails the owner (BACKUP_TOPIC_ARN, the stack's BudgetEmail), so a night
# without a backup is noticed before the 14 days are gone.
to="s3://$SERVER_BUCKET/backups/$(date -u +%F)"
file=$(mktemp /var/tmp/wingtip-XXXXXX.dump)
alert() {
  echo "backup failed: $(date -u +%FT%TZ)" >&2
  if [ -n "${BACKUP_TOPIC_ARN:-}" ]; then
    aws sns publish --region "$AWS_REGION" --topic-arn "$BACKUP_TOPIC_ARN" \
      --subject "Wingtip Maps: nightly backup failed" \
      --message "The database backup on $(hostname) failed at $(date -u +%FT%TZ). See /var/log/wingtip-backup.log." || true
  fi
}
trap 'rm -f "$file"' EXIT
trap alert ERR
compose=(docker compose --env-file /srv/wingtip/.env -f docker-compose.prod.yml)
"${compose[@]}" exec -T db pg_dump -U wingtip -d wingtip --format=custom > "$file"
"${compose[@]}" exec -T db pg_restore --list < "$file" > /dev/null
aws s3 cp "$file" "$to/postgres.dump" --region "$AWS_REGION" --only-show-errors
tar -cz -C /srv/wingtip/data labels | aws s3 cp - "$to/labels.tar.gz" --region "$AWS_REGION" --only-show-errors
