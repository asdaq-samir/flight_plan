"""The FAA's airport diagrams and Chart Supplement pages, by edition."""
from datetime import date

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
