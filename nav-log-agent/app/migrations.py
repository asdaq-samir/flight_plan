"""Minimal versioned SQL migrations for route_briefings -- Flyway's pattern
(numbered files, tracked in a schema_migrations table, applied once each)
without pulling in a full ORM/migration framework for one table. Mirrors
what `webapp` does with real Flyway now (see
springboot-app/src/main/resources/db/migration/) -- same principle, lighter
tool, since this project has no ORM on the Python side to hang Alembic off.

Replaces the old approach of running CREATE EXTENSION/TABLE IF NOT EXISTS
on every single connection (see db.get_connection()'s old docstring) --
this runs once, explicitly, at process startup instead.

Everything here lives in the agent's own schema, SCHEMA, which db.py puts
first on every connection's search_path. `public` is Flyway's: the webapp
shares this database, and Flyway refuses to migrate a `public` that holds
tables it has no history for -- so an agent that reached a fresh database
first used to stop the webapp starting, for good. Each migration commits
together with its schema_migrations row, so a crash between the two can no
longer leave a table the history says was never made.
"""
import re
from pathlib import Path

import psycopg

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"
SCHEMA = "nav_log_agent"
_VERSION_RE = re.compile(r"V(\d+)__")


def _exists(conn: psycopg.Connection, table: str) -> bool:
    return conn.execute("SELECT to_regclass(%s) IS NOT NULL", (table,)).fetchone()[0]


def apply_all(conn: psycopg.Connection) -> None:
    """Runs every V*.sql file in migrations/ not yet recorded in
    schema_migrations, in version order, once each -- the module's sole
    entry point, called from db.ensure_schema() at process startup."""
    with conn.transaction():
        conn.execute(f"CREATE SCHEMA IF NOT EXISTS {SCHEMA}")
        # Before SCHEMA existed, these two sat in public. Moved over (with
        # the briefings' id sequence) before the history table is looked
        # for, or V1 would run again here and the old briefings be lost.
        # Can go once every database has been adopted.
        if _exists(conn, "public.schema_migrations") and not _exists(conn, f"{SCHEMA}.schema_migrations"):
            conn.execute(f"ALTER TABLE public.schema_migrations SET SCHEMA {SCHEMA}")
            conn.execute(f"ALTER TABLE IF EXISTS public.route_briefings SET SCHEMA {SCHEMA}")
        conn.execute(
            f"CREATE TABLE IF NOT EXISTS {SCHEMA}.schema_migrations ("
            "version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())"
        )
    applied = {row[0] for row in conn.execute(f"SELECT version FROM {SCHEMA}.schema_migrations").fetchall()}

    for path in sorted(MIGRATIONS_DIR.glob("V*.sql")):
        version = int(_VERSION_RE.match(path.name).group(1))
        if version in applied:
            continue
        with conn.transaction():
            conn.execute(path.read_text())
            conn.execute(f"INSERT INTO {SCHEMA}.schema_migrations (version) VALUES (%s)", (version,))
