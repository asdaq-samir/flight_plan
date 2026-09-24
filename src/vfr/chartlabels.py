"""Hand-picked checkpoints, marked directly on the sectional.

The older labeling loop (removed with the OSM labeling UI) rated
candidates that OpenStreetMap
had supplied, which can only ever sample places OSM already knew about.
That is the wrong sample for a chart-reading detector: it says nothing
about what the detector *misses*, because a landmark absent from OSM was
never shown to anyone.

Picking on the chart fixes the sample. Every row here is one judgment at
one point on a route:

- source "detected": vfr.chartvision found something and a pilot said
  whether they would use it. Rejections are as informative as
  acceptances -- they are the false positives.
- source "added": a pilot marked a checkpoint the detector did not find
  at all. These are the misses, and they are the only way to learn what
  the palette rules fail to catch.

Each pick also has a role, because two different jobs were being recorded
as one thing:

- "dr": a dead-reckoning checkpoint. You fly over it, it fixes time and
  position, and it becomes a leg in the nav log. It has to be on course.
- "visual": a reference you do not fly over -- an airport off the right
  window, a lake abeam -- used to confirm you are where you think you
  are. Being off course is the whole point of it, so the narrow corridor
  that is correct for a DR checkpoint is exactly wrong here.

Without the distinction, off-course picks looked like corridor noise and
were silently discarded.

Rating is 1-5 as before ("would I use this, reading the chart the way I
would in flight"), with 0 meaning "detected but I would not use it".

Rows are keyed by route and position rather than by an OSM id, because
there may be no OSM feature involved -- the point is a place on a chart.
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from .config import DATA_DIR
from .routecsv import SAME_PLACE_NM, locked, read_rows, same_place, write_rows

CHART_PICKS_PATH = DATA_DIR / "labels" / "chart_picks.csv"

COLUMNS = [
    "route",
    "source",
    "role",
    "category",
    "lat",
    "lon",
    "along_track_nm",
    "cross_track_nm",
    "rating",
    "area_m2",
    "note",
    "created_at",
]

# SAME_PLACE_NM is routecsv's, re-exported: a pick and a note have to
# agree on what "the same place" means, and two constants that were
# equal by coincidence would eventually stop being.
__all__ = ["SAME_PLACE_NM"]

ROLES = ("dr", "visual")

# Beyond this far off course, a landmark is not something you fly over,
# so it is being used as a visual reference rather than a DR checkpoint.
# Only a default -- the pilot decides, and a big lake right on course can
# still be wanted purely as a reference.
DR_CORRIDOR_NM = 0.5


def default_role(cross_track_nm: float) -> str:
    """Which job a pick is most likely doing, from how far off course it
    sits. Used to fill the field in rather than to override anyone."""
    return "dr" if abs(cross_track_nm) <= DR_CORRIDOR_NM else "visual"


def route_key(dep_ident: str, dest_ident: str) -> str:
    return f"{dep_ident.strip().upper()}->{dest_ident.strip().upper()}"


def load_picks(route: str | None = None, path: Path = CHART_PICKS_PATH) -> list:
    """Every pick, or just one route's. Missing file means no picks yet,
    which is the normal state before any labeling has happened."""
    return read_rows(
        path, route=route,
        floats=("lat", "lon", "along_track_nm", "cross_track_nm", "area_m2"),
        ints=("rating",),
    )


# There is no find_existing. It answered "is there a pick near this
# point", per point, which reads as the obvious way to line picks up with
# detections and is wrong: two detections a few pixels apart both matched
# the same pick, one pick was drawn twice, and picks that matched nothing
# vanished. Matching is an assignment -- each pick claims its nearest
# unclaimed detection -- and belongs where the whole set is in hand.


def save_pick(pick: dict, path: Path = CHART_PICKS_PATH) -> dict:
    """Append one pick, or replace the existing one at the same place.

    Replacing rather than appending because a pilot changing their mind
    about a checkpoint should leave one row, not two contradictory ones --
    the same reason the old labeling loop's relabel rewrote in place.
    """
    row = {column: pick.get(column) for column in COLUMNS}
    row["created_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")

    with locked(path):
        existing = load_picks(path=path)
        kept = [old for old in existing if not same_place(old, row["route"], row["lat"], row["lon"])]
        write_rows(path, COLUMNS, [*kept, row])

    row["replaced"] = len(kept) < len(existing)
    # One pick per place, whatever it is: a pick on another kind of thing
    # within SAME_PLACE_NM -- the river beside the bridge being rated --
    # goes with this save. Named, so the page can stop showing it as rated
    # and say why. The same category nearby is this same point again (a
    # detection's centroid shifts between tile blocks), not another one.
    row["displaced"] = [
        {"lat": old["lat"], "lon": old["lon"], "category": old["category"]}
        for old in existing
        if old not in kept and old["category"] != row["category"]
    ]
    return row


def delete_pick(route: str, lat: float, lon: float, path: Path = CHART_PICKS_PATH) -> bool:
    """Remove the pick at this place. True if one was there."""
    with locked(path):
        existing = load_picks(path=path)
        kept = [row for row in existing if not same_place(row, route, lat, lon)]
        if len(kept) == len(existing):
            return False
        write_rows(path, COLUMNS, kept)
    return True


def summarise(route: str | None = None, path: Path = CHART_PICKS_PATH) -> dict:
    """Counts worth showing while labeling: how many detections were
    accepted, how many rejected, and how many checkpoints the detector
    missed entirely. That last number is the one that says whether the
    palette rules need work."""
    picks = load_picks(route, path)
    accepted = [p for p in picks if p["source"] == "detected" and p["rating"]]
    rejected = [p for p in picks if p["source"] == "detected" and not p["rating"]]
    added = [p for p in picks if p["source"] == "added"]
    return {
        "total": len(picks),
        "accepted": len(accepted),
        "rejected": len(rejected),
        "added": len(added),
        "by_rating": {n: sum(1 for p in picks if p["rating"] == n) for n in range(1, 6)},
        "by_role": {role: sum(1 for p in picks if p.get("role") == role) for role in ROLES},
        "added_categories": sorted({p["category"] for p in added if p["category"]}),
    }
