"""Keyboard-driven labeling UI -- the fast path to clearing retrain()'s
30-label floor (see docs/README.md's Status).

Notebook 03's loop (vfr.labeling.label_candidates) rebuilds an entire
folium map per candidate, which means a fresh Leaflet iframe and a fresh
tile fetch every time, then blocks on input() so each rating costs a
click into the box plus Enter. folium can't re-centre an already-rendered
map from Python, so that rebuild is unavoidable there.

This serves the same candidates over the same FAA sectional tiles, but
builds the map once in the browser and just pans it -- so a rating is one
keystroke and the tiles come from browser cache.

Both paths share vfr.labeling's helpers and write the identical CSV, so
they're interchangeable and a session started in one can be finished in
the other.
"""
import csv
import io
import math
from pathlib import Path

import pandas as pd
from fastapi import FastAPI
from fastapi.responses import FileResponse
from pydantic import BaseModel

from vfr import labeling
from vfr.config import CANDIDATES_PATH, LABELS_PATH, MIN_LABELED_ROWS

app = FastAPI(title="vfr-route labeling")

_INDEX = Path(__file__).resolve().parent / "index.html"


def _candidates() -> pd.DataFrame:
    return pd.read_csv(CANDIDATES_PATH)


class Rating(BaseModel):
    osm_id: str
    osm_type: str
    rating: int


@app.get("/")
def index() -> FileResponse:
    return FileResponse(_INDEX)


@app.get("/api/next")
def next_candidate(skip: int = 0) -> dict:
    """The next unrated candidate, plus progress.

    `skip` walks further down the same shuffled ordering without recording
    anything, so skipping is free and the candidate comes back on a later
    session (matching the notebook loop's blank-input behaviour).
    """
    remaining = labeling.remaining_candidates(_candidates(), LABELS_PATH)
    labeled = len(labeling.load_labeled_keys(LABELS_PATH))

    progress = {
        "labeled": labeled,
        "remaining": len(remaining),
        "needed_for_retrain": max(0, MIN_LABELED_ROWS - labeled),
        "min_labeled_rows": MIN_LABELED_ROWS,
    }

    if skip >= len(remaining):
        return {"done": True, **progress}

    row = remaining.iloc[skip]
    name = row["name"] if isinstance(row["name"], str) and row["name"].strip() else "(unnamed)"
    return {
        "done": False,
        "candidate": {
            "osm_id": str(row["osm_id"]),
            "osm_type": str(row["osm_type"]),
            "name": name,
            "category": row["category"],
            "lat": float(row["lat"]),
            "lon": float(row["lon"]),
            "along_track_nm": float(row.get("along_track_nm", float("nan"))),
        },
        "tile_url": labeling.FAA_VFR_SECTIONAL_URL,
        "max_zoom": labeling.VFR_SECTIONAL_MAX_ZOOM,
        "min_zoom": labeling.VFR_SECTIONAL_MIN_ZOOM,
        **progress,
    }


@app.post("/api/rate")
def rate(rating: Rating) -> dict:
    """Append one rating. Looked up by (osm_id, osm_type) rather than
    trusting the browser's copy of the row, so the CSV always records what
    the candidates file actually says.
    """
    if rating.rating not in (1, 2, 3, 4, 5):
        return {"ok": False, "error": f"rating must be 1-5, got {rating.rating}"}

    candidates = _candidates()
    match = candidates[
        (candidates["osm_id"].astype(str) == rating.osm_id)
        & (candidates["osm_type"].astype(str) == rating.osm_type)
    ]
    if match.empty:
        return {"ok": False, "error": f"no candidate {rating.osm_id}/{rating.osm_type}"}

    labeling.append_rating(match.iloc[0], rating.rating, LABELS_PATH)
    return {"ok": True, "labeled": len(labeling.load_labeled_keys(LABELS_PATH))}


@app.get("/api/labeled")
def labeled() -> dict:
    """Everything rated so far, in the order it was labeled, joined back to
    the candidates file for coordinates (the labels CSV stores no lat/lon).

    Labeling order is deliberate: rating drift tends to show up over the
    course of a session, so reviewing chronologically makes it visible.
    Also returns the rating distribution, which is the fastest way to spot
    an inconsistent scale (e.g. nothing ever rated 3).
    """
    path = Path(LABELS_PATH)
    if not path.exists():
        return {"rows": [], "distribution": {}}

    labels = pd.read_csv(path, keep_default_na=False)
    if labels.empty:
        return {"rows": [], "distribution": {}}

    candidates = _candidates()
    coords = {
        (str(r["osm_id"]), str(r["osm_type"])): (float(r["lat"]), float(r["lon"]))
        for _, r in candidates.iterrows()
    }

    rows = []
    for _, r in labels.iterrows():
        key = (str(r["osm_id"]), str(r["osm_type"]))
        lat, lon = coords.get(key, (None, None))
        name = str(r["name"]).strip()
        rows.append(
            {
                "osm_id": key[0],
                "osm_type": key[1],
                # Older rows were written before empty names were handled,
                # so a literal "nan" can appear here.
                "name": name if name and name.lower() != "nan" else "(unnamed)",
                "category": str(r["category"]),
                "rating": int(r["rating"]),
                "lat": lat,
                "lon": lon,
                # A label can outlive its candidate if collect() is re-run
                # and the feature is dropped or recategorised.
                "on_map": lat is not None,
            }
        )

    distribution = {str(k): int(v) for k, v in sorted(labels["rating"].value_counts().items())}
    return {
        "rows": rows,
        "distribution": distribution,
        "tile_url": labeling.FAA_VFR_SECTIONAL_URL,
        "max_zoom": labeling.VFR_SECTIONAL_MAX_ZOOM,
        "min_zoom": labeling.VFR_SECTIONAL_MIN_ZOOM,
    }


@app.post("/api/relabel")
def relabel(rating: Rating) -> dict:
    """Change an existing rating in place.

    Rewrites only the one matching line and passes every other line
    through as raw text, so the rest of the file stays byte-identical --
    same reasoning as undo(). Fields are parsed with csv rather than
    split(",") because names can legitimately contain commas.
    """
    if rating.rating not in (1, 2, 3, 4, 5):
        return {"ok": False, "error": f"rating must be 1-5, got {rating.rating}"}

    path = Path(LABELS_PATH)
    if not path.exists():
        return {"ok": False, "error": "nothing labeled yet"}

    with path.open("r", newline="") as f:
        lines = f.readlines()

    for i, line in enumerate(lines[1:], start=1):
        fields = next(csv.reader([line]))
        if len(fields) < 5 or fields[0] != rating.osm_id or fields[1] != rating.osm_type:
            continue
        was = fields[4]
        fields[4] = str(rating.rating)
        buf = io.StringIO()
        csv.writer(buf, lineterminator="\r\n" if line.endswith("\r\n") else "\n").writerow(fields)
        lines[i] = buf.getvalue()
        with path.open("w", newline="") as f:
            f.writelines(lines)
        return {"ok": True, "was": was, "now": rating.rating}

    return {"ok": False, "error": f"no label for {rating.osm_id}/{rating.osm_type}"}


@app.post("/api/undo")
def undo() -> dict:
    """Drop the most recent rating -- the cost of going fast is the
    occasional mis-key, and without this the fix is hand-editing a CSV.

    Truncates the last line textually rather than round-tripping the file
    through pandas. A read_csv/to_csv cycle silently rewrites rows it was
    never asked to touch (a literal "nan" in the name column comes back
    as an empty field, for one), and these labels are the scarcest thing
    in the project -- undo should remove one line and leave every other
    byte alone.

    newline="" on both ends matters: csv.DictWriter (see
    vfr.labeling.append_rating) writes CRLF, while read_text/write_text
    apply universal-newline translation, so the obvious implementation
    silently converts the whole file to LF -- and the next append would
    then leave it mixed.
    """
    path = Path(LABELS_PATH)
    if not path.exists():
        return {"ok": False, "error": "nothing labeled yet"}

    with path.open("r", newline="") as f:
        lines = f.readlines()
    if len(lines) <= 1:  # header only, or empty
        return {"ok": False, "error": "nothing labeled yet"}

    removed = lines[-1].rstrip("\r\n").split(",")
    with path.open("w", newline="") as f:
        f.writelines(lines[:-1])
    return {
        "ok": True,
        "removed": {
            "name": removed[2] if len(removed) > 2 else "?",
            "rating": removed[4] if len(removed) > 4 else "?",
        },
        "labeled": len(labeling.load_labeled_keys(LABELS_PATH)),
    }
