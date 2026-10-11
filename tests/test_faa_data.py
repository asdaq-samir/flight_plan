"""The obstacle table's Parquet cache beside DOF.DAT: a fresh process
reads it back instead of re-parsing the national text file, and a new
data cycle rebuilds it."""
import io
import os
import zipfile

import pandas as pd
import pytest

from vfr import faa_data


def _dof_line(city: str, agl: int = 350) -> str:
    """One fixed-column DOF.DAT record, laid out by _DOF_COLUMNS."""
    line = [" "] * 130
    fields = {
        "city": city,
        "lat_deg": "41", "lat_min": "30", "lat_sec": "00.00", "lat_hem": "N",
        "lon_deg": "093", "lon_min": "40", "lon_sec": "00.00", "lon_hem": "W",
        "type": "TOWER", "agl": f"{agl:05d}", "amsl": f"{agl + 1100:05d}", "lt": "R",
    }
    for name, text in fields.items():
        start, end = faa_data._DOF_COLUMNS[name]
        line[start:end] = list(text[: end - start].ljust(end - start))
    return "".join(line) + "\n"


def _write_dof(path, cities) -> None:
    path.write_text("".join(_dof_line(city) for city in cities), encoding="latin-1")


def test_obstacles_round_trip_through_the_parquet_cache(tmp_path, monkeypatch):
    dof = tmp_path / "DOF.DAT"
    _write_dof(dof, ["DES MOINES", "AMES"])
    monkeypatch.setattr(faa_data, "_OBSTACLES_CACHE", {})

    parsed = faa_data._load_all_obstacles(dof)

    assert list(parsed["city"]) == ["DES MOINES", "AMES"]
    assert parsed["lat"].iloc[0] == pytest.approx(41.5) and parsed["lon"].iloc[0] == pytest.approx(-93.6667, abs=1e-4)
    assert faa_data._obstacle_cache_path(dof).exists()

    # A fresh process: nothing in memory, the Parquet copy answers, and
    # the text file is not walked again.
    monkeypatch.setattr(faa_data, "_OBSTACLES_CACHE", {})
    monkeypatch.setattr(faa_data, "_parse_dof", lambda path: pytest.fail("parsed instead of reading the cache"))
    cached = faa_data._load_all_obstacles(dof)

    pd.testing.assert_frame_equal(cached, parsed, check_dtype=False)


def test_a_new_dof_cycle_rebuilds_the_cache(tmp_path, monkeypatch):
    dof = tmp_path / "DOF.DAT"
    _write_dof(dof, ["DES MOINES"])
    monkeypatch.setattr(faa_data, "_OBSTACLES_CACHE", {})
    faa_data._load_all_obstacles(dof)

    # The next cycle: a re-downloaded file with different content.
    _write_dof(dof, ["DES MOINES", "OMAHA"])
    later = os.stat(dof).st_mtime + 100
    os.utime(dof, (later, later))
    parses = []
    real_parse = faa_data._parse_dof
    monkeypatch.setattr(faa_data, "_parse_dof", lambda path: parses.append(path) or real_parse(path))
    monkeypatch.setattr(faa_data, "_OBSTACLES_CACHE", {})

    rebuilt = faa_data._load_all_obstacles(dof)

    assert parses == [dof]
    assert list(rebuilt["city"]) == ["DES MOINES", "OMAHA"]


# --- each NASR file on its own ---

def test_a_file_already_there_costs_no_download(tmp_path, monkeypatch):
    (tmp_path / "DOF.DAT").write_text("x")
    monkeypatch.setattr(faa_data, "find_current_cycle_page", lambda url: pytest.fail("scraped the NASR index"))
    monkeypatch.setattr(faa_data, "download_and_extract", lambda url, dest, **_: pytest.fail("downloaded"))

    assert faa_data.ensure_nasr_file("DOF.DAT", tmp_path) == tmp_path / "DOF.DAT"


def test_an_evicted_airport_file_fails_only_the_airports(tmp_path, monkeypatch):
    """The three were ensured together: an evicted APT_BASE.csv failed the
    terrain floor, which reads only DOF.DAT."""
    (tmp_path / "DOF.DAT").write_text("x")
    (tmp_path / ".APT_BASE.csv.icloud").write_text("placeholder")
    monkeypatch.setattr(faa_data, "find_current_cycle_page", lambda url: "page")
    monkeypatch.setattr(faa_data, "find_download_link", lambda page, pattern: "https://example/APT_CSV.zip")
    monkeypatch.setattr(faa_data, "download_and_extract", lambda url, dest, **_: None)   # iCloud takes it straight back

    with pytest.raises(RuntimeError, match="iCloud evicted APT_BASE.csv"):
        faa_data.ensure_nasr_file("APT_BASE.csv", tmp_path)
    assert faa_data.ensure_nasr_file("DOF.DAT", tmp_path) == tmp_path / "DOF.DAT"


def test_the_three_together_keep_their_order(tmp_path):
    for name in ("NAV_BASE.csv", "APT_BASE.csv", "DOF.DAT"):
        (tmp_path / name).write_text("x")
    assert faa_data.ensure_nasr_data(tmp_path) == (
        tmp_path / "NAV_BASE.csv", tmp_path / "APT_BASE.csv", tmp_path / "DOF.DAT",
    )


def test_load_obstacles_is_the_typed_dof_columns_filtered(tmp_path, monkeypatch):
    """It used to rebuild every row into a checkpoint-shaped record with
    a dict of tags, which its one caller unpacked again."""
    dof = tmp_path / "DOF.DAT"
    dof.write_text(_dof_line("TALL", agl=350) + _dof_line("SHORT", agl=150), encoding="latin-1")
    monkeypatch.setattr(faa_data, "_OBSTACLES_CACHE", {})

    tall = faa_data.load_obstacles(dof, (41.0, -94.0, 42.0, -93.0), min_agl_ft=200)
    assert list(tall["city"]) == ["TALL"]
    assert tall["amsl_ft"].iloc[0] == 350 + 1100

    elsewhere = faa_data.load_obstacles(dof, (45.0, -90.0, 46.0, -89.0), min_agl_ft=0)
    assert elsewhere.empty and "amsl_ft" in elsewhere.columns


def test_a_pattern_is_the_faas_where_published_and_1000_ft_where_not(tmp_path):
    (tmp_path / "APT_BASE.csv").write_text("ARPT_ID,ICAO_ID,TPA\nC81,,800\nDLH,KDLH,\n")
    assert faa_data.pattern_agl_ft("c81", tmp_path) == 800.0
    assert faa_data.pattern_agl_ft("KDLH", tmp_path) == faa_data.pattern_agl_ft("DLH", tmp_path) == 1000.0


def test_no_airport_file_is_the_1000_ft_pattern_not_a_failure(monkeypatch, tmp_path):
    def unreachable(name, cache_dir):
        raise RuntimeError("the FAA is down")
    monkeypatch.setattr(faa_data, "ensure_nasr_file", unreachable)
    assert faa_data.pattern_agl_ft("C81", tmp_path) == 1000.0


def test_an_archive_gives_up_only_the_files_the_planner_reads(tmp_path, monkeypatch):
    """The DOF archive carries a file per state beside DOF.DAT, and the
    NASR ones tables nothing reads: 190 MB of data/raw, for nothing."""
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w") as zf:
        for name in ("DOF.DAT", "17-IL.Dat", "CHG.DAT", "DOF_README.pdf"):
            zf.writestr(name, "x")

    class Answer:
        content = archive.getvalue()

        def raise_for_status(self):
            pass

    monkeypatch.setattr(faa_data.requests, "get", lambda *a, **k: Answer())
    faa_data.download_and_extract("https://example/DOF.zip", tmp_path, only=["DOF.DAT", "APT_BASE.csv"])
    assert sorted(p.name for p in tmp_path.iterdir()) == ["DOF.DAT"]


CONTACTS = (
    "EFF_DATE,SITE_NO,SITE_TYPE_CODE,STATE_CODE,ARPT_ID,CITY,COUNTRY_CODE,TITLE,NAME,"
    "ADDRESS1,ADDRESS2,TITLE_CITY,STATE,ZIP_CODE,ZIP_PLUS_FOUR,PHONE_NO\n"
) + """2026/10/01,01353.,A,CA,BUR,BURBANK,US,OWNER,BURBANK-GLENDALE-PASADENA APT,2627 HOLLYWOOD WAY,,BURBANK,CA,91505,,818-840-8840
2026/10/01,01353.,A,CA,BUR,BURBANK,US,MANAGER,A MANAGER,2627 HOLLYWOOD WAY,,BURBANK,CA,91505,,818-840-8830
2026/10/01,00103.,A,AL,0J0,ABBEVILLE,US,MANAGER,A MANAGER,PO BOX 427,101 E. WASHINGTON ST,ABBEVILLE,AL,36310,,334-585-6444
2026/10/01,00104.,A,AL,0J1,SOMEWHERE,US,OWNER,A COUNTY,P.O. BOX 9,,SOMEWHERE,AL,36000,,
2026/10/01,00105.,A,MN,0J2,ELSEWHERE,US,MANAGER,A MANAGER,1ST AVE NE,,ELSEWHERE,MN,55000,,
"""


def test_a_fields_contact_is_its_managers_phone_and_street_by_either_ident(tmp_path):
    (tmp_path / "APT_CON.csv").write_text(CONTACTS)
    (tmp_path / "APT_BASE.csv").write_text("ARPT_ID,ICAO_ID,TPA\nBUR,KBUR,\n0J0,,\n0J1,,\n0J2,,\n")
    # The manager's, before the owner's that comes first in the file; no
    # names; the FAA's capitals as an address is written.
    assert faa_data.airport_contact("KBUR", tmp_path) == faa_data.airport_contact("bur", tmp_path) == {
        "phone": "818-840-8830", "address": "2627 Hollywood Way, Burbank, CA 91505"}
    # A box number is no street: the second line is.
    assert faa_data.airport_contact("0J0", tmp_path)["address"] == "101 E. Washington St, Abbeville, AL 36310"
    # Neither, where the FAA lists none.
    assert faa_data.airport_contact("0J1", tmp_path) == {"phone": None, "address": None}
    assert faa_data.airport_contact("0J2", tmp_path)["address"] == "1st Ave NE, Elsewhere, MN 55000"
    assert faa_data.airport_contact("ZZZ", tmp_path) == {"phone": None, "address": None}


def test_no_contacts_file_is_a_card_without_them_not_a_failure(monkeypatch, tmp_path):
    def unreachable(name, cache_dir):
        raise RuntimeError("the FAA is down")
    monkeypatch.setattr(faa_data, "ensure_nasr_file", unreachable)
    assert faa_data.airport_contact("KBUR", tmp_path) == {"phone": None, "address": None}


_FRQ_HEADER = ('"EFF_DATE","FACILITY","FAC_NAME","FACILITY_TYPE","ARTCC_OR_FSS_ID","CPDLC","TOWER_HRS","SERVICED_FACILITY",'
               '"SERVICED_FAC_NAME","SERVICED_SITE_TYPE","LAT_DECIMAL","LONG_DECIMAL","SERVICED_CITY","SERVICED_STATE",'
               '"SERVICED_COUNTRY","TOWER_OR_COMM_CALL","PRIMARY_APPROACH_RADIO_CALL","FREQ","SECTORIZATION","FREQ_USE","REMARK"\n')


def _frq(facility, served, freq, use, tower_call="", approach_call="", sector=""):
    return (f'"2026/10/01","{facility}","X","NON-ATCT","","","","{served}","X","AIRPORT",0,0,"X","IN","US",'
            f'"{tower_call}","{approach_call}","{freq}","{sector}","{use}",""\n')


def test_a_fields_frequencies_are_the_faas_as_the_chart_supplement_lists_them(tmp_path):
    (tmp_path / "FRQ.csv").write_text(_FRQ_HEADER + "".join([
        # Salem (I83): its CTAF and UNICOM on one frequency, Louisville's
        # approach, and its UHF, which a light airplane cannot tune.
        _frq("I83", "I83", "123.0", "CTAF"),
        _frq("I83", "I83", "123.0", "UNICOM"),
        _frq("SDF", "I83", "123.675", "APCH/P DEP/P", approach_call="LOUISVILLE"),
        _frq("SDF", "I83", "327.0", "APCH/P DEP/P", approach_call="LOUISVILLE"),
        # Duluth: tower, ground, ATIS, its own UNICOM, a sectored approach,
        # and what is not a pilot's to call -- the emergency frequency, a
        # command post, the VORTAC's own -- left off.
        _frq("DLH", "DLH", "118.3", "LCL/P", tower_call="DULUTH", approach_call="MINNEAPOLIS"),
        _frq("DLH", "DLH", "121.9", "GND/P", tower_call="DULUTH", approach_call="MINNEAPOLIS"),
        _frq("DLH", "DLH", "124.1", "ATIS", tower_call="DULUTH"),
        _frq("DLH", "DLH", "122.95", "UNICOM"),
        _frq("DLH", "DLH", "125.45", "APCH/P DEP/P", approach_call="DULUTH", sector="360-179"),
        _frq("DLH", "DLH", "121.5", "EMERG", tower_call="DULUTH"),
        _frq("DLH", "DLH", "139.9", "ANG COMD POST", tower_call="DULUTH"),
        _frq("DLH", "DLH", "112.6/73X", "DLH VORTAC"),
        _frq("PRINCETON", "DLH", "122.5", "DULUTH RCO", tower_call="DULUTH"),
        # Madison's Class C frequency is its approach's east sector: once.
        _frq("MSN", "MSN", "120.1", "APCH/P DEP/P", approach_call="MADISON", sector="EAST"),
        _frq("MSN", "MSN", "120.1", "CLASS C", approach_call="MADISON", sector="EAST"),
        _frq("MSN", "MSN", "132.0", "CLASS C", approach_call="MADISON", sector="SOUTH"),
    ]))
    (tmp_path / "APT_BASE.csv").write_text("ARPT_ID,ICAO_ID,TPA\nI83,,\nDLH,KDLH,\nMSN,KMSN,\n")
    assert faa_data.airport_frequencies("I83", tmp_path) == [
        {"type": "CTAF", "description": "CTAF/UNICOM", "frequency_mhz": 123.0},
        {"type": "A/D", "description": "Louisville", "frequency_mhz": 123.675},
    ]
    duluth = faa_data.airport_frequencies("KDLH", tmp_path)
    assert duluth == faa_data.airport_frequencies("dlh", tmp_path)
    assert [(f["type"], f["frequency_mhz"], f["description"]) for f in duluth] == [
        ("TWR", 118.3, "Duluth"), ("GND", 121.9, "Duluth"), ("ATIS", 124.1, None), ("UNICOM", 122.95, None),
        ("A/D", 125.45, "Duluth 360-179"), ("RCO", 122.5, "Duluth RCO"),
    ]
    assert [(f["type"], f["frequency_mhz"], f["description"]) for f in faa_data.airport_frequencies("KMSN", tmp_path)] == [
        ("A/D", 120.1, "Madison east"), ("APP", 132.0, "Class C Madison south"),
    ]
    assert faa_data.airport_frequencies("ZZZ", tmp_path) is None


def test_a_sector_keeps_its_airport_idents_and_lowers_its_words(tmp_path):
    (tmp_path / "FRQ.csv").write_text(_FRQ_HEADER + "".join([
        _frq("BUR", "BUR", "119.0", "APCH/P DEP/P", approach_call="SOCAL", sector="KBUR 050 EAST"),
    ]))
    (tmp_path / "APT_BASE.csv").write_text("ARPT_ID,ICAO_ID,TPA\nBUR,KBUR,\n")
    assert faa_data.airport_frequencies("BUR", tmp_path)[0]["description"] == "Socal KBUR 050 east"


def test_several_fields_frequencies_are_read_from_one_look_at_the_file(tmp_path, monkeypatch):
    (tmp_path / "FRQ.csv").write_text(_FRQ_HEADER + _frq("I83", "I83", "123.0", "CTAF"))
    (tmp_path / "APT_BASE.csv").write_text("ARPT_ID,ICAO_ID,TPA\nI83,,\n")
    assert faa_data.airport_frequencies_for(["i83", "ZZZ"], tmp_path) == {
        "I83": [{"type": "CTAF", "description": None, "frequency_mhz": 123.0}]}
    calls = []
    monkeypatch.setattr(faa_data, "ensure_nasr_file", lambda *a: calls.append(a) or (_ for _ in ()).throw(OSError("out")))
    assert faa_data.airport_frequencies_for(["A", "B", "C"], tmp_path) == {}
    assert len(calls) == 1


def test_no_frequency_file_is_the_callers_own_list_not_a_failure(monkeypatch, tmp_path):
    def unreachable(name, cache_dir):
        raise RuntimeError("the FAA is down")
    monkeypatch.setattr(faa_data, "ensure_nasr_file", unreachable)
    assert faa_data.airport_frequencies("I83", tmp_path) is None


def test_a_field_ourairports_names_with_a_k_is_found_by_its_faa_ident(tmp_path):
    # Campbell Airport is C81 to the FAA, with no ICAO ident; OurAirports,
    # which the card's place comes from, calls it KC81.
    (tmp_path / "FRQ.csv").write_text(_FRQ_HEADER + _frq("C81", "C81", "122.7", "CTAF") + _frq("C81", "C81", "122.7", "UNICOM"))
    (tmp_path / "APT_BASE.csv").write_text("ARPT_ID,ICAO_ID,TPA\nC81,,\n")
    assert faa_data.airport_frequencies("KC81", tmp_path) == [{"type": "CTAF", "description": "CTAF/UNICOM", "frequency_mhz": 122.7}]
    assert faa_data.airport_frequencies_for(["KC81"], tmp_path)["KC81"][0]["frequency_mhz"] == 122.7


def test_a_k_ident_with_its_own_icao_field_does_not_read_another_airports_list(tmp_path):
    # KXYZ is a real ICAO ident with no frequencies filed; XYZ is another
    # field, whose ICAO ident is its own, and must not answer for it.
    (tmp_path / "FRQ.csv").write_text(_FRQ_HEADER + _frq("XYZ", "XYZ", "122.7", "CTAF"))
    (tmp_path / "APT_BASE.csv").write_text("ARPT_ID,ICAO_ID,TPA\nXYZ,PXYZ,\nQQQ,KXYZ,\n")
    assert faa_data.airport_frequencies("KXYZ", tmp_path) is None
    assert "KXYZ" not in faa_data.airport_frequencies_for(["KXYZ"], tmp_path)
