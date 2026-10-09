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
import re
import threading
import xml.etree.ElementTree as ET
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path

import numpy as np
import pypdfium2
import requests
from PIL import Image
from scipy import ndimage

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


def _charts_of(xml_bytes: bytes) -> dict:
    """{FAA ident and ICAO ident: the field's charts, each [chart code,
    chart name, PDF], in the metafile's order} from a d-TPP metafile --
    the airport diagram (APD) among them, and its hot spots (HOT), land
    and hold short (LAH), approaches (IAP), departures (DP, ODP),
    arrivals (STR) and takeoff and alternate minimums (MIN)."""
    found = {}
    for airport in ET.fromstring(xml_bytes).iter("airport_name"):
        charts = [
            [record.findtext("chart_code") or "", record.findtext("chart_name") or "", record.findtext("pdf_name")]
            for record in airport.iter("record") if record.findtext("pdf_name")
        ]
        for ident in (airport.get("apt_ident"), airport.get("icao_ident")):
            if ident and charts:
                found[ident.upper()] = charts
    return found


def _supplements_of(xml_bytes: bytes) -> dict:
    """{FAA ident: its Chart Supplement pages' PDFs, in order} from a d-CS
    airport list: an entry may run on to a second page."""
    found = {}
    for airport in ET.fromstring(xml_bytes).iter("airport"):
        ident = airport.findtext("aptid")
        pdfs = [pdf.text.strip() for pdf in airport.iterfind("pages/pdf") if pdf.text and pdf.text.strip()]
        if ident and pdfs:
            found.setdefault(ident.upper(), pdfs)
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


def _charts_for(ident: str, cycle: str) -> list:
    # "dtpp-charts": every chart, where "dtpp" kept the diagram alone; a
    # new name, so an index kept on disk in the old shape is not read as
    # the new one.
    index = _index("dtpp-charts", cycle, f"{DTPP_BASE}/{cycle}/xml_data/d-tpp_Metafile.xml", _charts_of)
    return next((index[i] for i in _faa_idents(ident) if i in index), [])


def terminal_charts(ident: str, on: date | None = None) -> list:
    """The field's charts in this cycle's d-TPP -- its airport diagram,
    hot spots, approaches, departures, arrivals and minimums -- each
    {"kind": the FAA's chart code, "name": its title as the FAA prints it,
    "url": its PDF}; none for a field with none (most small ones) or
    where the index cannot be had."""
    cycle = dtpp_cycle(on)
    return [{"kind": code, "name": name, "url": f"{DTPP_BASE}/{cycle}/{pdf}"} for code, name, pdf in _charts_for(ident, cycle)]


def airport_diagram_url(ident: str, on: date | None = None) -> str | None:
    """The airport diagram's PDF for this cycle, None where the field has
    none (most small ones) or the index cannot be had."""
    cycle = dtpp_cycle(on)
    pdf = next((pdf for code, _, pdf in _charts_for(ident, cycle) if code == "APD"), None)
    return f"{DTPP_BASE}/{cycle}/{pdf}" if pdf else None


def chart_supplement_url(ident: str, on: date | None = None) -> str | None:
    """The field's Chart Supplement page for this edition, None where it
    has none or the index cannot be had."""
    pages = _supplement_pages(ident, dcs_edition(on))
    return f"{DCS_BASE}/{dcs_edition(on)}/{pages[0]}" if pages else None


def _supplement_pages(ident: str, edition: str) -> list:
    # "dcs-pages": every page of the entry, where "dcs" kept the first; a
    # new name, so an index kept on disk in the old shape is not read as
    # the new one.
    index = _index("dcs-pages", edition, f"{DCS_BASE}/{edition}/afd_{edition}.xml", _supplements_of)
    return next((index[i] for i in _faa_idents(ident) if i in index), [])


def airport_diagram_cycle(ident: str, on: date | None = None) -> str | None:
    """The d-TPP cycle whose airport diagram this field has, for the card
    to ask for its picture by (`airport_diagram_png`); None where it has
    none."""
    return dtpp_cycle(on) if airport_diagram_url(ident, on) else None


_PDFIUM = threading.Lock()


def _drawn(pdf: bytes, page: int = 0) -> bytes:
    """A page of the PDF (its first) as a greyscale PNG, DIAGRAM_SCALE
    times its points: the FAA's charts are black on white, and grey keeps
    one a third the size of colour with nothing lost."""
    # pdfium is not thread-safe, and draws of different PDFs run in the
    # server's thread pool at once: one at a time, or the process can crash.
    with _PDFIUM:
        document = pypdfium2.PdfDocument(pdf)
        try:
            if not 0 <= page < len(document):
                raise IndexError(f"no page {page + 1} of {len(document)}")
            image = document[page].render(scale=DIAGRAM_SCALE, grayscale=True).to_pil().convert("L")
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


#: A PDF's own name in an FAA publication: letters, figures and a few
#: marks, no path -- what a chart's address may name and nothing else.
_PDF_NAME = re.compile(r"^[A-Za-z0-9_.-]{1,80}\.pdf$", re.IGNORECASE)


def _source_of(url: str, on: date | None = None) -> tuple | None:
    """("dtpp" or "dcs", the edition, the PDF's name) for an FAA chart's
    address in the edition in force -- the d-TPP's or the Chart
    Supplement's, on aeronav.faa.gov -- and None for any other address:
    the planner reads the FAA's charts and nothing it is pointed at."""
    for source, base, edition in (("dtpp", DTPP_BASE, dtpp_cycle(on)), ("dcs", DCS_BASE, dcs_edition(on))):
        prefix = f"{base}/{edition}/"
        if url.startswith(prefix) and _PDF_NAME.match(url[len(prefix):]):
            return source, edition, url[len(prefix):]
    return None


class FaaUnreachable(Exception):
    """The FAA's site did not answer (or answered with an error): not
    the same as the chart not existing, and not kept as that."""


#: PDFs the FAA said it has no such file for, by (source, edition, name):
#: an address made up to fetch is asked of the FAA once, not each time.
_ABSENT: set = set()
_ABSENT_MAX = 1000


def _pdf_of(source: str, edition: str, name: str) -> bytes | None:
    """One of the FAA's PDFs, downloaded once and kept for its edition;
    None where the FAA has no such file; FaaUnreachable where it could
    not be asked, so an outage is not taken for a missing chart."""
    path = CACHE_DIR / "pdf" / source / edition / name
    if path.exists():
        return path.read_bytes()
    if (source, edition, name) in _ABSENT:
        return None
    with _LOCK:
        lock = _DRAWING.setdefault(path, threading.Lock())
    with lock:
        if path.exists():
            return path.read_bytes()
        base = DTPP_BASE if source == "dtpp" else DCS_BASE
        try:
            resp = requests.get(f"{base}/{edition}/{name}", headers=HEADERS, timeout=60)
            if resp.status_code in (403, 404):
                # S3, which serves the FAA's files, answers 403 for a key that is not there.
                with _LOCK:
                    if len(_ABSENT) >= _ABSENT_MAX:
                        _ABSENT.clear()
                    _ABSENT.add((source, edition, name))
                return None
            resp.raise_for_status()
        except requests.RequestException as err:
            log.warning("No %s %s in %s: %s", source, name, edition, err)
            raise FaaUnreachable(str(err)) from err
        path.parent.mkdir(parents=True, exist_ok=True)
        partial = path.with_name(path.name + ".part")
        partial.write_bytes(resp.content)
        os.replace(partial, path)
        return resp.content


def _is_booklet(source: str, name: str) -> bool:
    """Whether a d-TPP PDF is one of the FAA's region booklets (takeoff
    and alternate minimums, hot spots), which hold many fields' entries.
    A field's own charts -- approaches, departures, the diagram -- are
    named from its five-figure sequence number ("00245IL18.PDF"); a
    booklet's name starts with its region ("EC3TO.PDF")."""
    return source == "dtpp" and not re.match(r"\d{5}", name)


@lru_cache(maxsize=512)
def _pages_of(source: str, edition: str, pdf: str, ident: str | None) -> tuple | None:
    """The pages of one PDF to show, as their sizes -- a booklet's pages
    naming the field (none where it has no entry: the FAA lists takeoff
    minimums, alternates and hot spots only for fields that need them),
    any other PDF's every page. Kept per (edition, PDF, field), since
    reading the text of a booklet's sixty-nine pages is long and holds
    the drawing lock. None where the FAA has no such file."""
    data = _pdf_of(source, edition, pdf)
    if data is None:
        return None
    booklet = _is_booklet(source, pdf)
    needle = f"({_faa_idents(ident)[-1]})" if booklet and ident else None
    pages = []
    with _PDFIUM:
        document = pypdfium2.PdfDocument(data)
        try:
            for i in range(len(document)):
                page = document[i]
                if booklet and (needle is None or needle not in page.get_textpage().get_text_bounded()):
                    continue
                pages.append({"source": source, "edition": edition, "pdf": pdf, "page": i + 1,
                              "width": round(page.get_width() * DIAGRAM_SCALE), "height": round(page.get_height() * DIAGRAM_SCALE)})
        finally:
            document.close()
    return tuple(pages)


def chart_pages(url: str, ident: str | None = None, on: date | None = None) -> list | None:
    """The pages of an FAA chart to show in the app, for its in-app view
    (`chart_page_png`): {"source", "edition", "pdf", "page" (from 1),
    "width", "height" (in pixels, drawn DIAGRAM_SCALE times its points)}.
    Every page of a chart of its own (an approach, a departure); of one of
    the FAA's booklets -- a region's takeoff minimums, sixty-nine pages,
    or its hot spots -- only the pages that name the field ("(MSN)", as
    the FAA heads each field's entry), and none where none does; and of
    a Chart Supplement entry, each of its pages. None for an address that
    is not one of the FAA's charts in force; FaaUnreachable where the FAA
    cannot be reached."""
    found = _source_of(url, on)
    if not found:
        return None
    source, edition, name = found
    names = [name]
    if source == "dcs" and ident:
        entry = _supplement_pages(ident, edition)
        if name in entry:
            names = entry[entry.index(name):]
    pages = []
    for pdf in names:
        some = _pages_of(source, edition, pdf, ident)
        if some is None:
            return None
        pages.extend(dict(p) for p in some)
    return pages


def chart_page_png(source: str, edition: str, name: str, page: int, on: date | None = None) -> Path | None:
    """One page of one of the FAA's charts in force as a picture on disk,
    drawn the first time it is asked for and kept for its edition, as the
    airport diagram is (`airport_diagram_png`); None for a chart not in
    force or not the FAA's, or a page it does not have; FaaUnreachable
    while the FAA cannot be reached."""
    current = {"dtpp": dtpp_cycle(on), "dcs": dcs_edition(on)}
    if current.get(source) != edition or not _PDF_NAME.match(name) or page < 1:
        return None
    path = CACHE_DIR / "pages" / source / edition / f"{Path(name).stem}-{page}.png"
    if path.exists():
        return path
    data = _pdf_of(source, edition, name)
    if data is None:
        return None
    with _LOCK:
        lock = _DRAWING.setdefault(path, threading.Lock())
    with lock:
        if path.exists():
            return path
        try:
            png = _drawn(data, page - 1)
        except (pypdfium2.PdfiumError, IndexError) as err:
            log.warning("No page %s of %s %s in %s: %s", page, source, name, edition, err)
            return None
        path.parent.mkdir(parents=True, exist_ok=True)
        partial = path.with_name(path.name + ".part")
        partial.write_bytes(png)
        os.replace(partial, path)
    return path


#: A diagram's latitude and longitude labels: "43 09'N" (its degree sign
#: a glyph of its own, not in the text), "34°12.5'N", "118°22.0'W".
_DMS = re.compile(r"(\d{1,3})\s*°?\s*(\d{1,2}(?:\.\d+)?)\s*['’]\s*([NSEW])")


def _graticule(page) -> tuple | None:
    """Where latitude and longitude fall on a north-up diagram's page, from
    its own labels: (y = a * lat + b, x = c * lon + d) in the page's points
    from its top left, as least squares over two labels of each at the
    least. None where the diagram has too few, or is turned on its page
    (its scale north-south and east-west then disagree): KCRQ's and
    KORD's have none."""
    textpage = page.get_textpage()
    text = textpage.get_text_bounded()
    height = page.get_height()
    lats, lons = [], []
    for match in _DMS.finditer(text):
        boxes = [textpage.get_charbox(i) for i in range(match.start(), match.end())]
        x = (min(b[0] for b in boxes) + max(b[2] for b in boxes)) / 2
        y = height - (min(b[1] for b in boxes) + max(b[3] for b in boxes)) / 2
        degrees = int(match.group(1)) + float(match.group(2)) / 60
        if match.group(3) in "SW":
            degrees = -degrees
        (lats if match.group(3) in "NS" else lons).append((degrees, x, y))
    if len({d for d, _, _ in lats}) < 2 or len({d for d, _, _ in lons}) < 2:
        return None
    a, b = np.polyfit([d for d, _, _ in lats], [y for _, _, y in lats], 1)
    c, d = np.polyfit([d for d, _, _ in lons], [x for _, x, _ in lons], 1)
    # North up: y falls as latitude rises, x grows as longitude does, and a
    # degree of latitude is a degree of longitude over its cosine.
    mid = np.mean([deg for deg, _, _ in lats])
    if a >= 0 or c <= 0 or not 0.85 < (c / np.cos(np.radians(mid))) / -a < 1.15:
        return None
    return a, b, c, d


def _thick_strokes(image) -> tuple | None:
    """The box round a diagram's runways where its labels cannot place
    them: its strokes as thick as a runway's, at the thickest that leaves
    a stroke as long as one (letters, the frame and the graticule are
    thinner, a building's block shorter), in the image's pixels."""
    dark = np.asarray(image) < 100
    for size in (11, 7, 5):
        labels, _ = ndimage.label(ndimage.binary_erosion(dark, structure=np.ones((size, size))))
        long = [s for s in ndimage.find_objects(labels) if max(s[0].stop - s[0].start, s[1].stop - s[1].start) >= 30 * DIAGRAM_SCALE]
        if long:
            return (min(s[1].start for s in long), min(s[0].start for s in long),
                    max(s[1].stop for s in long), max(s[0].stop for s in long))
    return None


def _runways_drawn(pdf: bytes, ends: list) -> bytes | None:
    """The airport diagram cropped to its runways, for the card's
    thumbnail, at the pilot's ask: where the runways' ends are (NASR's
    surveyed thresholds) placed on the diagram by its own latitude and
    longitude labels, else its runway-thick strokes; a margin round them,
    at most 700 pixels a side. None where neither finds them on a part of
    the sheet: the card draws its own sketch of the runways then."""
    with _PDFIUM:
        document = pypdfium2.PdfDocument(pdf)
        try:
            page = document[0]
            image = page.render(scale=DIAGRAM_SCALE, grayscale=True).to_pil().convert("L")
            grid = _graticule(page)
        finally:
            document.close()
    box = None
    if grid and ends:
        a, b, c, d = grid
        xs = [(c * lon + d) * DIAGRAM_SCALE for _, lon in ends]
        ys = [(a * lat + b) * DIAGRAM_SCALE for lat, _ in ends]
        box = (min(xs), min(ys), max(xs), max(ys))
        # Not on the sheet: the labels read wrong.
        if box[0] < 0 or box[1] < 0 or box[2] > image.width or box[3] > image.height:
            box = None
    strokes = _thick_strokes(image)
    if box and strokes:
        # The labels and the sheet's own runways must agree: a fit that is
        # on the page but wrong, or a crop that would cut a runway off,
        # is worse than the card's sketch, which draws them all.
        slack = 0.05 * max(strokes[2] - strokes[0], strokes[3] - strokes[1]) + 4 * DIAGRAM_SCALE
        if box[0] < strokes[0] - slack or box[1] < strokes[1] - slack or box[2] > strokes[2] + slack or box[3] > strokes[3] + slack:
            return None
        box = (min(box[0], strokes[0]), min(box[1], strokes[1]), max(box[2], strokes[2]), max(box[3], strokes[3]))
    box = box or strokes
    if not box:
        return None
    x0, y0, x1, y1 = box
    # A little round the runways' ends, for their numbers: the box is small.
    pad = 0.03 * max(x1 - x0, y1 - y0) + 4 * DIAGRAM_SCALE
    crop = (int(max(0, x0 - pad)), int(max(0, y0 - pad)), int(min(image.width, x1 + pad)), int(min(image.height, y1 + pad)))
    # Most of the sheet is no crop -- the thick strokes found a legend's or
    # an inset's too (KLAX's): the card's own sketch serves better then.
    if (crop[2] - crop[0]) * (crop[3] - crop[1]) > 0.7 * image.width * image.height:
        return None
    image = image.crop(crop)
    image.thumbnail((700, 700), Image.LANCZOS)
    out = io.BytesIO()
    image.save(out, "PNG", optimize=True)
    return out.getvalue()


def airport_diagram_runways_png(ident: str, cycle: str, ends: list, on: date | None = None) -> Path | None:
    """The airport diagram of this cycle cropped to its runways (`ends`,
    each (lat, lon), where they are known) as a picture on disk, drawn the
    first time and kept for the cycle, as the whole diagram is
    (`airport_diagram_png`); None where it has none, or its runways cannot
    be found on it."""
    if cycle != dtpp_cycle(on):
        return None
    url = airport_diagram_url(ident, on)
    if not url:
        return None
    # What is drawn depends on the ends: with none the sheet's strokes
    # alone place the crop, and that must not stand in for the labels'
    # once NASR's ends are there.
    kind = "runways" if ends else "runways-noends"
    path = CACHE_DIR / "diagrams" / cycle / f"{Path(url).stem}-{kind}.png"
    none = path.with_suffix(".none")
    if path.exists():
        return path
    if none.exists():
        return None
    data = _pdf_of("dtpp", cycle, Path(url).name)
    if data is None:
        return None
    with _LOCK:
        lock = _DRAWING.setdefault(path, threading.Lock())
    with lock:
        if path.exists():
            return path
        if none.exists():
            return None
        try:
            png = _runways_drawn(data, ends)
        except pypdfium2.PdfiumError as err:
            log.warning("No runways' diagram for %s in %s: %s", ident, cycle, err)
            return None
        path.parent.mkdir(parents=True, exist_ok=True)
        if png is None:
            # Kept as a miss, so the sheet is not drawn and eroded again
            # at every card for the rest of the cycle.
            none.touch()
            return None
        partial = path.with_name(path.name + ".part")
        partial.write_bytes(png)
        os.replace(partial, path)
    return path


def preload() -> None:
    """Both indexes for today's editions, read now rather than on a
    pilot's first card."""
    airport_diagram_url("KORD")
    chart_supplement_url("KORD")
