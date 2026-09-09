"""Minimal versioned SQL migrations for route_briefings -- Flyway's pattern
(numbered files, tracked in a schema_migrations table, applied once each)
without pulling in a full ORM/migration framework for one table. Mirrors
what `webapp` does with real Flyway now (see
springboot-app/src/main/resources/db/migration/) -- same principle, lighter
tool, since this project has no ORM on the Python side to hang Alembic off.

Replaces the old approach of running CREATE EXTENSION/TABLE IF NOT EXISTS
on every single connection (see db.get_connection()'s old docstring) --
this runs once, explicitly, at process startup instead.
"""
import re
from pathlib import Path

import psycopg

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"
_VERSION_RE = re.compile(r"V(\d+)__")


def apply_all(conn: psycopg.Connection) -> None:
    """Runs every V*.sql file in migrations/ not yet recorded in
    schema_migrations, in version order, once each -- the module's sole
    entry point, called from db.ensure_schema() at process startup."""
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations ("
        "version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())"
    )
    applied = {row[0] for row in conn.execute("SELECT version FROM schema_migrations").fetchall()}

    for path in sorted(MIGRATIONS_DIR.glob("V*.sql")):
        version = int(_VERSION_RE.match(path.name).group(1))
        if version in applied:
            continue
        conn.execute(path.read_text())
        conn.execute("INSERT INTO schema_migrations (version) VALUES (%s)", (version,))
