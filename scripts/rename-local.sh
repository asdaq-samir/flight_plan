#!/usr/bin/env bash
# Once, on a Mac that ran the stack before the app was renamed Wingtip
# (the owner, 2026-11-06): brings its local state to the new names, so
# nothing kept is lost.
#
#   scripts/rename-local.sh
#
# - The Compose project was the checkout's folder, flight_plan, and is
#   wingtip (docker-compose.yml's name): each kept volume is copied to
#   its wingtip_ name, the old one left as it was until you remove it.
# - The database's user and name were vfr / vfr_route and are wingtip /
#   wingtip, with the password POSTGRES_PASSWORD says (wingtip unless
#   .env sets it): renamed in the copied volume, so the pilots' accounts,
#   flights and logbook come along.
# - The built images are tagged with their wingtip- names, so the first
#   `up` needs no build.
# - The local HTTPS authority's folder, ~/.config/vfr-local-ca, is
#   ~/.config/wingtip-local-ca (infra/local-https/make-certs.sh): moved,
#   so the phone keeps trusting the certificates made from it.
#
# Stop the old stack first (docker compose -p flight_plan down). Safe to
# run again: what is already done is left alone.
set -euo pipefail

OLD=flight_plan
NEW=wingtip
PASSWORD=${POSTGRES_PASSWORD:-wingtip}

if [ -n "$(docker ps -q --filter "label=com.docker.compose.project=$OLD")" ]; then
  echo "the $OLD stack is running: docker compose -p $OLD down first" >&2
  exit 1
fi

for volume in pgdata_pg18 airflow_home_v3 webapp-cds; do
  from="${OLD}_$volume" to="${NEW}_$volume"
  if ! docker volume inspect "$from" >/dev/null 2>&1; then echo "no $from: nothing to copy"; continue; fi
  if docker volume inspect "$to" >/dev/null 2>&1; then echo "$to is there already"; continue; fi
  docker volume create --label com.docker.compose.project=$NEW --label com.docker.compose.volume=$volume "$to" >/dev/null
  docker run --rm -v "$from":/from:ro -v "$to":/to alpine sh -c "cp -a /from/. /to/"
  echo "copied $from to $to"
done

# The database: its owner role and the database itself, renamed in place
# in the copy. A role cannot rename itself, so a second superuser does it
# and is dropped after.
if docker volume inspect "${NEW}_pgdata_pg18" >/dev/null 2>&1; then
  name=wingtip-rename-db
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker run -d --name "$name" -v "${NEW}_pgdata_pg18":/var/lib/postgresql pgvector/pgvector:pg18 >/dev/null
  trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT
  for _ in $(seq 1 60); do docker exec "$name" pg_isready -q 2>/dev/null && break; sleep 1; done
  as() { docker exec -i "$name" psql -v ON_ERROR_STOP=1 -qtA -U "$1" -d postgres; }
  if [ "$(echo "select 1 from pg_roles where rolname = 'vfr'" | as vfr 2>/dev/null || true)" = 1 ]; then
    echo "create role wingtip_rename superuser login" | as vfr
    as wingtip_rename <<SQL
alter role vfr rename to $NEW;
alter role $NEW password '$PASSWORD';
alter database vfr_route rename to $NEW;
SQL
    echo "drop role wingtip_rename" | as "$NEW"
    echo "renamed the database's user vfr and database vfr_route to $NEW"
  else
    echo "the database is renamed already"
  fi
fi

for image in $(docker image ls --format '{{.Repository}}' | grep -E "^${OLD}-[a-z-]+$" | sort -u); do
  service=${image#"${OLD}-"}
  docker image inspect "${NEW}-$service" >/dev/null 2>&1 || { docker tag "$image" "${NEW}-$service"; echo "tagged ${NEW}-$service"; }
done

if [ -d "$HOME/.config/vfr-local-ca" ] && [ ! -e "$HOME/.config/wingtip-local-ca" ]; then
  mv "$HOME/.config/vfr-local-ca" "$HOME/.config/wingtip-local-ca"
  echo "moved ~/.config/vfr-local-ca to ~/.config/wingtip-local-ca"
fi

echo "done: start the stack as before; it is the wingtip project now"
