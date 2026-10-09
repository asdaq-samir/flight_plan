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
        '"2026/09/03","4","A","IL","C81","GRAYSLAKE","US","A31-06/24","RUNWAY","RWY_LEN","06/24",1,'
        '"SW 1000 FT TURF-GRVL."\n'
        '"2026/09/03","4","A","IL","C81","GRAYSLAKE","US","A51-24","RUNWAY_END","DISPLACED_THR_LEN","24",1,'
        '"RWY 24 NSTD DSPLCD THLD WHITE STRIPE MKGS ONLY."\n'
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


def test_the_turf_on_a_runway_of_two_surfaces_is_read_from_its_remarks(remarks_csv):
    # C81's 06/24: the south-west 1,000 ft, from runway 06's end.
    assert remarks.runway_turf("C81") == {"06/24": [{"end": "06", "from_ft": 0, "to_ft": 1000}]}
    assert remarks.runway_turf("3CK") == {}


@pytest.mark.parametrize(("remark", "ends", "turf"), [
    # A compass point names the end whose threshold lies that way.
    ("NE 3400 FT ASPH; SW 1200 FT TURF.", "05/23", [{"end": "05", "from_ft": 0, "to_ft": 1200}]),
    ("581 FT BY 100 FT TURF ON S END.", "18/36", [{"end": "36", "from_ft": 0, "to_ft": 581}]),
    ("3000 FT X 20 FT CHIP & SEAL W END; 1100 FT GRASS E END.", "08G/26G", [{"end": "26G", "from_ft": 0, "to_ft": 1100}]),
    ("RWY 09/27 800 FT ASPHALT ON RWY 09 END, 1200 FT TURF ON RWY 27 END..", "09/27", [{"end": "27", "from_ft": 0, "to_ft": 1200}]),
    ("FIRST 2200 FT RY 15 LENGTH IS CONC; FIRST 300 FT RY 33 LENGTH IS TURF.", "15/33", [{"end": "33", "from_ft": 0, "to_ft": 300}]),
    # The rest turf after a length paved from one end: from there on.
    ("RWY 18/36 2000 FT ASPH ON RWY 36 END, REMAINDER TURF.", "18/36", [{"end": "36", "from_ft": 2000, "to_ft": None}]),
    ("RWY 15/33 2200 FT BY 32 FT ASPH ON NORTH END, REMAINDER TURF.", "15/33", [{"end": "15", "from_ft": 2200, "to_ft": None}]),
    # No end said, or ends with no number to point by: nothing guessed.
    ("RWY 09/27 2600 FT X 20 FT ASPH, REMAINDER TURF.", "09/27", []),
    ("1300 FT ASPH ON  E END, REMAINDER TURF.", "E/W", []),
])
def test_the_wordings_of_a_runways_turf(remark, ends, turf):
    assert remarks._turf_of(remark, ends.split("/")) == turf
