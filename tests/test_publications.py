"""The FAA's airport diagrams and Chart Supplement pages, by edition."""
import io
from datetime import date

import pypdfium2
import requests
from PIL import Image

from vfr import publications

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


def test_an_airport_with_a_diagram_has_it_by_either_ident_and_one_without_has_none():
    diagrams = publications._diagrams_of(METAFILE)
    assert diagrams == {"DLH": "00125AD.PDF", "KDLH": "00125AD.PDF"}


def test_the_supplement_is_the_airports_first_page():
    assert publications._supplements_of(AFD) == {"DLH": "nc_161_03SEP2026.pdf", "C81": "ec_59_03SEP2026.pdf"}


def test_the_links_are_the_editions_own(monkeypatch, tmp_path):
    monkeypatch.setattr(publications, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(publications, "_HELD", {})
    (tmp_path / "dtpp-2610.json").write_text('{"DLH": "00125AD.PDF", "KDLH": "00125AD.PDF"}')
    (tmp_path / "dcs-03Sep2026.json").write_text('{"DLH": "nc_161_03SEP2026.pdf"}')
    on = date(2026, 10, 3)
    assert publications.airport_diagram_url("KDLH", on) == "https://aeronav.faa.gov/d-tpp/2610/00125AD.PDF"
    assert publications.chart_supplement_url("KDLH", on) == "https://aeronav.faa.gov/afd/03Sep2026/nc_161_03SEP2026.pdf"
    assert publications.airport_diagram_url("C81", on) is None


def _blank_pdf(width: int, height: int) -> bytes:
    """A blank page the size of a d-TPP chart, made by pdfium itself."""
    document = pypdfium2.PdfDocument.new()
    document.new_page(width, height)
    out = io.BytesIO()
    document.save(out)
    return out.getvalue()


class _Answer:
    def __init__(self, content=b"", fail=False):
        self.content, self.fail = content, fail

    def raise_for_status(self):
        if self.fail:
            raise requests.HTTPError("503")


def test_the_diagram_is_drawn_once_a_cycle_by_either_ident_and_kept(monkeypatch, tmp_path):
    monkeypatch.setattr(publications, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(publications, "_HELD", {})
    (tmp_path / "dtpp-2610.json").write_text('{"DLH": "00125AD.PDF", "KDLH": "00125AD.PDF"}')
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
    (tmp_path / "dtpp-2610.json").write_text('{"DLH": "00125AD.PDF", "KDLH": "00125AD.PDF"}')
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
