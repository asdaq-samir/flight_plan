"""migrations.apply_all against a stand-in connection that keeps each
statement it is sent and the transaction it was sent in. What it proves
is the order and the grouping; the tables themselves are Postgres's, and
the whole run -- a fresh database with the webapp started after the
agent, and an old one keeping its briefings -- was checked against the
real one by hand."""
from contextlib import contextmanager

from app import migrations


class _Rows:
    def __init__(self, rows):
        self.rows = rows

    def fetchone(self):
        return self.rows[0]

    def fetchall(self):
        return self.rows


class _Conn:
    def __init__(self, tables=(), applied=()):
        self.tables = set(tables)
        self.applied = set(applied)
        self.log: list[tuple[int | None, str]] = []
        self._tx: int | None = None
        self._count = 0

    @contextmanager
    def transaction(self):
        self._count += 1
        self._tx = self._count
        try:
            yield
        finally:
            self._tx = None

    def execute(self, sql, params=None):
        self.log.append((self._tx, sql))
        if sql.startswith("SELECT to_regclass"):
            return _Rows([(params[0] in self.tables,)])
        if sql.startswith("SELECT version"):
            return _Rows([(v,) for v in self.applied])
        return _Rows([])

    def index(self, fragment):
        return next(i for i, (_, sql) in enumerate(self.log) if fragment in sql)


def test_a_fresh_database_gets_the_agents_schema_and_nothing_in_public():
    conn = _Conn()
    migrations.apply_all(conn)

    assert conn.log[0][1] == "CREATE SCHEMA IF NOT EXISTS nav_log_agent"
    assert not any("ALTER TABLE" in sql for _, sql in conn.log)
    assert all("public." not in sql for _, sql in conn.log if not sql.startswith("SELECT to_regclass"))


def test_a_migration_and_its_history_row_commit_together():
    # They used to be two autocommits: a crash between them left the table
    # made and the version unrecorded, and every start after failed on
    # "relation route_briefings already exists".
    conn = _Conn()
    migrations.apply_all(conn)

    made = conn.log[conn.index("CREATE TABLE route_briefings")]
    recorded = conn.log[conn.index("INSERT INTO nav_log_agent.schema_migrations")]
    assert made[0] is not None and made[0] == recorded[0]


def test_an_old_database_has_its_tables_moved_before_the_history_is_read():
    # The other order ran V1 again in the new schema, and the briefings
    # stored so far were left behind in public.
    conn = _Conn(tables={"public.schema_migrations", "public.route_briefings"}, applied={1})
    migrations.apply_all(conn)

    moved = conn.index("ALTER TABLE public.schema_migrations SET SCHEMA nav_log_agent")
    assert moved < conn.index("ALTER TABLE IF EXISTS public.route_briefings SET SCHEMA nav_log_agent")
    assert moved < conn.index("CREATE TABLE IF NOT EXISTS nav_log_agent.schema_migrations")
    assert moved < conn.index("SELECT version FROM nav_log_agent.schema_migrations")
    assert not any("CREATE TABLE route_briefings" in sql for _, sql in conn.log)


def test_a_database_already_moved_is_left_alone():
    conn = _Conn(tables={"nav_log_agent.schema_migrations", "nav_log_agent.route_briefings"}, applied={1})
    migrations.apply_all(conn)

    assert not any("ALTER TABLE" in sql or "CREATE TABLE route_briefings" in sql for _, sql in conn.log)
