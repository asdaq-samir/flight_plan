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
  as() { local u=$1; shift; docker exec -i "$name" psql -v ON_ERROR_STOP=1 -qtA -U "$u" -d postgres "$@"; }
  # Each step is done only if it is not done yet, and the database goes
  # before the role, so a run that stopped half way is finished by the next
  # one. The user to work as is whichever of the three still exists.
  user=
  for candidate in wingtip_rename vfr "$NEW"; do
    if echo "select 1" | as "$candidate" >/dev/null 2>&1; then user=$candidate; break; fi
  done
  [ -n "$user" ] || { echo "cannot connect to the copied database as wingtip_rename, vfr or $NEW" >&2; exit 1; }
  if [ "$user" = vfr ]; then
    echo "create role wingtip_rename superuser login" | as vfr
    user=wingtip_rename
  fi
  if [ "$user" = wingtip_rename ]; then
    # psql puts :'pw' in as a quoted literal, so a quote in the password
    # is safe.
    as wingtip_rename -v pw="$PASSWORD" <<SQL
select 'alter database vfr_route rename to $NEW'
  where exists (select from pg_database where datname = 'vfr_route') \gexec
select 'alter role vfr rename to $NEW'
  where exists (select from pg_roles where rolname = 'vfr') \gexec
alter role $NEW password :'pw';
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
