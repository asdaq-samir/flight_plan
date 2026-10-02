"""airports.get_airport/get_runways/get_frequencies, against small local
CSVs shaped like OurAirports' real ones -- no network call, and no
collision with the real disk cache, since each test gets its own
tmp_path and _load_table keys its cache on that exact path.
"""
import pandas as pd
import pytest

from vfr.airports import find_place, get_airport, get_frequencies, get_runways, places_in


@pytest.fixture
def airports_csv(tmp_path):
    path = tmp_path / "airports.csv"
    pd.DataFrame([
        {"ident": "KDLH", "local_code": "DLH", "name": "Duluth Intl", "latitude_deg": 46.8421,
         "longitude_deg": -92.1936, "elevation_ft": 1428, "municipality": "Duluth", "iso_region": "US-MN"},
        {"ident": "US-0C81", "local_code": "C81", "name": "C81 Field", "latitude_deg": 42.3172,
         "longitude_deg": -88.0905, "elevation_ft": 860, "municipality": "Wonder Lake", "iso_region": "US-IL"},
    ]).to_csv(path, index=False)
    return path


@pytest.fixture
def runways_csv(tmp_path):
    path = tmp_path / "runways.csv"
    # le_ident/he_ident deliberately mix a lettered suffix ("09L") in with
    # a bare-digit one ("03") in the same column -- a fixture of purely
    # numeric idents (e.g. all "09"/"27"/"03") reads back through
    # pd.read_csv as an int/float column, silently dropping the leading
    # zero this real OurAirports data actually has; real runways.csv is
    # never purely numeric end to end, so this fixture shouldn't be either.
    pd.DataFrame([
        {"airport_ident": "KDLH", "le_ident": "09L", "he_ident": "27R", "length_ft": 10152, "width_ft": 150,
         "surface": "ASP", "lighted": 1, "closed": 0},
        {"airport_ident": "KDLH", "le_ident": "03", "he_ident": None, "length_ft": 5001, "width_ft": 100,
         "surface": "ASP", "lighted": 0, "closed": 0},
    ]).to_csv(path, index=False)
    return path


@pytest.fixture
def frequencies_csv(tmp_path):
    path = tmp_path / "frequencies.csv"
    pd.DataFrame([
        {"airport_ident": "KDLH", "type": "ATIS", "description": "DULUTH ATIS", "frequency_mhz": 124.15},
        {"airport_ident": "KDLH", "type": "CTAF", "description": "DULUTH CTAF", "frequency_mhz": 118.3},
        {"airport_ident": "KDLH", "type": "TWR", "description": "DULUTH TOWER", "frequency_mhz": 118.3},
    ]).to_csv(path, index=False)
    return path


def test_get_airport_finds_by_ident(airports_csv):
    airport = get_airport("KDLH", cache_path=airports_csv)

    assert airport["name"] == "Duluth Intl"
    assert airport["lat"] == pytest.approx(46.8421)
    assert airport["elevation_ft"] == 1428.0


def test_get_airport_finds_by_local_code(airports_csv):
    airport = get_airport("C81", cache_path=airports_csv)

    assert airport["ident"] == "US-0C81"


def test_get_airport_is_case_insensitive(airports_csv):
    assert get_airport("kdlh", cache_path=airports_csv)["ident"] == "KDLH"


def test_get_airport_raises_for_an_unknown_ident(airports_csv):
    with pytest.raises(ValueError, match="ZZZZ"):
        get_airport("ZZZZ", cache_path=airports_csv)


def test_get_runways_joins_le_and_he_idents(runways_csv):
    runways = get_runways("KDLH", cache_path=runways_csv)

    ends = {r["ends"] for r in runways}
    assert ends == {"09L/27R", "03"}


def test_get_runways_returns_nothing_for_an_airport_with_none_listed(runways_csv):
    assert get_runways("KMSP", cache_path=runways_csv) == []


def test_get_frequencies_sorts_ctaf_first(frequencies_csv):
    frequencies = get_frequencies("KDLH", cache_path=frequencies_csv)

    assert [f["type"] for f in frequencies] == ["CTAF", "TWR", "ATIS"]


def test_two_stages_asking_for_a_table_at_once_download_it_once_and_both_read_it_whole(tmp_path, monkeypatch):
    """A briefing asks for the runways from two stages at once. On a
    cold cache each downloaded the table, and one read the other's
    half-written file: "No columns to parse from file", a 500 for the
    first briefing after a fresh start."""
    import threading
    from vfr import airports

    downloads = []
    body = b"id,airport_ident,le_ident,he_ident\n1,KDLH,09,27\n" + b"2,KDLH,03,21\n" * 20000

    class SlowResponse:
        content = body

        @staticmethod
        def raise_for_status():
            pass

    def slow_get(url, headers=None, timeout=None):
        downloads.append(url)
        threading.Event().wait(0.05)
        return SlowResponse()

    monkeypatch.setattr(airports.requests, "get", slow_get)
    path = tmp_path / "runways.csv"
    sizes, errors = [], []

    def read():
        try:
            sizes.append(airports._ensure_cached("https://example.test/runways.csv", path).stat().st_size)
        except Exception as err:  # noqa: BLE001 -- the assertion below names it
            errors.append(err)

    threads = [threading.Thread(target=read) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert errors == []
    assert downloads == ["https://example.test/runways.csv"]
    assert sizes == [len(body)] * 4
    assert not list(tmp_path.glob("*.part"))


@pytest.fixture
def us_airports_csv(tmp_path):
    """The columns the US-only slice reads: a real ICAO ident (KDLH), a
    field OurAirports gave a made-up one (KC81, local code C81), a small
    field, a heliport, a closed field and one abroad."""
    path = tmp_path / "us_airports.csv"
    row = {"municipality": "", "iso_region": "US-MN", "iso_country": "US", "elevation_ft": 1000}
    pd.DataFrame([
        {**row, "ident": "KDLH", "icao_code": "KDLH", "local_code": "DLH", "name": "Duluth Intl", "type": "medium_airport",
         "latitude_deg": 46.8421, "longitude_deg": -92.1936},
        {**row, "ident": "KC81", "icao_code": None, "local_code": "C81", "name": "Campbell Airport", "type": "small_airport",
         "latitude_deg": 42.3246, "longitude_deg": -88.0741},
        {**row, "ident": "KMSP", "icao_code": "KMSP", "local_code": "MSP", "name": "Minneapolis-St Paul", "type": "large_airport",
         "latitude_deg": 44.8848, "longitude_deg": -93.2223},
        {**row, "ident": "MN01", "icao_code": None, "local_code": "MN01", "name": "A Helipad", "type": "heliport",
         "latitude_deg": 46.8, "longitude_deg": -92.2},
        {**row, "ident": "MN02", "icao_code": None, "local_code": "MN02", "name": "Gone Field", "type": "closed",
         "latitude_deg": 46.7, "longitude_deg": -92.3},
        {**row, "ident": "CYQT", "icao_code": "CYQT", "local_code": None, "name": "Thunder Bay", "type": "medium_airport",
         "latitude_deg": 48.3719, "longitude_deg": -89.3239, "iso_country": "CA"},
        {**row, "ident": "US-0043", "icao_code": None, "local_code": "C81", "name": "Campbell (old record)", "type": "small_airport",
         "latitude_deg": 42.3245, "longitude_deg": -88.0742},
        # A real ICAO code OurAirports left out of icao_code: Chicago
        # Executive, KPWK in its METAR and on every chart.
        {**row, "ident": "KPWK", "icao_code": None, "local_code": "PWK", "name": "Chicago Executive", "type": "medium_airport",
         "iso_region": "US-IL", "latitude_deg": 42.1142, "longitude_deg": -87.9015},
    ]).to_csv(path, index=False)
    return path


def test_a_place_is_found_by_any_ident_it_goes_by(us_airports_csv):
    assert find_place("C81", cache_path=us_airports_csv)["ident"] == "C81"
    assert find_place("kc81", cache_path=us_airports_csv)["ident"] == "C81"
    duluth = find_place("KDLH", cache_path=us_airports_csv)
    assert duluth["ident"] == "KDLH"
    assert duluth["source_ident"] == "KDLH"
    assert duluth["kind"] == "medium"
    assert find_place("CYQT", cache_path=us_airports_csv) is None
    assert find_place("", cache_path=us_airports_csv) is None


def test_a_three_letter_field_goes_by_its_k_code_where_one_with_a_digit_goes_by_its_own(us_airports_csv):
    # KPWK, not PWK, beside KMDW: OurAirports leaves its icao_code empty.
    assert find_place("PWK", cache_path=us_airports_csv)["ident"] == "KPWK"
    assert find_place("KPWK", cache_path=us_airports_csv)["ident"] == "KPWK"
    # C81 has no ICAO code; OurAirports' KC81 is its own invention.
    assert find_place("KC81", cache_path=us_airports_csv)["ident"] == "C81"


def test_the_places_in_a_box_are_landing_fields_biggest_first(us_airports_csv):
    everywhere = places_in(40, -95, 47, -87, cache_path=us_airports_csv)
    assert [p["ident"] for p in everywhere] == ["KMSP", "KDLH", "KPWK", "C81"]
    assert [p["ident"] for p in places_in(46, -93, 47, -92, cache_path=us_airports_csv)] == ["KDLH"]
    assert [p["ident"] for p in places_in(40, -95, 47, -87, limit=1, cache_path=us_airports_csv)] == ["KMSP"]
    # Only the ones asked for, before the limit: KMSP would come first.
    assert [p["ident"] for p in places_in(40, -95, 47, -87, limit=1, cache_path=us_airports_csv, only={"KDLH"})] == ["KDLH"]
