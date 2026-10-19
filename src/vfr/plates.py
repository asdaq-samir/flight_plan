"""An approach's chart on the map: the plan view of the FAA's plate for an
approach picked (the d-TPP's PDF), placed where it belongs by its own
waypoints, as an EFB's georeferenced plates are, at the owner's ask
("Also show the approach plate on the map when selected").

The FAA's plates carry no coordinates of their own. A plate's plan view is
drawn to scale with north up (FAA Order 8260.19 and the IAP charting
specification), so it is placed by matching the waypoints drawn on it to
the CIFP's (vfr.procedures): each named fix's star -- two squares of the
same size overlapping, half their size apart -- found near its name on
the plate, and the one scale and offset that puts most of them where the
CIFP has them, within FIT_PT. A plate whose fixes do not fit, or fit only
turned (a plan view drawn other than north up), is not placed: a picture
put a mile out would be worse than none. The plan view is cut from the
page at the lines that box it, and drawn black on clear, its white let
through to the chart under it.

A reference to fly the dry run and the route against, not a chart to
navigate by: the plate itself, in the d-TPP, is that.
"""
from __future__ import annotations

import io
import itertools
import json
import logging
import math
import os
import re
import threading
from datetime import date
from pathlib import Path

import numpy as np
import pypdfium2
import pypdfium2.raw as pdfium_c
from PIL import Image

from . import procedures, publications

log = logging.getLogger(__name__)

#: How much finer than its points a plate's plan view is drawn: 4 is 288
#: dots an inch, its lines sharp on a phone at the approach's zoom.
PLATE_SCALE = 4
#: A waypoint's star on a plate is two squares this size, in points,
#: overlapping, their middles this far apart (the FAA's fly-by symbol).
SYMBOL_PT = (8.5, 11.5)
SYMBOL_APART_PT = (5.0, 10.0)
#: How near its name a fix's star is looked for, in points.
LABEL_NEAR_PT = 45.0
#: How near where the fit puts it a fix's star must be, in points: about
#: a fifth of a mile at a plan view's usual ten points a mile. A fix
#: drawn in a part not to scale (a feeder broken by a zigzag, an inset)
#: misses by far more and is left out of the placing.
FIT_PT = 2.0
#: The scales the d-TPP draws most plan views at, in points a nm:
#: 1:500,000 (a nm 3.70 mm, 10.50 points) and 1:750,000 for a larger area
#: (7.00), within SCALE_PART. Measured on the plates placed by three or
#: more fixes; a busy field's RNP plates are drawn larger (KMDW's at
#: 1:250,000 and about 1:300,000), so other scales still place on three.
PLAN_SCALES = (1852 / 500_000 / 0.0254 * 72, 1852 / 750_000 / 0.0254 * 72)
SCALE_PART = 0.015
#: The fixes a placing needs to agree on it: three at any scale, or two
#: at a plan scale, where the scale itself is the third check -- most
#: ILS plates show only two fixes as stars, the rest as navaid symbols.
FIT_FIXES = 3
PAIR_FIXES = 2
#: Bumped when fit() places more: a plate kept as not placed by an older
#: fit is tried again, the cycle's placed ones kept.
FIT_VERSION = 2
#: A plan view turned more than this is not placed: the map draws a
#: picture north up.
MAX_TURN_DEG = 1.0
#: A line that boxes the plan view: this long at least, in points.
BOX_LINE_PT = 150.0

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


def words_of(page) -> list:
    """The page's words in capitals and figures with each one's box,
    (text, (left, bottom, right, top)) in points from its bottom left."""
    text = page.get_textpage()
    words, word, box = [], "", None
    for i in range(text.count_chars()):
        ch = text.get_text_range(i, 1)
        if re.match(r"[A-Z0-9]", ch):
            left, bottom, right, top = text.get_charbox(i)
            if word and box and abs(left - box[2]) < 3 and abs(bottom - box[1]) < 3:
                word, box = word + ch, (box[0], min(box[1], bottom), right, max(box[3], top))
            else:
                if word:
                    words.append((word, box))
                word, box = ch, (left, bottom, right, top)
        elif word:
            words.append((word, box))
            word, box = "", None
    if word:
        words.append((word, box))
    return words


def stars_of(squares: list) -> list:
    """Where a waypoint's star is drawn, from the page's squares of its
    size (SYMBOL_PT, their middles): two of them half their size apart
    are one star, at the middle between them."""
    stars = []
    for p, q in itertools.combinations(squares, 2):
        if SYMBOL_APART_PT[0] < math.hypot(p[0] - q[0], p[1] - q[1]) < SYMBOL_APART_PT[1]:
            stars.append(((p[0] + q[0]) / 2, (p[1] + q[1]) / 2))
    return stars


def _lines_and_squares(page) -> tuple:
    """The page's long straight lines (horizontal ones as (y, left,
    right), vertical as (x, bottom, top)) and the middles of its squares
    of a waypoint star's size."""
    across, down, squares = [], [], []
    for obj in page.get_objects(max_depth=15):
        if obj.type != pdfium_c.FPDF_PAGEOBJ_PATH:
            continue
        left, bottom, right, top = obj.get_bounds()
        w, h = right - left, top - bottom
        if w >= BOX_LINE_PT and h < 2:
            across.append(((bottom + top) / 2, left, right))
        elif h >= BOX_LINE_PT and w < 2:
            down.append(((left + right) / 2, bottom, top))
        elif SYMBOL_PT[0] <= w <= SYMBOL_PT[1] and SYMBOL_PT[0] <= h <= SYMBOL_PT[1]:
            squares.append(((left + right) / 2, (bottom + top) / 2))
    return across, down, squares


def fit(words: list, stars: list, fixes: dict) -> dict | None:
    """The plan view's placing: the scale (points a nm) and turn that put
    most of the fixes' stars where the CIFP has the fixes, `fixes` {ident:
    (lat, lon)}, each star looked for near the fix's name. Tried from each
    pair of fixes and kept where the most agree, within FIT_PT, the
    nearest first; at least FIT_FIXES must, or PAIR_FIXES at one of a plan
    view's own scales (PLAN_SCALES), or None. Returns how to go
    from the page to the ground: {"lat0", "lon0", "scale", "turn",
    "x0", "y0", "fixes": the idents that agreed}."""
    if len(fixes) < 2:
        return None
    lat0 = sum(lat for lat, _ in fixes.values()) / len(fixes)
    lon0 = sum(lon for _, lon in fixes.values()) / len(fixes)
    k = math.cos(math.radians(lat0))
    # nm east and north of the fixes' middle.
    at = {f: ((lon - lon0) * 60 * k, (lat - lat0) * 60) for f, (lat, lon) in fixes.items()}
    near = {
        f: [s for s in stars if any(
            word == f and math.hypot(s[0] - (b[0] + b[2]) / 2, s[1] - (b[1] + b[3]) / 2) < LABEL_NEAR_PT for word, b in words)]
        for f in fixes
    }
    best = None
    for a, b in itertools.combinations(fixes, 2):
        de, dn = at[b][0] - at[a][0], at[b][1] - at[a][1]
        ground = math.hypot(de, dn)
        if ground < 1:
            continue
        for pa in near[a]:
            for pb in near[b]:
                scale = math.hypot(pb[0] - pa[0], pb[1] - pa[1]) / ground
                if scale <= 0:
                    continue
                turn = math.atan2(pb[1] - pa[1], pb[0] - pa[0]) - math.atan2(dn, de)
                turn = (turn + math.pi) % (2 * math.pi) - math.pi
                c, s = math.cos(turn), math.sin(turn)
                x0 = pa[0] - scale * (c * at[a][0] - s * at[a][1])
                y0 = pa[1] - scale * (s * at[a][0] + c * at[a][1])
                agreed, off = [], 0.0
                for f in fixes:
                    px = x0 + scale * (c * at[f][0] - s * at[f][1])
                    py = y0 + scale * (s * at[f][0] + c * at[f][1])
                    miss = min((math.hypot(px - q[0], py - q[1]) for q in near[f]), default=math.inf)
                    if miss <= FIT_PT:
                        agreed.append(f)
                        off += miss
                at_plan = any(abs(scale - plan) <= plan * SCALE_PART for plan in PLAN_SCALES)
                if len(agreed) < (PAIR_FIXES if at_plan else FIT_FIXES):
                    continue
                if best is None or len(agreed) > len(best[0]) or (len(agreed) == len(best[0]) and off < best[1]):
                    best = (agreed, off, scale, turn, x0, y0)
    if best is None:
        return None
    agreed, _, scale, turn, x0, y0 = best
    return {"lat0": lat0, "lon0": lon0, "scale": scale, "turn": math.degrees(turn), "x0": x0, "y0": y0, "fixes": agreed}


def ground_of(placing: dict, x: float, y: float) -> tuple:
    """Where a point of the page is on the ground, (lat, lon), by the
    plan view's placing (fit)."""
    turn = math.radians(placing["turn"])
    c, s = math.cos(turn), math.sin(turn)
    dx, dy = (x - placing["x0"]) / placing["scale"], (y - placing["y0"]) / placing["scale"]
    east, north = c * dx + s * dy, -s * dx + c * dy
    lat = placing["lat0"] + north / 60
    lon = placing["lon0"] + east / (60 * math.cos(math.radians(placing["lat0"])))
    return lat, lon


def plan_view_box(across: list, down: list, inside: list, page: tuple) -> tuple:
    """The plan view's box on the page, (left, bottom, right, top): the
    nearest long lines above, below and to either side of what is drawn
    in it (`inside`, the fixes' stars), the page's own edges where there
    is none."""
    width, height = page
    xs, ys = [p[0] for p in inside], [p[1] for p in inside]
    middle_x, middle_y = sum(xs) / len(xs), sum(ys) / len(ys)
    # A line's two ends, either way, reaching across what is inside.
    reaches = lambda lo, hi, at: lo - 2 <= at <= hi + 2  # noqa: E731
    top = min((y for y, lo, hi in across if y > max(ys) and reaches(lo, hi, middle_x)), default=height)
    bottom = max((y for y, lo, hi in across if y < min(ys) and reaches(lo, hi, middle_x)), default=0.0)
    left = max((x for x, lo, hi in down if x < min(xs) and reaches(lo, hi, middle_y)), default=0.0)
    right = min((x for x, lo, hi in down if x > max(xs) and reaches(lo, hi, middle_y)), default=width)
    return left, bottom, right, top


def _plan_view(pdf: bytes, fixes: dict) -> tuple | None:
    """The plate's plan view drawn black on clear (PNG bytes), and its
    corners on the ground {south, west, north, east}; None where its
    fixes do not place it north up."""
    with publications._PDFIUM:
        document = pypdfium2.PdfDocument(pdf)
        try:
            page = document[0]
            width, height = page.get_size()
            across, down, squares = _lines_and_squares(page)
            placing = fit(words_of(page), stars_of(squares), fixes)
            if placing is None or abs(placing["turn"]) > MAX_TURN_DEG:
                return None
            stars = []
            turn = math.radians(placing["turn"])
            for f in placing["fixes"]:
                lat, lon = fixes[f]
                e = (lon - placing["lon0"]) * 60 * math.cos(math.radians(placing["lat0"]))
                n = (lat - placing["lat0"]) * 60
                stars.append((placing["x0"] + placing["scale"] * (math.cos(turn) * e - math.sin(turn) * n),
                              placing["y0"] + placing["scale"] * (math.sin(turn) * e + math.cos(turn) * n)))
            left, bottom, right, top = plan_view_box(across, down, stars, (width, height))
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
    south, west = ground_of(placing, left + 1, bottom + 1)
    north, east = ground_of(placing, right - 1, top - 1)
    return out.getvalue(), {"south": south, "west": west, "north": north, "east": east, "fixes": placing["fixes"]}


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
    (again): never made, or not placed by an older fit()."""
    if not meta.exists():
        return None
    kept = json.loads(meta.read_text())
    return kept if kept["placed"] or kept.get("fit") == FIT_VERSION else None


def plate_overlay(ident: str, procedure: str, on: date | None = None) -> dict | None:
    """An approach's plate's plan view placed on the map, made once a
    cycle and kept: {"cycle", "name" (the plate's title), "south",
    "west", "north", "east", "png" (its picture's path on disk)}; None
    where the field has no such plate, the plate's fixes do not place it,
    or the FAA cannot be reached (nothing kept then, so the next ask
    tries again)."""
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
        try:
            made = _plan_view(pdf, _fixes_of(ident, summary["id"]))
        except pypdfium2.PdfiumError as err:
            log.warning("No plate for %s %s: %s", ident, procedure, err)
            made = None
        found = {"cycle": cycle, "name": chart["name"], "placed": made is not None, "fit": FIT_VERSION}
        folder.mkdir(parents=True, exist_ok=True)
        if made is not None:
            picture, corners = made
            png.with_name(png.name + ".part").write_bytes(picture)
            os.replace(png.with_name(png.name + ".part"), png)
            found.update(corners)
        # Kept either way: a plate that does not place is not tried again
        # this cycle, until fit() changes.
        meta.with_name(meta.name + ".part").write_text(json.dumps(found))
        os.replace(meta.with_name(meta.name + ".part"), meta)
    return {**found, "png": png} if found["placed"] else None
