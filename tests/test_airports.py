"""airports.get_airport/get_runways/get_frequencies, against small local
CSVs shaped like OurAirports' real ones -- no network call, and no
collision with the real disk cache, since each test gets its own
tmp_path and _load_table keys its cache on that exact path.
"""
import pandas as pd
import pytest

from vfr.airports import get_airport, get_frequencies, get_runways


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
