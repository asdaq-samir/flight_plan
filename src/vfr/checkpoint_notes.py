"""Pilot-facing "how to spot it" text for nav-log checkpoints.

Separate from vfr.chartlabels on purpose: chart_picks.csv is ML
training data (a rating, a role, an area) built for the labeling loop,
and a checkpoint's identification note is an operational annotation a
pilot edits before a flight -- mixing the two would put non-training
text in a dataset the model is trained against. Route-keyed and matched
by proximity like chartlabels, because a checkpoint's note is also "one
judgment at one point on a route", just not a training label.

Unlike a pick, a note is appended rather than rewritten in place, so an
edit keeps what the note said before; and a pilot's own edit is theirs
alone. Everyone else keeps seeing the shared note -- the generated one,
or one written where nobody can sign in -- instead of whatever the last
person to save typed. These notes tell a pilot how to recognise a
checkpoint from the air, so one pilot's mistake must not become every
pilot's.
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from .chartlabels import route_key as route_key  # the same "DEP->DEST" key as a chart pick's
from .config import DATA_DIR
from .geo import distance_nm
from .routecsv import SAME_PLACE_NM, locked, read_rows, write_rows

NOTES_PATH = DATA_DIR / "labels" / "checkpoint_notes.csv"

#: `pilot` is empty for the shared note -- the one generated for everyone,
#: or one written where nobody can sign in -- and a pilot's id for that
#: pilot's own edit, which nobody else sees.
COLUMNS = ["route", "lat", "lon", "description", "created_at", "pilot"]

# SAME_PLACE_NM is routecsv's, re-exported -- the same threshold a chart
# pick uses, and now the same constant rather than a matching copy.
__all__ = ["SAME_PLACE_NM"]


def load_notes(route: str | None = None, path: Path | None = None) -> list:
    """Every note ever saved, oldest first, or just one route's. Missing
    file means none yet. A row written before `pilot` existed reads as
    the shared note it was."""
    notes = read_rows(path or NOTES_PATH, route=route, floats=("lat", "lon"))
    for note in notes:
        note["pilot"] = note.get("pilot") or ""
    return notes


def find_note(notes: list, lat: float, lon: float, pilot: str | None = None) -> dict | None:
    """The note a pilot sees at this place: their own latest edit if they
    made one, else the latest shared note. Nearest within SAME_PLACE_NM,
    since a checkpoint's own coordinates can shift by a hair between
    requests (a different candidate tie-break, a rounding difference)
    without actually being a different checkpoint."""
    for owner in ([pilot, ""] if pilot else [""]):
        near = [n for n in notes if n["pilot"] == owner and distance_nm(n["lat"], n["lon"], lat, lon) < SAME_PLACE_NM]
        if near:
            nearest = min(distance_nm(n["lat"], n["lon"], lat, lon) for n in near)
            # Several edits at one place: the latest wins, and the earlier
            # ones stay in the file as its history.
            same = [n for n in near if distance_nm(n["lat"], n["lon"], lat, lon) - nearest < 0.05]
            return max(same, key=lambda n: n["created_at"])
    return None


def _append(route: str, lat: float, lon: float, description: str, pilot: str, path: Path,
            if_absent: bool) -> tuple[dict, bool]:
    """(the note in force at the place, whether it is the one written
    now). Decided under the file's lock, against the file as it is --
    not a snapshot taken earlier by the caller.

    The row is placed at the note already nearest it on the route, when
    one is within SAME_PLACE_NM: a checkpoint's coordinates shift by a
    hair between requests, and rows a little apart for one checkpoint
    left find_note reading an older one from the old point. One place
    per checkpoint, however many edits."""
    with locked(path):
        notes = load_notes(path=path)
        on_route = [n for n in notes if n["route"] == route]
        nearest = min(on_route, key=lambda n: distance_nm(n["lat"], n["lon"], lat, lon), default=None)
        if nearest is not None and distance_nm(nearest["lat"], nearest["lon"], lat, lon) < SAME_PLACE_NM:
            lat, lon = nearest["lat"], nearest["lon"]
        if if_absent and (held := find_note(on_route, lat, lon, pilot)) is not None:
            return held, False
        row = {
            "route": route, "lat": lat, "lon": lon, "description": description,
            "created_at": datetime.now(timezone.utc).isoformat(timespec="microseconds"),
            "pilot": pilot,
        }
        write_rows(path, COLUMNS, [*notes, row])
    return row, True


def save_note(route: str, lat: float, lon: float, description: str, pilot: str | None = None,
              path: Path | None = None) -> dict:
    """Add one note. Appended, never overwritten: the latest at a place
    is what find_note returns, and what it said before stays readable.
    `pilot` makes it that pilot's own; None is the shared note."""
    row, _ = _append(route, lat, lon, description, pilot or "", path or NOTES_PATH, if_absent=False)
    return row


def seed_note(route: str, lat: float, lon: float, description: str, path: Path | None = None) -> tuple[dict, bool]:
    """The generated shared note, written only where the place has no
    shared note yet: (the note in force, whether it is this one).
    Generation used to check a snapshot taken when its stream began and
    then write regardless, so a shared edit saved meanwhile -- where
    nobody signs in, every edit is shared -- was buried under the
    generated text."""
    return _append(route, lat, lon, description, "", path or NOTES_PATH, if_absent=True)


def places(route: str, path: Path | None = None) -> int:
    """How many places on the route have a note -- not how many rows,
    which counts every edit's history."""
    return len({(n["lat"], n["lon"]) for n in load_notes(route, path=path)})
