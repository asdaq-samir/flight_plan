"""vfr.remarks: an airport's lighting and mic-click remarks, from the
FAA's own text, in plain English."""
import pytest

from vfr import faa_data, remarks


@pytest.fixture
def remarks_csv(tmp_path, monkeypatch):
    path = tmp_path / "APT_RMK.csv"
    path.write_text(
        '"EFF_DATE","SITE_NO","SITE_TYPE_CODE","STATE_CODE","ARPT_ID","CITY","COUNTRY_CODE","LEGACY_ELEMENT_NUMBER",'
        '"TAB_NAME","REF_COL_NAME","ELEMENT","REF_COL_SEQ_NO","REMARK"\n'
        '"2026/09/03","1","A","IL","3CK","LAKE","US","A110-4","AIRPORT","GENERAL_REMARK","",4,'
        '"WX ADZY - CTAF 5 CLICKS OR 815-444-1729."\n'
        '"2026/09/03","1","A","IL","3CK","LAKE","US","A81-APT","AIRPORT","LGT_SKED","",1,'
        '"ACTVT REIL RWY 08 & 26; PAPI RWY 08 & 26; MIRL RWY 08/26 - CTAF."\n'
        '"2026/09/03","2","A","FL","JTC","X","US","A81-APT","AIRPORT","LGT_SKED","",1,'
        '"ACTVT MIRL RWY 03/21 - CTAF: 5 CLICKS ON; 7 CLICKS OFF."\n'
        '"2026/09/03","3","A","IL","RFD","ROCKFORD","US","A110-1","AIRPORT","GENERAL_REMARK","",1,'
        '"BIRDS ON AND INVOF ARPT."\n'
    )
    monkeypatch.setattr(faa_data, "ensure_nasr_file", lambda name, cache_dir: path)
    return path


def test_a_remark_reads_in_plain_english_with_the_names_a_pilot_uses_kept():
    assert remarks.plain("ACTVT REIL RWY 08 & 26; MIRL RWY 08/26 - CTAF.") == \
        "Activate REIL runway 08 & 26; MIRL runway 08/26 - CTAF."
    assert remarks.plain("WX ADZY - CTAF 5 CLICKS OR 815-444-1729.") == "Weather advisory - CTAF 5 clicks or 815-444-1729."


def test_an_airports_lights_turned_on_from_the_cockpit_and_its_weather_on_the_ctaf(remarks_csv):
    notes = remarks.airport_notes("3CK")
    assert notes["lighting"] == ["Activate REIL runway 08 & 26; PAPI runway 08 & 26; MIRL runway 08/26 - CTAF."]
    assert notes["radio"] == ["Weather advisory - CTAF 5 clicks or 815-444-1729."]
    # Pilot-controlled, with no count of its own: the standard keying applies.
    assert notes["pilot_controlled"] and not notes["explicit_clicks"]


def test_a_count_of_clicks_in_the_lighting_is_its_own_and_other_remarks_are_left_out(remarks_csv):
    jtc = remarks.airport_notes("JTC")
    assert jtc["pilot_controlled"] and jtc["explicit_clicks"]
    assert remarks.airport_notes("RFD") == {"lighting": [], "radio": [], "pilot_controlled": False, "explicit_clicks": False}
