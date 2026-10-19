"""An approach's chart on the map: the plan view of the FAA's plate for an
approach picked (the d-TPP's PDF), placed where it belongs, as an EFB's
georeferenced plates are, at the owner's ask ("Also show the approach
plate on the map when selected").

The FAA's plates are GeoPDFs: each page's /VP viewport carries the plan
view's projection and four points of it with their latitude and longitude
(Georeference). That is what places the plate -- every ILS, LOC, VOR and
RNAV plate of the 129 looked at has one, and the CIFP's waypoints
(vfr.procedures) fall within a tenth of a point of their stars drawn on
it. The plan view is cut from the page at the lines that box the airport,
and drawn black on clear, its white let through to the chart under it. A
plate without a georeference is not placed: a picture put a mile out
would be worse than none.

A reference to fly the dry run and the route against, not a chart to
navigate by: the plate itself, in the d-TPP, is that.
"""
from __future__ import annotations

import io
import json
import logging
import os
import re
import threading
from datetime import date
from pathlib import Path

import numpy as np
import pypdfium2
import pypdfium2.raw as pdfium_c
import pyproj
from PIL import Image

from . import procedures, publications

log = logging.getLogger(__name__)

#: How much finer than its points a plate's plan view is drawn: 4 is 288
#: dots an inch, its lines sharp on a phone at the approach's zoom.
PLATE_SCALE = 4
#: Bumped when the placing changes: a plate kept as not placed by an
#: older one is tried again, the cycle's placed ones kept. 3: the FAA's
#: own georeference, where 2 matched the plate's waypoint stars.
PLACING_VERSION = 3
#: A line that boxes the plan view: this long at least, in points.
BOX_LINE_PT = 150.0
#: How far past the airport, above and below, a side of its plan view
#: runs at least, in points.
SIDE_PAST_PT = 5.0
#: The projection parameters a plate's georeference must name.
LCC_PARAMETERS = ("Latitude_Of_Origin", "Central_Meridian", "Standard_Parallel_1", "Standard_Parallel_2")

_LOCK = threading.Lock()
_MAKING: dict = {}


def _runway(name: str) -> str | None:
    """A procedure's runway as a number without its leading nought, with
    its side: "RWY 03" and "RWY 3" are one ("3"), "RWY 09L" is "9L"."""
    m = re.search(r"RWY\s*0*(\d{1,2}[LRC]?)", name.upper())
    return m.group(1) if m else None


def _kind(name: str) -> tuple:
    """What guides an approach, as both the CIFP's name and the plate's
    title say it, and its letter where it has one ("RNAV (GPS) Y RWY 9":
    ("RNAV", "Y")): the first word, GPS and RNAV one family."""
    upper = name.upper()
    first = re.split(r"[\s(/]", upper.strip())[0]
    family = "RNAV" if first in ("RNAV", "GPS") else first
    letter = re.search(r"\b([W-Z])\s+RWY", upper)
    return family, letter.group(1) if letter else None


def plate_for(cifp_name: str, charts: list) -> dict | None:
    """The d-TPP chart (terminal_charts' {kind, name, url}) that is the
    approach the CIFP names: an approach plate (IAP) to the same runway,
    by the same means and with the same letter. Of several -- "ILS RWY 9",
    "ILS RWY 9 (SA CAT I)", "ILS RWY 9 (CAT II)" -- the plainest, which
    the CIFP's coded approach is."""
    runway, kind = _runway(cifp_name), _kind(cifp_name)
    if runway is None:
        return None
    found = [c for c in charts if c.get("kind") == "IAP" and _runway(c["name"]) == runway and _kind(c["name"]) == kind]
    found.sort(key=lambda c: ("CAT" in c["name"].upper(), len(c["name"])))
    return found[0] if found else None


class Georeference:
    """How a plate's page and the ground match, as its GeoPDF viewport
    says (ISO 32000-2 12.9, a /VP with a /Measure of subtype GEO): a
    Lambert conformal conic projection, from its WKT's parameters, and
    four points of the viewport's box (LPTS, fractions of it) with where
    they are on the ground (GPTS, latitude and longitude in pairs). The
    page is an affine picture of the projection, so the four points fix
    it."""

    def __init__(self, box: tuple, lpts: list, gpts: list, projection: dict):
        lcc = pyproj.CRS.from_proj4(
            f"+proj=lcc +lat_0={projection['Latitude_Of_Origin']} +lon_0={projection['Central_Meridian']} "
            f"+lat_1={projection['Standard_Parallel_1']} +lat_2={projection['Standard_Parallel_2']} +datum=NAD83 +units=m")
        self._to = pyproj.Transformer.from_crs("EPSG:4269", lcc, always_xy=True)
        self._back = pyproj.Transformer.from_crs(lcc, "EPSG:4269", always_xy=True)
        left, bottom, right, top = box
        page = np.array([(left + fx * (right - left), bottom + fy * (top - bottom), 1.0) for fx, fy in zip(lpts[::2], lpts[1::2])])
        ground = np.array([self._to.transform(lon, lat) for lat, lon in zip(gpts[::2], gpts[1::2])])
        fitted, *_ = np.linalg.lstsq(page, ground, rcond=None)
        self._page_to_ground = np.vstack([fitted.T, [0.0, 0.0, 1.0]])
        self._ground_to_page = np.linalg.inv(self._page_to_ground)

    def page_of(self, lat: float, lon: float) -> tuple:
        """Where on the page a point on the ground is drawn, in points
        from the page's bottom left."""
        x, y = self._to.transform(lon, lat)
        px, py, _ = self._ground_to_page @ (x, y, 1.0)
        return float(px), float(py)

    def ground_of(self, x: float, y: float) -> tuple:
        """Where a point of the page is on the ground, (lat, lon)."""
        gx, gy, _ = self._page_to_ground @ (x, y, 1.0)
        lon, lat = self._back.transform(gx, gy)
        return float(lat), float(lon)


def _figures(key: str, text: str) -> list:
    """The numbers of a PDF array named `key` in `text`: "/GPTS[41.6 -89.5 …]"."""
    m = re.search(rf"/{key}\s*\[([^\]]*)\]", text)
    return [float(v) for v in re.findall(r"-?\d+(?:\.\d+)?", m.group(1))] if m else []


def georeference_of(pdf: bytes) -> Georeference | None:
    """A plate's own georeference, from its page's /VP viewport; None
    where it has none, or one of another projection. Read from the file's
    bytes: pdfium does not give a page's dictionary."""
    at = pdf.find(b"/VP")
    if at < 0:
        return None
    text = pdf[at:at + 8000].decode("latin-1")
    viewport = text[:text.find("/Type/Viewport")] if "/Type/Viewport" in text else text
    box, lpts, gpts = _figures("BBox", viewport), _figures("LPTS", viewport), _figures("GPTS", viewport)
    projection = {k: float(v) for k, v in re.findall(r'PARAMETER\["(\w+)",(-?\d+(?:\.\d+)?)\]', viewport)}
    if ("Lambert_Conformal_Conic" not in viewport or len(box) != 4 or len(lpts) != 8 or len(gpts) != 8
            or any(k not in projection for k in LCC_PARAMETERS)):
        return None
    return Georeference(tuple(box), lpts, gpts, projection)


def _box_lines(page) -> tuple:
    """The page's long straight lines: horizontal ones as (y, left,
    right), vertical ones as (x, bottom, top)."""
    across, down = [], []
    for obj in page.get_objects(max_depth=15):
        if obj.type != pdfium_c.FPDF_PAGEOBJ_PATH:
            continue
        left, bottom, right, top = obj.get_bounds()
        w, h = right - left, top - bottom
        if w >= BOX_LINE_PT and h < 2:
            across.append(((bottom + top) / 2, left, right))
        elif h >= BOX_LINE_PT and w < 2:
            down.append(((left + right) / 2, bottom, top))
    return across, down


def plan_view_box(across: list, down: list, airport: tuple, page: tuple) -> tuple:
    """The plan view's box on the page, (left, bottom, right, top), round
    the airport drawn in it: the nearest long lines to either side of it,
    then above and below it across that width, the page's own edges where
    there is none."""
    width, height = page
    x, y = airport
    # A side runs past the airport, above and below: the profile's own
    # divider, under a plan view whose airport is drawn at its foot, ends
    # at the airport's height (KLSE's RNAV (GPS) RWY 18).
    beside = lambda lo, hi: lo <= y - SIDE_PAST_PT and hi >= y + SIDE_PAST_PT  # noqa: E731
    left = max((at for at, lo, hi in down if at < x and beside(lo, hi)), default=0.0)
    right = min((at for at, lo, hi in down if at > x and beside(lo, hi)), default=width)
    # Its top and bottom lines need only run along part of it: under the
    # plan view, the profile's box and the minimums' are often drawn as
    # lines of their own, side by side.
    along = lambda lo, hi: min(hi, right) - max(lo, left) >= BOX_LINE_PT / 2  # noqa: E731
    top = min((at for at, lo, hi in across if at > y and along(lo, hi)), default=height)
    bottom = max((at for at, lo, hi in across if at < y and along(lo, hi)), default=0.0)
    return left, bottom, right, top


def _plan_view(pdf: bytes, fixes: dict, airport: tuple) -> tuple | None:
    """The plate's plan view drawn black on clear (PNG bytes), and its
    corners on the ground {south, west, north, east, fixes: the
    approach's fixes inside it}; None where the plate has no
    georeference, or its airport (`airport`, (lat, lon)) would be off
    the page."""
    geo = georeference_of(pdf)
    if geo is None:
        return None
    # Every plan view draws its own airport (the d-TPP legend's plan
    # view), so the box round the airport is the plan view's.
    x, y = geo.page_of(*airport)
    with publications._PDFIUM:
        document = pypdfium2.PdfDocument(pdf)
        try:
            page = document[0]
            width, height = page.get_size()
            if not (0 < x < width and 0 < y < height):
                return None
            across, down = _box_lines(page)
            left, bottom, right, top = plan_view_box(across, down, (x, y), (width, height))
            image = page.render(scale=PLATE_SCALE, grayscale=True).to_pil().convert("L")
        finally:
            document.close()
    # Inside the box's own lines, a point in.
    crop = image.crop((round((left + 1) * PLATE_SCALE), round((height - top + 1) * PLATE_SCALE),
                       round((right - 1) * PLATE_SCALE), round((height - bottom - 1) * PLATE_SCALE)))
    grey = np.asarray(crop, dtype=np.uint8)
    # Black where the plate is black, clear where it is white, its greys
    # (water, terrain) part clear.
    rgba = np.zeros((*grey.shape, 4), dtype=np.uint8)
    rgba[..., 3] = 255 - grey
    out = io.BytesIO()
    Image.fromarray(rgba, "RGBA").save(out, "PNG", optimize=True)
    # Its corners as a latitude-longitude box, which the map's picture
    # is: the projection's meridians lean a fraction of a degree across
    # a plan view, about a tenth of a mile at its edges at most.
    south, west = geo.ground_of(left + 1, bottom + 1)
    north, east = geo.ground_of(right - 1, top - 1)
    drawn = {f: geo.page_of(*at) for f, at in fixes.items()}
    inside = [f for f, (fx, fy) in drawn.items() if left < fx < right and bottom < fy < top]
    return out.getvalue(), {"south": south, "west": west, "north": north, "east": east, "fixes": inside}


def _fixes_of(ident: str, procedure: str) -> dict:
    """Every fix of an approach, every transition's, {ident: (lat, lon)}."""
    listed = procedures.procedures_at(ident) or {"procedures": []}
    summary = next((p for p in listed["procedures"] if p["id"] == procedure), None)
    if summary is None:
        return {}
    fixes: dict = {}
    for transition in [None, *summary["transitions"]]:
        drawn = procedures.procedure_drawing(ident, procedure, transition)
        for f in (drawn or {}).get("fixes", []):
            fixes.setdefault(f["ident"], (f["lat"], f["lon"]))
    return fixes


def _kept(meta: Path) -> dict | None:
    """What plate_overlay kept for a plate this cycle, or None to make it
    (again): never made, or not placed by an older way of placing."""
    if not meta.exists():
        return None
    kept = json.loads(meta.read_text())
    return kept if kept["placed"] or kept.get("fit") == PLACING_VERSION else None


def plate_overlay(ident: str, procedure: str, on: date | None = None) -> dict | None:
    """An approach's plate's plan view placed on the map, made once a
    cycle and kept: {"cycle", "name" (the plate's title), "south",
    "west", "north", "east", "png" (its picture's path on disk)}; None
    where the field has no such plate, the plate cannot be placed, or the
    FAA cannot be reached (nothing kept then, so the next ask tries
    again)."""
    cycle = publications.dtpp_cycle(on)
    listed = procedures.procedures_at(ident, on) or {"procedures": []}
    summary = next((p for p in listed["procedures"] if p["id"] == procedure.strip().upper()), None)
    if summary is None or summary["kind"] != "approach":
        return None
    chart = plate_for(summary["name"], publications.terminal_charts(ident, on))
    if chart is None:
        return None
    source = publications._source_of(chart["url"], on)
    if source is None:
        return None
    stem = f"{Path(source[2]).stem}-{summary['id']}"
    folder = publications.CACHE_DIR / "plates" / cycle
    meta, png = folder / f"{stem}.json", folder / f"{stem}.png"
    # A plate kept as not placed is None, as when it was made: its
    # meta has no corners to answer with.
    if (kept := _kept(meta)) is not None:
        return {**kept, "png": png} if kept["placed"] else None
    with _LOCK:
        lock = _MAKING.setdefault(meta, threading.Lock())
    with lock:
        if (kept := _kept(meta)) is not None:
            return {**kept, "png": png} if kept["placed"] else None
        try:
            pdf = publications._pdf_of(*source)
        except publications.FaaUnreachable:
            return None
        if pdf is None:
            return None
        airport = procedures.airport_place(ident, on)
        try:
            made = None if airport is None else _plan_view(pdf, _fixes_of(ident, summary["id"]), airport)
        except pypdfium2.PdfiumError as err:
            log.warning("No plate for %s %s: %s", ident, procedure, err)
            made = None
        found = {"cycle": cycle, "name": chart["name"], "placed": made is not None, "fit": PLACING_VERSION}
        folder.mkdir(parents=True, exist_ok=True)
        if made is not None:
            picture, corners = made
            png.with_name(png.name + ".part").write_bytes(picture)
            os.replace(png.with_name(png.name + ".part"), png)
            found.update(corners)
        # Kept either way: a plate that does not place is not tried again
        # this cycle, until the placing changes.
        meta.with_name(meta.name + ".part").write_text(json.dumps(found))
        os.replace(meta.with_name(meta.name + ".part"), meta)
    return {**found, "png": png} if found["placed"] else None
