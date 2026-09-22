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


def write_rows(path: Path, columns: list, rows) -> None:
    """The whole file, header and all. Rewritten rather than appended to
    because changing one's mind about a place must leave one row, not two
    contradictory ones."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=columns)
        writer.writeheader()
        for row in rows:
            writer.writerow({column: row.get(column) for column in columns})


def same_place(row: dict, route: str, lat: float, lon: float) -> bool:
    """Whether this row is about the same place on the same route."""
    return row["route"] == route and distance_nm(row["lat"], row["lon"], lat, lon) < SAME_PLACE_NM
