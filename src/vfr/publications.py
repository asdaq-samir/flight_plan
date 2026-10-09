"""The FAA's own pages for an airport: its airport diagram (from the
digital Terminal Procedures, d-TPP) and its page of the Chart Supplement
(d-CS), as links to the PDFs on aeronav.faa.gov.

Each publication has an index of its own: the d-TPP's metafile (16 MB of
XML, every procedure at every airport) and the d-CS's airport list. They
are read once per edition and kept small on disk -- the diagram's PDF and
the supplement's page for each airport, by its FAA identifier -- so a card
asks nothing of the FAA.

The d-TPP is on the 28-day AIRAC cycle, named by the year and the cycle's
number in it ("2610", from 1 Oct 2026); the Chart Supplement on the
56-day cycle the sectionals are, named by its date ("03Sep2026").

The airport diagram is drawn as a picture too (`airport_diagram_png`), for
the card to show it in the app rather than send the pilot to a PDF: the
cycle's PDF read once and rendered once, kept on disk for the cycle.
"""
from __future__ import annotations

import io
import json
import logging
import os
import threading
import xml.etree.ElementTree as ET
from datetime import date, timedelta
from pathlib import Path

import pypdfium2
import requests

from .config import DATA_DIR

log = logging.getLogger(__name__)

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; vfr-route-learning-project/0.1)"}
DTPP_BASE = "https://aeronav.faa.gov/d-tpp"
DCS_BASE = "https://aeronav.faa.gov/afd"
CACHE_DIR = DATA_DIR / "raw" / "publications"

#: A known start of each cycle, and its length.
AIRAC_EPOCH = date(2026, 1, 22)          # cycle 2601
AIRAC_DAYS = 28
DCS_EPOCH = date(2026, 9, 3)             # the 3 Sep 2026 edition
DCS_DAYS = 56

#: How much finer than the PDF's own points the diagram is drawn: 5 is
#: 360 dots an inch, a d-TPP page (5.4 by 8.25 in) 1937 by 2970, where
#: the taxiway letters and the hot spots stay sharp on a phone's three
#: pixels a point as a pinch brings them in to 1.6 times its width, and
#: readable past that. Measured on KMSN's: 351 KB and 0.9 s to draw, where
#: 3 was 191 KB, soft as soon as it was pinched, and 6 was 439 KB.
DIAGRAM_SCALE = 5

_LOCK = threading.Lock()
_HELD: dict = {}
#: One lock per diagram being drawn: two cards opened on the same field at
#: once read its PDF once, and a draw does not hold up every other card.
_DRAWING: dict = {}


def _cycle_start(on: date, epoch: date, days: int) -> date:
    return epoch + timedelta(days=((on - epoch).days // days) * days)


def dtpp_cycle(on: date | None = None) -> str:
    """The d-TPP cycle in force on `on` (today): "2610"."""
    start = _cycle_start(on or date.today(), AIRAC_EPOCH, AIRAC_DAYS)
    # Its number in its year: how many cycles have started in that year
    # up to and including it.
    first = start - timedelta(days=((start - date(start.year, 1, 1)).days // AIRAC_DAYS) * AIRAC_DAYS)
    return f"{start.year % 100:02d}{(start - first).days // AIRAC_DAYS + 1:02d}"


def dcs_edition(on: date | None = None) -> str:
    """The Chart Supplement edition in force on `on` (today): "03Sep2026"."""
    return _cycle_start(on or date.today(), DCS_EPOCH, DCS_DAYS).strftime("%d%b%Y")


def _diagrams_of(xml_bytes: bytes) -> dict:
    """{FAA ident and ICAO ident: the airport diagram's PDF} from a d-TPP
    metafile."""
    found = {}
    for airport in ET.fromstring(xml_bytes).iter("airport_name"):
        for record in airport.iter("record"):
            if record.findtext("chart_code") == "APD" and record.findtext("pdf_name"):
                for ident in (airport.get("apt_ident"), airport.get("icao_ident")):
                    if ident:
                        found[ident.upper()] = record.findtext("pdf_name")
                break
    return found


def _supplements_of(xml_bytes: bytes) -> dict:
    """{FAA ident: its first Chart Supplement page's PDF} from a d-CS
    airport list."""
    found = {}
    for airport in ET.fromstring(xml_bytes).iter("airport"):
        ident, pdf = airport.findtext("aptid"), airport.findtext("pages/pdf")
        if ident and pdf:
            found.setdefault(ident.upper(), pdf)
    return found


def _index(name: str, edition: str, url: str, parse) -> dict:
    """An index for one edition, from memory, from disk, or downloaded
    and parsed once; empty when the FAA cannot be reached (no links on a
    card, nothing failed)."""
    key = (name, edition)
    with _LOCK:
        if key in _HELD:
            return _HELD[key]
        path = CACHE_DIR / f"{name}-{edition}.json"
        if path.exists():
            index = json.loads(path.read_text())
        else:
            try:
                resp = requests.get(url, headers=HEADERS, timeout=120)
                resp.raise_for_status()
                index = parse(resp.content)
            except (requests.RequestException, ET.ParseError) as err:
                log.warning("No %s index for %s: %s", name, edition, err)
                return {}
            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            partial = path.with_name(path.name + ".part")
            partial.write_text(json.dumps(index))
            os.replace(partial, path)
        _HELD[key] = index
        return index


def _faa_idents(ident: str) -> list:
    ident = ident.strip().upper()
    return [ident, ident[1:]] if len(ident) == 4 and ident[0] in "KP" else [ident]


def airport_diagram_url(ident: str, on: date | None = None) -> str | None:
    """The airport diagram's PDF for this cycle, None where the field has
    none (most small ones) or the index cannot be had."""
    cycle = dtpp_cycle(on)
    index = _index("dtpp", cycle, f"{DTPP_BASE}/{cycle}/xml_data/d-tpp_Metafile.xml", _diagrams_of)
    pdf = next((index[i] for i in _faa_idents(ident) if i in index), None)
    return f"{DTPP_BASE}/{cycle}/{pdf}" if pdf else None


def chart_supplement_url(ident: str, on: date | None = None) -> str | None:
    """The field's Chart Supplement page for this edition, None where it
    has none or the index cannot be had."""
    edition = dcs_edition(on)
    index = _index("dcs", edition, f"{DCS_BASE}/{edition}/afd_{edition}.xml", _supplements_of)
    pdf = next((index[i] for i in _faa_idents(ident) if i in index), None)
    return f"{DCS_BASE}/{edition}/{pdf}" if pdf else None


def airport_diagram_cycle(ident: str, on: date | None = None) -> str | None:
    """The d-TPP cycle whose airport diagram this field has, for the card
    to ask for its picture by (`airport_diagram_png`); None where it has
    none."""
    return dtpp_cycle(on) if airport_diagram_url(ident, on) else None


_PDFIUM = threading.Lock()


def _drawn(pdf: bytes) -> bytes:
    """The PDF's first page as a greyscale PNG, DIAGRAM_SCALE times its
    points: the diagram is black on white, and grey keeps it a third the
    size of colour with nothing lost."""
    # pdfium is not thread-safe, and draws of different PDFs run in the
    # server's thread pool at once: one at a time, or the process can crash.
    with _PDFIUM:
        document = pypdfium2.PdfDocument(pdf)
        try:
            image = document[0].render(scale=DIAGRAM_SCALE, grayscale=True).to_pil().convert("L")
        finally:
            document.close()
    out = io.BytesIO()
    image.save(out, "PNG", optimize=True)
    return out.getvalue()


def airport_diagram_png(ident: str, cycle: str, on: date | None = None) -> Path | None:
    """The airport diagram of this cycle as a picture on disk: drawn from
    the FAA's PDF the first time it is asked for, and kept for the cycle.
    None where the field has none, the cycle is not the one in force, or
    the FAA cannot be reached (nothing is kept then, so the next ask
    tries again)."""
    if cycle != dtpp_cycle(on):
        return None
    url = airport_diagram_url(ident, on)
    if not url:
        return None
    # By the PDF's own name: KDLH's and DLH's are one picture.
    path = CACHE_DIR / "diagrams" / cycle / f"{Path(url).stem}.png"
    if path.exists():
        return path
    with _LOCK:
        lock = _DRAWING.setdefault(path, threading.Lock())
    with lock:
        if path.exists():
            return path
        try:
            resp = requests.get(url, headers=HEADERS, timeout=60)
            resp.raise_for_status()
            png = _drawn(resp.content)
        except (requests.RequestException, pypdfium2.PdfiumError) as err:
            log.warning("No airport diagram for %s in %s: %s", ident, cycle, err)
            return None
        path.parent.mkdir(parents=True, exist_ok=True)
        partial = path.with_name(path.name + ".part")
        partial.write_bytes(png)
        os.replace(partial, path)
    return path


def preload() -> None:
    """Both indexes for today's editions, read now rather than on a
    pilot's first card."""
    airport_diagram_url("KORD")
    chart_supplement_url("KORD")
