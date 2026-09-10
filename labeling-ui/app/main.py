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

It also serves the route view at /route, which plots a whole scored route
on the same sectional: the course line, every candidate, and the
checkpoints vfr.checkpoints actually selected. Reading a list of names
tells you nothing about whether the checkpoints are findable in the air
or sensibly spaced -- seeing them on the chart does. That lives here
rather than in model-service because model-service is deliberately
/ping + /invocations only, mirroring a SageMaker inference container,
and this is a human-facing chart tool that already has the sectional tile
layer working. The service name is now narrower than what it does.
"""
import csv
import io
import math
from pathlib import Path

import pandas as pd
import requests
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from vfr import airports, checkpoints as checkpoint_selection, geo, labeling
from vfr.config import CANDIDATES_PATH, LABELS_PATH, MIN_LABELED_ROWS

app = FastAPI(title="vfr-route labeling")

_INDEX = Path(__file__).resolve().parent / "index.html"
_ROUTE = Path(__file__).resolve().parent / "route.html"

# Where to ask for scored candidates. A query parameter rather than a
# fixed value because one model-service instance serves exactly one
# corridor's feature store, so a second route means a second instance on
# another port.
DEFAULT_MODEL_SERVICE = "http://model-service:8000"


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


@app.get("/route")
def route_page() -> FileResponse:
    return FileResponse(_ROUTE)


def _course_line(start: tuple, end: tuple, step_nm: float = 5.0) -> list:
    """The course line as [[lat, lon], ...], following the great circle.

    Stepped with the bearing recomputed toward the destination at every
    point, which is what makes it the actual great circle: hold the
    initial bearing constant instead and you trace a different path that
    can sit a couple of miles off the true course at the midpoint of a
    300 nm leg. That matters here because candidate positions come from
    great-circle cross-track distance, so a drawn line on any other path
    would show on-course checkpoints as visibly off it.
    """
    total = geo.distance_nm(start[0], start[1], end[0], end[1])
    points, current, travelled = [list(start)], start, 0.0
    while travelled + step_nm < total:
        bearing = geo.bearing_deg(current[0], current[1], end[0], end[1])
        current = geo.destination_point(current[0], current[1], bearing, step_nm)
        travelled += step_nm
        points.append(list(current))
    points.append(list(end))
    return points


@app.get("/api/routes")
def available_routes(svc: str = DEFAULT_MODEL_SERVICE) -> dict:
    """Which corridors model-service has a feature store for, so the page
    can offer them instead of letting someone type into a void."""
    try:
        return requests.get(f"{svc}/routes", timeout=10).json()
    except requests.RequestException as err:
        raise HTTPException(502, f"Could not reach model-service at {svc}: {err}") from err


@app.get("/api/route")
def route_data(
    dep: str = "C81", dest: str = "KDLH", svc: str = DEFAULT_MODEL_SERVICE
) -> dict:
    """Everything the route view needs: the course line, every scored
    candidate, and the selected checkpoints with their leg distances.
    """
    dep_ident, dest_ident = dep.strip().upper(), dest.strip().upper()

    # Resolve the idents before asking model-service for anything. A
    # typo'd ident would otherwise come back as model-service's "no
    # feature store, build it first" -- advice whose very first command
    # would then fail, since there is no such airport to collect around.
    try:
        dep_airport = airports.get_airport(dep_ident)
        dest_airport = airports.get_airport(dest_ident)
    except ValueError as err:
        raise HTTPException(404, str(err)) from err

    try:
        ping = requests.get(f"{svc}/ping", timeout=10).json()
        if not ping.get("model_loaded"):
            raise HTTPException(503, f"{svc} has no model loaded: {ping.get('status')}")
        resp = requests.post(
            f"{svc}/invocations",
            json={"departure_ident": dep_ident, "destination_ident": dest_ident},
            timeout=60,
        )
    except requests.RequestException as err:
        raise HTTPException(502, f"Could not reach model-service at {svc}: {err}") from err

    if resp.status_code != 200:
        # Passed straight through: model-service's 404 body carries the
        # build commands for an un-collected corridor, which is exactly
        # what the person typing the idents needs to see.
        detail = resp.json().get("detail", resp.text)
        raise HTTPException(resp.status_code, detail)
    scored = resp.json()["checkpoints"]

    start = (dep_airport["lat"], dep_airport["lon"])
    end = (dest_airport["lat"], dest_airport["lon"])

    selected = checkpoint_selection.select_checkpoints(scored)
    selected_keys = {(c["osm_id"], c["category"]) for c in selected}
    for c in scored:
        c["selected"] = (c["osm_id"], c["category"]) in selected_keys

    legs = [
        {
            "from": a["name"] or a["category"],
            "to": b["name"] or b["category"],
            "distance_nm": round(
                geo.distance_nm(a["lat"], a["lon"], b["lat"], b["lon"]), 1
            ),
            "bearing_deg": round(
                geo.bearing_deg(a["lat"], a["lon"], b["lat"], b["lon"])
            ),
        }
        for a, b in zip(selected, selected[1:])
    ]

    return {
        "departure": {"ident": dep_ident, "name": dep_airport["name"], "lat": start[0], "lon": start[1]},
        "destination": {"ident": dest_ident, "name": dest_airport["name"], "lat": end[0], "lon": end[1]},
        "distance_nm": round(geo.distance_nm(start[0], start[1], end[0], end[1]), 1),
        "course_line": _course_line(start, end),
        "candidates": scored,
        "selected": selected,
        "legs": legs,
        "tile_url": labeling.FAA_VFR_SECTIONAL_URL,
        "max_zoom": labeling.VFR_SECTIONAL_MAX_ZOOM,
        "min_zoom": labeling.VFR_SECTIONAL_MIN_ZOOM,
        "service": svc,
    }
