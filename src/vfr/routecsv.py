"""One judgment at one place on one route, written to a CSV.

Two files are kept this way and were keeping themselves this way
separately: `chartlabels`' chart picks (a rating, a role, an area --
training data) and `checkpoint_notes`' identification notes (pilot
text, an operational annotation). They deliberately stay two files, for
the reason `checkpoint_notes`' own docstring gives, but the mechanics
were copied: read the file if it is there and coerce the numeric
columns, rewrite the whole file with a header when one row changes, and
decide whether a row is "the same place on the same route".

That last one is the reason this module exists rather than the line
count. A pick and a note are matched to a checkpoint by proximity, and
two thresholds that were equal by coincidence and documented as equal in
both files would eventually stop being equal.
"""
from __future__ import annotations

import csv
import fcntl
import os
import tempfile
import threading
from contextlib import contextmanager
from pathlib import Path

from .geo import distance_nm

#: Two rows closer than this on the same route are the same place, not
#: two things a pilot annotated twice. Matches vfr.chartvision's own
#: dedupe distance, so a pick lines up with the detection it refers to.
SAME_PLACE_NM = 0.2


def read_rows(
    path: Path, *, route: str | None = None, floats: tuple = (), ints: tuple = ()
) -> list[dict]:
    """Every row, or just one route's. A missing file means none yet,
    which is the normal state before anything has been recorded.

    Empty cells come back as None rather than as `""` or a crash: a
    column added later leaves the rows written before it blank.
    """
    path = Path(path)
    if not path.exists():
        return []
    with path.open(newline="") as f:
        rows = list(csv.DictReader(f))
    for row in rows:
        for column in floats:
            row[column] = float(row[column]) if row[column] not in ("", None) else None
        for column in ints:
            row[column] = int(row[column]) if row[column] not in ("", None) else None
    return [row for row in rows if route is None or row["route"] == route]


_THREAD_LOCKS: dict = {}
_THREAD_LOCKS_GUARD = threading.Lock()


@contextmanager
def locked(path: Path):
    """Hold the file for a read-modify-write: one writer at a time.

    Every change here is read the whole file, change one row, write the
    whole file. Two at once -- two ratings a keystroke apart, a note
    saved while generation streams -- each wrote its own copy, and the
    later one silently dropped the other's row. A lock per file inside
    this process (the service's request threads), and an advisory file
    lock beside it for another process on the same files.
    """
    path = Path(path)
    with _THREAD_LOCKS_GUARD:
        lock = _THREAD_LOCKS.setdefault(str(path.resolve()), threading.Lock())
    path.parent.mkdir(parents=True, exist_ok=True)
    with lock, open(path.with_name(path.name + ".lock"), "w") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def write_rows(path: Path, columns: list, rows) -> None:
    """The whole file, header and all, written beside it and then renamed
    over it. A reader (the retrain, another request) sees the old file or
    the new one, never half of one, and a process killed mid-write leaves
    the old file where it was instead of a truncated training set. Call
    it inside `locked`."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=columns)
            writer.writeheader()
            for row in rows:
                writer.writerow({column: row.get(column) for column in columns})
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp, 0o644)  # mkstemp's 0600 would hide it from the other services' users
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def same_place(row: dict, route: str, lat: float, lon: float) -> bool:
    """Whether this row is about the same place on the same route."""
    return row["route"] == route and distance_nm(row["lat"], row["lon"], lat, lon) < SAME_PLACE_NM
