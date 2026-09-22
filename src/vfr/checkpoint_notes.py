"""Pilot-facing "how to spot it" text for nav-log checkpoints.

Separate from vfr.chartlabels on purpose: chart_picks.csv is ML
training data (a rating, a role, an area) built for the labeling loop,
and a checkpoint's identification note is an operational annotation a
pilot edits before a flight -- mixing the two would put non-training
text in a dataset the model is trained against. This file follows the
exact same shape as chartlabels (route-keyed, rewrite-in-place by
proximity) because that pattern already fits: a checkpoint's note is
also "one judgment at one point on a route," just not a training
label.
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from .chartlabels import route_key as route_key  # the same "DEP->DEST" key as a chart pick's
from .config import DATA_DIR
from .geo import distance_nm
from .routecsv import SAME_PLACE_NM, read_rows, same_place, write_rows

NOTES_PATH = DATA_DIR / "labels" / "checkpoint_notes.csv"

COLUMNS = ["route", "lat", "lon", "description", "created_at"]

# SAME_PLACE_NM is routecsv's, re-exported -- the same threshold a chart
# pick uses, and now the same constant rather than a matching copy.
__all__ = ["SAME_PLACE_NM"]


def load_notes(route: str | None = None, path: Path = NOTES_PATH) -> list:
    """Every note, or just one route's. Missing file means none yet."""
    return read_rows(path, route=route, floats=("lat", "lon"))


def find_note(notes: list, lat: float, lon: float) -> dict | None:
    """The note at this place, if one exists -- nearest within
    SAME_PLACE_NM, since a checkpoint's own coordinates can shift by a
    hair between requests (a different candidate tie-break, a rounding
    difference) without actually being a different checkpoint."""
    best, best_nm = None, SAME_PLACE_NM
    for note in notes:
        gap = distance_nm(note["lat"], note["lon"], lat, lon)
        if gap < best_nm:
            best, best_nm = note, gap
    return best


def save_note(route: str, lat: float, lon: float, description: str, path: Path = NOTES_PATH) -> dict:
    """Save one note, replacing whatever was at the same place on the
    same route -- a pilot editing a description, or a fresh LLM
    generation seeding one, should leave one row, not two."""
    row = {
        "route": route, "lat": lat, "lon": lon, "description": description,
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }

    kept = [old for old in load_notes(path=path) if not same_place(old, route, lat, lon)]
    write_rows(path, COLUMNS, [*kept, row])
    return row
