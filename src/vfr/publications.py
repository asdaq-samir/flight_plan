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
import time
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


#: PDFs the FAA said it has no such file for, by (source, edition, name),
#: and when: an address made up to fetch is asked of the FAA once, then
#: again after _ABSENT_FOR, since a 403 can be a throttle as well as a key
#: that is not there.
_ABSENT: dict = {}
_ABSENT_MAX = 1000
_ABSENT_FOR = 600.0


def _pdf_of(source: str, edition: str, name: str) -> bytes | None:
    """One of the FAA's PDFs, downloaded once and kept for its edition;
    None where the FAA has no such file; FaaUnreachable where it could
    not be asked, so an outage is not taken for a missing chart."""
    path = CACHE_DIR / "pdf" / source / edition / name
    if path.exists():
        return path.read_bytes()
    key = (source, edition, name)
    if time.monotonic() - _ABSENT.get(key, -_ABSENT_FOR) < _ABSENT_FOR:
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
                # S3, which serves the FAA's files, answers 403 for a key that is
                # not there; a throttle looks the same, so this is remembered
                # for a while, not for good.
                with _LOCK:
                    if len(_ABSENT) >= _ABSENT_MAX:
                        _ABSENT.clear()
                    _ABSENT[key] = time.monotonic()
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


#: A field's heading in a booklet: its name and code in brackets
#: ("MADISON DANE COUNTY RGNL/TRUAX FLD (MSN)").
_HEADING = re.compile(r"\(([A-Z0-9]{3,4})\)")
#: (edition, PDF) -> (every page's size, {code: pages}), each read once.
_SCANNED: dict = {}
_SCANNED_MAX = 64


def _scanned(source: str, edition: str, pdf: str) -> tuple | None:
    """A PDF's pages as their sizes, and where it is one of the FAA's
    region booklets (takeoff and alternate minimums, hot spots: many
    fields' entries, each headed with the field's code) the pages of
    each code. A page with no heading of its own goes with the entry
    before it, as an entry that runs on does. Read once per (edition,
    PDF), whatever field is asked for, since reading the text of a
    booklet's sixty-nine pages is long and holds the drawing lock. None
    where the FAA has no such file (not kept, so it is asked again)."""
    key = (source, edition, pdf)
    if key in _SCANNED:
        return _SCANNED[key]
    data = _pdf_of(source, edition, pdf)
    if data is None:
        return None
    booklet = _is_booklet(source, pdf)
    sizes, entries, current = [], {}, None
    with _PDFIUM:
        document = pypdfium2.PdfDocument(data)
        try:
            for i in range(len(document)):
                page = document[i]
                sizes.append({"source": source, "edition": edition, "pdf": pdf, "page": i + 1,
                              "width": round(page.get_width() * DIAGRAM_SCALE), "height": round(page.get_height() * DIAGRAM_SCALE)})
                if booklet:
                    found = _HEADING.findall(page.get_textpage().get_text_bounded())
                    if found:
                        current = found[-1]
                    for code in dict.fromkeys(found or ([current] if current else [])):
                        entries.setdefault(code, []).append(i)
        finally:
            document.close()
    result = (tuple(sizes), entries)
    with _LOCK:
        if len(_SCANNED) >= _SCANNED_MAX:
            _SCANNED.clear()
        _SCANNED[key] = result
    return result


def _is_booklet(source: str, name: str) -> bool:
    """Whether a d-TPP PDF is probably one of the FAA's region booklets,
    which hold many fields' entries. A field's own charts -- approaches,
    departures, the diagram -- are named from its five-figure sequence
    number ("00245IL18.PDF"); a booklet's name starts with its region
    ("EC3TO.PDF"). A PDF so named that has no field headings at all is
    shown whole (_pages_of), not filtered to nothing."""
    return source == "dtpp" and not re.match(r"\d{5}", name)


def _pages_of(source: str, edition: str, pdf: str, ident: str | None) -> tuple | None:
    """The pages of one PDF to show, as their sizes -- a booklet's pages
    for the field (none where it has no entry: the FAA lists takeoff
    minimums, alternates and hot spots only for fields that need them),
    any other PDF's every page. None where the FAA has no such file."""
    scanned = _scanned(source, edition, pdf)
    if scanned is None:
        return None
    sizes, entries = scanned
    if not entries:
        return sizes
    if not ident:
        return ()
    return tuple(sizes[i] for i in entries.get(_faa_idents(ident)[-1], []))


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


def preload() -> None:
    """Both indexes for today's editions, read now rather than on a
    pilot's first card."""
    airport_diagram_url("KORD")
    chart_supplement_url("KORD")
