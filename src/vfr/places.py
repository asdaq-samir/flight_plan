"""Where a point is, in words a pilot can find on the chart: "by Bangs
Lake", "2 nm NE of Prospect Heights".

A stand-alone VFR waypoint (VPBNG) has no name. The FAA charts it as a
four-point star and its code, and no FAA source carries one -- not NASR's
fix table, the Location Identifiers listing, the CIFP the GPS databases
are built from, nor the tables the charts printed until 2020, which gave
the code and the position alone. Only a waypoint at a visual checkpoint
has a name, the checkpoint's. So a waypoint is described by what is
there instead: a lake, a dam, an island, a summit or a pass, a fort it
sits by, or else the town it is near.

The places are the USGS's Geographic Names (GNIS): its national file,
downloaded once and boiled down to the landmarks and the incorporated
towns (`Civil`: "Village of Wauconda"), which are what the chart labels
-- GNIS's populated places include every subdivision ("The Grove").
Loaded in the background at a service's start; until then, and where
nothing is near, a point has no description.
"""
from __future__ import annotations

import csv
import io
import logging
import tempfile
import threading
import zipfile
from pathlib import Path

import numpy as np
import requests
from scipy.spatial import KDTree

from .config import DATA_DIR
from .geo import _arc_nm, _unit_sphere, bearing_deg, distance_nm
from .retry import with_retries

log = logging.getLogger(__name__)

GNIS_URL = (
    "https://prd-tnm.s3.amazonaws.com/StagedProducts/GeographicNames/DomesticNames/DomesticNames_National_Text.zip"
)
#: The national file boiled down to what describes a point: kind, name,
#: lat, lon.
PLACES_PATH = DATA_DIR / "raw" / "gnis" / "places.csv"

#: What a waypoint can be "by": features a pilot sees from the air.
LANDMARK_CLASSES = {"Lake", "Reservoir", "Dam", "Island", "Gap", "Summit", "Military", "Cape", "Falls"}
#: A landmark this close is what the waypoint marks.
BY_NM = 0.4
#: A town this close is the one the waypoint is in.
IN_NM = 1.0
#: Further than this from any town, a point is left undescribed.
TOWN_NM = 20.0
#: A town is an incorporated place, its GNIS name with its kind in front.
TOWN_PREFIXES = ("City of ", "Village of ", "Town of ", "Borough of ")

_COMPASS = ("N", "NE", "E", "SE", "S", "SW", "W", "NW")

_LOCK = threading.Lock()
_TABLE: dict | None = None


def _row(row: dict) -> tuple[str, str] | None:
    """(kind, name) for a GNIS row worth keeping, or None."""
    name, klass = row.get("feature_name") or "", row.get("feature_class") or ""
    if klass == "Civil":
        prefix = next((p for p in TOWN_PREFIXES if name.startswith(p)), None)
        if prefix is None or "(historical)" in name:
            return None
        return "town", name[len(prefix):]
    if klass in LANDMARK_CLASSES:
        if "(historical)" in name:
            # A fort that closed is still a place on the chart; a lake
            # that was drained is not.
            if klass != "Military":
                return None
            name = name.replace(" (historical)", "")
        return "landmark", name
    return None


def prepare(text_lines, out: Path = PLACES_PATH) -> int:
    """The national file's lines boiled down to PLACES_PATH; how many
    places were kept."""
    out.parent.mkdir(parents=True, exist_ok=True)
    kept = 0
    tmp = out.with_suffix(".tmp")
    with open(tmp, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["kind", "name", "lat", "lon"])
        for row in csv.DictReader(text_lines, delimiter="|"):
            found = _row(row)
            if found is None:
                continue
            try:
                lat, lon = float(row["prim_lat_dec"]), float(row["prim_long_dec"])
            except (KeyError, TypeError, ValueError):
                continue
            if lat == 0.0 and lon == 0.0:
                continue
            writer.writerow([*found, lat, lon])
            kept += 1
    tmp.replace(out)
    return kept


def _download(out: Path = PLACES_PATH) -> None:
    with tempfile.TemporaryFile() as blob:
        def fetch():
            with requests.get(GNIS_URL, stream=True, timeout=120) as resp:
                resp.raise_for_status()
                blob.seek(0)
                blob.truncate()
                for chunk in resp.iter_content(1 << 20):
                    blob.write(chunk)
        with_retries(fetch, describe="USGS GNIS download")
        blob.seek(0)
        with zipfile.ZipFile(blob) as z:
            member = next(n for n in z.namelist() if n.lower().endswith(".txt"))
            with z.open(member) as raw:
                kept = prepare(io.TextIOWrapper(raw, encoding="utf-8-sig", errors="replace"), out)
    log.info("GNIS: %d places kept", kept)


def _load(path: Path) -> dict:
    kinds, names, lats, lons = [], [], [], []
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            kinds.append(row["kind"])
            names.append(row["name"])
            lats.append(float(row["lat"]))
            lons.append(float(row["lon"]))
    table = {}
    for kind in ("landmark", "town"):
        index = [i for i, k in enumerate(kinds) if k == kind]
        lat = np.array([lats[i] for i in index])
        lon = np.array([lons[i] for i in index])
        table[kind] = {
            "names": [names[i] for i in index], "lat": lat, "lon": lon,
            "tree": KDTree(_unit_sphere(lat, lon)) if index else None,
        }
    return table


def preload(path: Path = PLACES_PATH) -> None:
    """Load the places, downloading them the first time."""
    global _TABLE
    with _LOCK:
        if _TABLE is not None:
            return
        if not path.exists():
            _download(path)
        _TABLE = _load(path)


def _nearest(table: dict, kind: str, lat: float, lon: float) -> tuple[str, float, float, float] | None:
    part = table[kind]
    if part["tree"] is None:
        return None
    chord, i = part["tree"].query(_unit_sphere(lat, lon)[0])
    return part["names"][i], float(_arc_nm(np.array(chord))), float(part["lat"][i]), float(part["lon"][i])


def describe(lat: float, lon: float, table: dict | None = None) -> str | None:
    """Where (lat, lon) is: "by Bangs Lake" where a landmark is within
    BY_NM, "in Wauconda" within IN_NM of a town, "2 nm NE of Prospect
    Heights" within TOWN_NM; None further out, or before the places
    have loaded (preload) -- never waited on."""
    table = table if table is not None else _TABLE
    if table is None:
        return None
    landmark = _nearest(table, "landmark", lat, lon)
    if landmark and landmark[1] <= BY_NM:
        return f"by {landmark[0]}"
    town = _nearest(table, "town", lat, lon)
    if not town or town[1] > TOWN_NM:
        return None
    name, _, town_lat, town_lon = town
    away = distance_nm(town_lat, town_lon, lat, lon)
    if away <= IN_NM:
        return f"in {name}"
    heading = _COMPASS[round(bearing_deg(town_lat, town_lon, lat, lon) / 45) % 8]
    return f"{away:.0f} nm {heading} of {name}"

