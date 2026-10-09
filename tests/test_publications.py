"""The FAA's airport diagrams and Chart Supplement pages, by edition."""
import ctypes
import io
from datetime import date

import pypdfium2
import pypdfium2.raw as raw
import pytest
import requests
from PIL import Image

from vfr import publications

#: KDLH's charts in a kept index, by either ident.
DLH_CHARTS = (
    '{"DLH": [["IAP", "ILS OR LOC RWY 09", "00125IL9.PDF"], ["APD", "AIRPORT DIAGRAM", "00125AD.PDF"]],'
    ' "KDLH": [["IAP", "ILS OR LOC RWY 09", "00125IL9.PDF"], ["APD", "AIRPORT DIAGRAM", "00125AD.PDF"]]}'
)

METAFILE = b"""<digital_tpp cycle="2610"><state_code><city_name>
<airport_name apt_ident="DLH" icao_ident="KDLH">
  <record><chart_code>MIN</chart_code><pdf_name>NC1TO.PDF</pdf_name></record>
  <record><chart_code>APD</chart_code><pdf_name>00125AD.PDF</pdf_name></record>
</airport_name>
<airport_name apt_ident="C81" icao_ident=""><record><chart_code>IAP</chart_code><pdf_name>X.PDF</pdf_name></record></airport_name>
</city_name></state_code></digital_tpp>"""

AFD = b"""<airports><location><airport><aptid>DLH</aptid><pages><pdf>nc_161_03SEP2026.pdf</pdf></pages></airport>
<airport><aptid>C81</aptid><pages><pdf>ec_59_03SEP2026.pdf</pdf><pdf>ec_60_03SEP2026.pdf</pdf></pages></airport></location></airports>"""


def test_the_cycles_are_named_as_the_faa_names_them():
    assert publications.dtpp_cycle(date(2026, 10, 3)) == "2610"
    assert publications.dtpp_cycle(date(2026, 9, 30)) == "2609"
    assert publications.dtpp_cycle(date(2027, 1, 1)) == "2613"    # a year of thirteen
    assert publications.dcs_edition(date(2026, 10, 3)) == "03Sep2026"
    assert publications.dcs_edition(date(2026, 10, 29)) == "29Oct2026"


def test_an_airports_charts_are_kept_by_either_ident_in_the_faas_order():
    charts = publications._charts_of(METAFILE)
    assert charts["DLH"] == charts["KDLH"] == [["MIN", "", "NC1TO.PDF"], ["APD", "", "00125AD.PDF"]]
    assert charts["C81"] == [["IAP", "", "X.PDF"]]


def test_the_supplement_is_the_airports_pages_in_order():
    assert publications._supplements_of(AFD) == {"DLH": ["nc_161_03SEP2026.pdf"], "C81": ["ec_59_03SEP2026.pdf", "ec_60_03SEP2026.pdf"]}


def test_the_links_are_the_editions_own(monkeypatch, tmp_path):
    monkeypatch.setattr(publications, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(publications, "_HELD", {})
    (tmp_path / "dtpp-charts-2610.json").write_text(DLH_CHARTS)
    (tmp_path / "dcs-pages-03Sep2026.json").write_text('{"DLH": ["nc_161_03SEP2026.pdf"]}')
    on = date(2026, 10, 3)
    assert publications.airport_diagram_url("KDLH", on) == "https://aeronav.faa.gov/d-tpp/2610/00125AD.PDF"
    assert publications.chart_supplement_url("KDLH", on) == "https://aeronav.faa.gov/afd/03Sep2026/nc_161_03SEP2026.pdf"
    assert publications.airport_diagram_url("C81", on) is None
    assert publications.terminal_charts("KDLH", on) == [
        {"kind": "IAP", "name": "ILS OR LOC RWY 09", "url": "https://aeronav.faa.gov/d-tpp/2610/00125IL9.PDF"},
        {"kind": "APD", "name": "AIRPORT DIAGRAM", "url": "https://aeronav.faa.gov/d-tpp/2610/00125AD.PDF"},
    ]
    assert publications.terminal_charts("C81", on) == []


def _blank_pdf(width: int, height: int) -> bytes:
    """A blank page the size of a d-TPP chart, made by pdfium itself."""
    document = pypdfium2.PdfDocument.new()
    document.new_page(width, height)
    out = io.BytesIO()
    document.save(out)
    return out.getvalue()


class _Answer:
    def __init__(self, content=b"", fail=False, status=200):
        self.content, self.fail, self.status_code = content, fail, status

    def raise_for_status(self):
        if self.fail:
            raise requests.HTTPError("503")


def test_the_diagram_is_drawn_once_a_cycle_by_either_ident_and_kept(monkeypatch, tmp_path):
    monkeypatch.setattr(publications, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(publications, "_HELD", {})
    (tmp_path / "dtpp-charts-2610.json").write_text(DLH_CHARTS)
    asked = []
    pdf = _blank_pdf(396, 594)
    monkeypatch.setattr(publications.requests, "get", lambda url, **kw: asked.append(url) or _Answer(pdf))
    on = date(2026, 10, 3)

    assert publications.airport_diagram_cycle("KDLH", on) == "2610"
    path = publications.airport_diagram_png("KDLH", "2610", on)
    image = Image.open(path)
    # Grey, DIAGRAM_SCALE times the PDF's points.
    scale = publications.DIAGRAM_SCALE
    assert (image.mode, image.size) == ("L", (396 * scale, 594 * scale))
    assert publications.airport_diagram_png("DLH", "2610", on) == path
    assert asked == ["https://aeronav.faa.gov/d-tpp/2610/00125AD.PDF"]


def test_no_diagram_for_another_cycle_a_field_without_one_or_while_the_faa_is_down(monkeypatch, tmp_path):
    monkeypatch.setattr(publications, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(publications, "_HELD", {})
    (tmp_path / "dtpp-charts-2610.json").write_text(DLH_CHARTS)
    monkeypatch.setattr(publications.requests, "get", lambda url, **kw: _Answer(fail=True))
    on = date(2026, 10, 3)

    assert publications.airport_diagram_png("KDLH", "2609", on) is None
    assert publications.airport_diagram_png("C81", "2610", on) is None
    assert publications.airport_diagram_cycle("C81", on) is None
    # Nothing kept from a failure: the next ask tries the FAA again.
    assert publications.airport_diagram_png("KDLH", "2610", on) is None
    assert not (tmp_path / "diagrams").exists()


def test_pdfium_draws_one_pdf_at_a_time(monkeypatch):
    import threading
    import time

    inside, most = 0, 0
    count = threading.Lock()
    real_render = pypdfium2.PdfPage.render

    def watched(self, *args, **kw):
        nonlocal inside, most
        with count:
            inside += 1
            most = max(most, inside)
        time.sleep(0.05)
        try:
            return real_render(self, *args, **kw)
        finally:
            with count:
                inside -= 1

    monkeypatch.setattr(pypdfium2.PdfPage, "render", watched)
    threads = [threading.Thread(target=publications._drawn, args=(_blank_pdf(100 + n, 100),)) for n in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert most == 1



def _pdf_with(pages: list) -> bytes:
    """A PDF of `pages` d-TPP-sized pages, each with its text set on it."""
    document = pypdfium2.PdfDocument.new()
    font = None
    for words in pages:
        page = document.new_page(387, 594)
        if words:
            if font is None:
                font = raw.FPDFText_LoadStandardFont(document.raw, b"Helvetica")
            text = raw.FPDFPageObj_CreateTextObj(document.raw, font, ctypes.c_float(12))
            encoded = (words + "\x00").encode("utf-16-le")
            raw.FPDFText_SetText(text, ctypes.cast(encoded, ctypes.POINTER(raw.FPDF_WCHAR)))
            raw.FPDFPageObj_Transform(text, 1, 0, 0, 1, 40, 500)
            raw.FPDFPage_InsertObject(page.raw, text)
            raw.FPDFPage_GenerateContent(page.raw)
    out = io.BytesIO()
    document.save(out)
    return out.getvalue()


def test_a_booklets_pages_are_the_ones_naming_the_field_and_a_charts_its_own(monkeypatch, tmp_path):
    publications._SCANNED.clear()
    monkeypatch.setattr(publications, "CACHE_DIR", tmp_path)
    # The entry's second page carries no heading of its own, as an entry that runs on may not.
    booklet = _pdf_with(["KENOSHA (ENW)", "MADISON DANE COUNTY RGNL/TRUAX FLD (MSN)", "THE SAME ENTRY, CONTINUED", "MILWAUKEE (MKE)"])
    approach = _pdf_with(["ILS OR LOC RWY 18"])
    answers = {"EC3TO.PDF": booklet, "00245IL18.PDF": approach}
    monkeypatch.setattr(publications.requests, "get", lambda url, **kw: _Answer(answers[url.rsplit("/", 1)[1]]))
    on = date(2026, 10, 3)
    pages = publications.chart_pages("https://aeronav.faa.gov/d-tpp/2610/EC3TO.PDF", "KMSN", on)
    assert [p["page"] for p in pages] == [2, 3]
    scale = publications.DIAGRAM_SCALE
    assert pages[0] == {"source": "dtpp", "edition": "2610", "pdf": "EC3TO.PDF", "page": 2, "width": 387 * scale, "height": 594 * scale}
    assert [p["page"] for p in publications.chart_pages("https://aeronav.faa.gov/d-tpp/2610/00245IL18.PDF", "KMSN", on)] == [1]
    # A booklet without the field has no pages for it, not another field's.
    assert publications.chart_pages("https://aeronav.faa.gov/d-tpp/2610/EC3TO.PDF", "KDLH", on) == []
    # A chart of its own keeps every page, though only one is headed with the field.
    answers["00245IL19.PDF"] = _pdf_with(["ILS OR LOC RWY 19 (MSN)", "NOTES", "MORE NOTES"])
    assert [p["page"] for p in publications.chart_pages("https://aeronav.faa.gov/d-tpp/2610/00245IL19.PDF", "KMSN", on)] == [1, 2, 3]
    # Drawn, a page at a time, and kept.
    path = publications.chart_page_png("dtpp", "2610", "EC3TO.PDF", 3, on)
    assert Image.open(path).size == (387 * scale, 594 * scale)
    assert publications.chart_page_png("dtpp", "2610", "EC3TO.PDF", 9, on) is None


def test_only_the_faas_charts_in_force_are_read(monkeypatch, tmp_path):
    monkeypatch.setattr(publications, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(publications.requests, "get", lambda url, **kw: pytest.fail(f"asked for {url}"))
    on = date(2026, 10, 3)
    for url in ("https://example.com/d-tpp/2610/X.PDF", "https://aeronav.faa.gov/d-tpp/2609/X.PDF",
                "https://aeronav.faa.gov/d-tpp/2610/../secret.PDF", "https://aeronav.faa.gov/d-tpp/2610/X.exe"):
        assert publications.chart_pages(url, "KMSN", on) is None
    assert publications.chart_page_png("dtpp", "2609", "X.PDF", 1, on) is None
    assert publications.chart_page_png("elsewhere", "2610", "X.PDF", 1, on) is None


def test_the_faa_not_answering_is_told_from_a_chart_it_does_not_have(monkeypatch, tmp_path):
    publications._SCANNED.clear()
    monkeypatch.setattr(publications, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(publications, "_ABSENT", {})
    on = date(2026, 10, 3)
    asked = []

    def get(url, **kw):
        asked.append(url)
        if url.endswith("GONE.PDF"):
            return _Answer(status=404)
        raise publications.requests.ConnectionError("down")

    monkeypatch.setattr(publications.requests, "get", get)
    with pytest.raises(publications.FaaUnreachable):
        publications.chart_pages("https://aeronav.faa.gov/d-tpp/2610/00245IL19.PDF", "KMSN", on)
    with pytest.raises(publications.FaaUnreachable):
        publications.chart_page_png("dtpp", "2610", "00245IL19.PDF", 1, on)
    # Not there is None, and asked of the FAA once.
    gone = "https://aeronav.faa.gov/d-tpp/2610/GONE.PDF"
    assert publications.chart_pages(gone, "KMSN", on) is None
    assert publications.chart_pages(gone, "KMSN", on) is None
    assert asked.count(gone) == 1
    # A 403 may be a throttle, so it is forgotten after a while and asked again.
    for key in publications._ABSENT:
        publications._ABSENT[key] -= publications._ABSENT_FOR + 1
    assert publications.chart_pages(gone, "KMSN", on) is None
    assert asked.count(gone) == 2


def test_a_pdf_without_field_headings_is_shown_whole(monkeypatch, tmp_path):
    publications._SCANNED.clear()
    monkeypatch.setattr(publications, "CACHE_DIR", tmp_path)
    odd = _pdf_with(["NOTES", "MORE NOTES"])
    monkeypatch.setattr(publications.requests, "get", lambda url, **kw: _Answer(odd))
    pages = publications.chart_pages("https://aeronav.faa.gov/d-tpp/2610/XY1.PDF", "KMSN", date(2026, 10, 3))
    assert [p["page"] for p in pages] == [1, 2]
