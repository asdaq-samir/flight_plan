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

import csv
from datetime import datetime, timezone
from pathlib import Path

from .config import DATA_DIR
from .geo import distance_nm

NOTES_PATH = DATA_DIR / "labels" / "checkpoint_notes.csv"

COLUMNS = ["route", "lat", "lon", "description", "created_at"]

# Same threshold chartlabels uses for the same reason: two checkpoints
# closer than this on the same route are the same place, not two
# different ones a pilot happened to annotate twice.
SAME_PLACE_NM = 0.2


def route_key(dep_ident: str, dest_ident: str) -> str:
    return f"{dep_ident.strip().upper()}->{dest_ident.strip().upper()}"


def load_notes(route: str | None = None, path: Path = NOTES_PATH) -> list:
    """Every note, or just one route's. Missing file means none yet."""
    path = Path(path)
    if not path.exists():
        return []
    with path.open(newline="") as f:
        rows = list(csv.DictReader(f))
    for row in rows:
        row["lat"] = float(row["lat"])
        row["lon"] = float(row["lon"])
    return [r for r in rows if route is None or r["route"] == route]


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
    path = Path(path)
    row = {
        "route": route, "lat": lat, "lon": lon, "description": description,
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }

    existing = load_notes(path=path)
    kept = [
        old for old in existing
        if not (old["route"] == route and distance_nm(old["lat"], old["lon"], lat, lon) < SAME_PLACE_NM)
    ]

    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=COLUMNS)
        writer.writeheader()
        for old in kept:
            writer.writerow({c: old.get(c) for c in COLUMNS})
        writer.writerow(row)

    return row
