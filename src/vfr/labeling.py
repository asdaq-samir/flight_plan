"""Interactive hand-labeling loop for Notebook 03.

Presents each candidate on the actual FAA VFR sectional chart (so
"would I use this as a checkpoint" is judged the way a pilot actually
would -- against the chart they're flying with, not a satellite photo of
the ground) and prompts for a 1-5 spottability rating. Ratings are
appended to the output CSV one at a time, so the loop is safe to
interrupt and resume -- already-rated candidates are skipped on the next
run.

Was satellite imagery (ESRI World Imagery) through 2026-08-30; switched to
the FAA's own VFR Sectional tile service since a chart is what pilots
actually reference in flight. Old satellite-based labels are preserved at
data/labels/spottability_ratings_satellite_v1.csv.bak rather than reused,
since the judgment criterion changed. Visual ground-truth recognition
(satellite/photo-based, to complement the chart view) is a possible
future addition, not built yet.
"""
import csv
from pathlib import Path

import folium
import pandas as pd
from IPython.display import clear_output, display

# FAA's own tiled VFR Sectional service (same {z}/{y}/{x} XYZ scheme as the
# ESRI imagery this replaced). Chart tiles only go to zoom 12 -- fixed
# print resolution, unlike a photo you can zoom into indefinitely.
FAA_VFR_SECTIONAL_URL = (
    "https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/VFR_Sectional/MapServer/tile/{z}/{y}/{x}"
)
VFR_SECTIONAL_MAX_ZOOM = 12
VFR_SECTIONAL_MIN_ZOOM = 8

LABEL_COLUMNS = ["osm_id", "osm_type", "name", "category", "rating"]


def _load_labeled_keys(out_path: Path) -> set:
    if not out_path.exists():
        return set()
    existing = pd.read_csv(out_path)
    return set(zip(existing["osm_id"], existing["osm_type"]))


def _append_rating(row: pd.Series, rating: int, out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    write_header = not out_path.exists()
    with out_path.open("a", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=LABEL_COLUMNS)
        if write_header:
            writer.writeheader()
        writer.writerow(
            {
                "osm_id": row["osm_id"],
                "osm_type": row["osm_type"],
                "name": row["name"],
                "category": row["category"],
                "rating": rating,
            }
        )


def label_candidates(candidates: pd.DataFrame, out_path: Path, shuffle_seed: int = 42) -> None:
    """Run the interactive labeling loop over `candidates` (must have
    osm_id, osm_type, name, category, lat, lon columns). Blocks on
    `input()` per candidate -- run this in a real Jupyter kernel, not via
    a headless `nbconvert --execute`.

    Order is shuffled (fixed seed, so it's reproducible) rather than
    along-route, so stopping partway through doesn't systematically skip
    whole stretches of the route and bias the label sample.

    At each candidate: enter a rating 1-5 ("would I actually use this as
    a checkpoint, reading the chart the way I would in flight"), leave
    blank to skip it (revisited on a future run), or 'q' to stop the
    session.
    """
    out_path = Path(out_path)
    labeled_keys = _load_labeled_keys(out_path)
    remaining = candidates[
        ~candidates.apply(lambda r: (r["osm_id"], r["osm_type"]) in labeled_keys, axis=1)
    ].sample(frac=1, random_state=shuffle_seed)

    print(f"{len(labeled_keys)} already labeled, {len(remaining)} remaining this session")

    for i, (_, row) in enumerate(remaining.iterrows()):
        clear_output(wait=True)
        m = folium.Map(
            location=[row["lat"], row["lon"]], zoom_start=VFR_SECTIONAL_MAX_ZOOM, tiles=None
        )
        folium.TileLayer(
            tiles=FAA_VFR_SECTIONAL_URL,
            attr="FAA Aeronautical Information Services",
            name="VFR Sectional",
            max_zoom=VFR_SECTIONAL_MAX_ZOOM,
            min_zoom=VFR_SECTIONAL_MIN_ZOOM,
        ).add_to(m)
        folium.Marker([row["lat"], row["lon"]]).add_to(m)
        display(m)
        along_track = row.get("along_track_nm", float("nan"))
        print(
            f"[{i + 1}/{len(remaining)}] {row['name'] or '(unnamed)'} "
            f"({row['category']}, along-route {along_track:.1f} nm)"
        )
        raw = input("Rating 1-5 (blank=skip, q=quit): ").strip().lower()
        if raw == "q":
            print("Stopping session.")
            break
        if raw == "":
            continue
        if raw not in {"1", "2", "3", "4", "5"}:
            print(f"Ignored invalid input {raw!r}; re-run the loop to retry this candidate.")
            continue
        _append_rating(row, int(raw), out_path)

    total_labeled = len(_load_labeled_keys(out_path))
    print(f"Session done. {total_labeled} total candidates labeled -> {out_path}")
