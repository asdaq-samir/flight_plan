import json
import time

import pytest
import requests

from vfr import references

PART_91 = """<?xml version="1.0"?>
<DIV5 N="91" TYPE="PART">
<DIV8 N="91.155" TYPE="SECTION"><HEAD>&#xA7; 91.155 Basic VFR weather minimums.</HEAD>
<P>(a) No person may operate an aircraft under VFR when the flight visibility is less than that prescribed:</P>
<DIV><TABLE><TR><TD>Class B</TD><TD>3 statute miles</TD><TD>Clear of Clouds.</TD></TR></TABLE></DIV>
</DIV8>
<DIV8 N="91.130" TYPE="SECTION"><HEAD>&#xA7; 91.130 Operations in Class C airspace.</HEAD>
<P>(c) Each person must establish two-way radio communications with the ATC facility providing air traffic
services prior to entering that airspace.</P>
</DIV8>
<DIV8 N="91.99" TYPE="SECTION"><HEAD>&#xA7; 91.99 [Reserved]</HEAD><P>x</P></DIV8>
</DIV5>"""

AIM_PAGE = """<html><body>
<h4 class="paragraph-title" id="4-1-9">4-1-9. Traffic Advisory Practices at Airports Without Operating Control Towers</h4>
<ol><li>Pilots use the correct airport name, as identified in appropriate aeronautical publications.</li></ol>
<h4 class="paragraph-title" id="4-1-10">4-1-10. IFR Approaches/Ground Vehicle Operations</h4>
<p class="p">IFR Approaches. When operating in accordance with an IFR clearance &amp; more.</p>
</body></html>"""


def test_a_cfr_part_is_a_section_a_source_its_tables_in_words():
    found = references.cfr_sources(PART_91, "91")
    assert [s.id for s in found] == ["14 CFR 91.155", "14 CFR 91.130"]
    assert found[0].title == "§ 91.155 Basic VFR weather minimums."
    assert "Class B | 3 statute miles | Clear of Clouds." in found[0].text
    assert found[1].url == "https://www.ecfr.gov/current/title-14/part-91/section-91.130"


def test_the_aim_is_a_numbered_paragraph_a_source():
    found = references.aim_sources(AIM_PAGE, "https://faa.example/chap4_section_1.html")
    assert [s.id for s in found] == ["AIM 4-1-9", "AIM 4-1-10"]
    assert found[0].title.startswith("4-1-9. Traffic Advisory Practices")
    assert found[1].text == "IFR Approaches. When operating in accordance with an IFR clearance & more."
    assert found[0].url.endswith("#4-1-9")


def test_search_finds_the_section_a_question_is_about():
    ix = references.Index(references.cfr_sources(PART_91, "91") + references.aim_sources(AIM_PAGE, "u"))
    assert ix.search("two-way radio communications Class C")[0].source.id == "14 CFR 91.130"
    assert ix.search("VFR weather minimums visibility")[0].source.id == "14 CFR 91.155"
    assert ix.search("nothing here at all zebra") == []


def test_a_quote_is_only_the_sources_own_words():
    source = references.cfr_sources(PART_91, "91")[1]
    assert references.quoted("must establish two-way radio communications with the ATC facility", source)
    # Case, spacing and punctuation aside.
    assert references.quoted("MUST ESTABLISH two way radio  communications", source)
    # A paraphrase, or too short to mean anything, is not a quote.
    assert not references.quoted("must talk to ATC before entering", source)
    assert not references.quoted("ATC", source)
    # Cut with an ellipsis: each piece its words, in order.
    assert references.quoted("must establish two-way radio communications ... prior to entering that airspace", source)
    assert not references.quoted("prior to entering that airspace … must establish two-way radio communications", source)


def test_the_kept_copy_is_read_refreshed_when_old_and_kept_when_the_faa_is_down(tmp_path, monkeypatch):
    monkeypatch.setattr(references, "_LOADED", {})
    monkeypatch.setattr(references, "_FAILED", {})
    fetches = []

    def fetch():
        fetches.append(1)
        return references.cfr_sources(PART_91, "91"), {"cfr_issued": "2026-09-29", "aim_fetched": "2026-10-05", "fetched_at": time.time()}

    monkeypatch.setattr(references, "_fetch_all", fetch)
    found, meta = references.sources(tmp_path)
    assert len(found) == 2 and meta["cfr_issued"] == "2026-09-29" and len(fetches) == 1
    references.sources(tmp_path)
    assert len(fetches) == 1

    # A month on, and the FAA down: the old copy, and no second try for an hour.
    data = json.loads((tmp_path / "sources.json").read_text())
    data["meta"]["fetched_at"] -= references.MAX_AGE_S + 1
    (tmp_path / "sources.json").write_text(json.dumps(data))
    monkeypatch.setattr(references, "_LOADED", {})

    def down():
        fetches.append(1)
        raise requests.ConnectionError("down")

    monkeypatch.setattr(references, "_fetch_all", down)
    assert len(references.sources(tmp_path)[0]) == 2
    assert len(references.sources(tmp_path)[0]) == 2
    assert len(fetches) == 2


def test_no_copy_and_no_faa_is_an_error(tmp_path, monkeypatch):
    monkeypatch.setattr(references, "_LOADED", {})
    monkeypatch.setattr(references, "_FAILED", {})
    monkeypatch.setattr(references, "_fetch_all", lambda: (_ for _ in ()).throw(requests.ConnectionError("down")))
    with pytest.raises(requests.ConnectionError):
        references.sources(tmp_path)
    # Tried again only after an hour: until then, said plainly.
    with pytest.raises(RuntimeError, match="try again in an hour"):
        references.sources(tmp_path)
