"""vfr.glmp: the NWS's Gridded LAMP read from GRIB2 files in GLMP's own
shape (tests/glmp): the National Blend of Models' Lambert conformal grid
(R 6,371,200 m, 2,539.703 m cells) cut to four points by three from
42.30 N 88.10 W, round Campbell Airport (C81), packed as GLMP packs
(complex packing with spatial differencing), valid 2026-10-10 21:00Z --
written with ECMWF's eccodes 2.49. NOMADS is stubbed.

- cig_1500ft: every point 457.2 m, 1,500 ft.
- cig_none: every point -100, GLMP's no ceiling.
- cig_rows: 100 to 1,200 m, west to east and south to north.
- vis_10sm: every point 16,128 m, GLMP's most (10 sm).
"""
from datetime import datetime, timezone
from pathlib import Path

import pytest
import requests
from pyproj import Proj

from vfr import glmp

FIXTURES = Path(__file__).parent / "glmp"
FIRST = (42.30, -88.10)
DX = 2539.703
NOW = datetime(2026, 10, 10, 22, 40, tzinfo=timezone.utc)


def _grib(name: str) -> bytes:
    return (FIXTURES / f"{name}.grib2").read_bytes()


def _point(i: int, j: int) -> tuple[float, float]:
    """The grid point i east and j north of the first, (lat, lon)."""
    proj = Proj(proj="lcc", lon_0=265, lat_0=25, lat_1=25, lat_2=25, R=6371200)
    x0, y0 = proj(FIRST[1], FIRST[0])
    lon, lat = proj(x0 + i * DX, y0 + j * DX, inverse=True)
    return lat, lon


@pytest.fixture
def nomads(monkeypatch):
    """NOMADS with the issues in `up` (by their hour), each answering the
    grids in `grids`; the URLs asked for, in `asked`."""
    monkeypatch.setattr(glmp, "_HELD", {})
    monkeypatch.setattr(glmp, "_NOT_UP", {})
    state = {"up": {"21"}, "asked": [], "grids": {
        "cig": _grib("cig_1500ft"), "vis": _grib("vis_10sm"),
    }}

    class Answer:
        def __init__(self, status, content=b""):
            self.status_code, self.content, self.ok = status, content, status < 400

    def get(url, headers=None, timeout=None):
        state["asked"].append(url)
        hour = url.split(".t")[1][:2]
        field = url.split("hr00_")[1].split(".")[0]
        if state.get("down"):
            raise requests.ConnectionError("no route to NOMADS")
        return Answer(200, state["grids"][field]) if hour in state["up"] else Answer(404)

    monkeypatch.setattr(glmp.requests, "get", get)
    return state


def test_the_weather_modelled_at_a_point(nomads):
    weather = glmp.at(*_point(1, 1), now=NOW)
    assert weather == {"ceiling_ft": 1500.0, "visibility_sm": 10.0, "flight_category": "MVFR", "valid_at": "2026-10-10T21:00:00Z"}


def test_a_point_is_read_from_its_own_grid_point_rows_south_first(nomads):
    nomads["grids"]["cig"] = _grib("cig_rows")
    for i, j in ((0, 0), (2, 1), (3, 2)):
        metres = (j * 4 + i + 1) * 100
        assert glmp.at(*_point(i, j), now=NOW)["ceiling_ft"] == round(metres * 3.28084, -2)


def test_no_ceiling_is_none_and_vfr(nomads):
    nomads["grids"]["cig"] = _grib("cig_none")
    weather = glmp.at(*_point(1, 1), now=NOW)
    assert weather["ceiling_ft"] is None and weather["flight_category"] == "VFR"


def test_off_the_grid_is_nothing(nomads):
    assert glmp.at(46.8421, -92.1936, now=NOW) is None


def test_the_latest_issue_posted_is_read_once(nomads):
    nomads["up"] = {"22", "21"}
    glmp.at(*_point(1, 1), now=NOW)
    glmp.at(*_point(1, 1), now=NOW)
    # 22:40: the 22:30 issue, up since about 22:32; asked for once.
    assert [u.split("/")[-1] for u in nomads["asked"]] == ["glmp.t2230z.hr00_cig.g.co.grib2", "glmp.t2230z.hr00_vis.g.co.grib2"]


def test_an_issue_not_up_yet_falls_back_to_the_one_before_and_is_not_asked_for_at_every_card(nomads):
    glmp.at(*_point(1, 1), now=NOW)
    assert nomads["asked"][0].endswith("t2230z.hr00_cig.g.co.grib2") and nomads["asked"][-1].endswith("t2130z.hr00_vis.g.co.grib2")
    asked = len(nomads["asked"])
    glmp.at(*_point(1, 1), now=NOW)
    assert len(nomads["asked"]) == asked


def test_with_no_recent_issue_or_no_nomads_it_says_so(nomads):
    nomads["up"] = set()
    with pytest.raises(glmp.GlmpUnavailable):
        glmp.at(*_point(1, 1), now=NOW)
    nomads["down"] = True
    glmp._NOT_UP.clear()
    with pytest.raises(glmp.GlmpUnavailable):
        glmp.at(*_point(1, 1), now=NOW)


@pytest.mark.parametrize("ceiling, visibility, category", [
    (None, 10, "VFR"), (3100, 6, "VFR"),
    (3000, 10, "MVFR"), (None, 5, "MVFR"), (1000, 10, "MVFR"),
    (999, 10, "IFR"), (None, 2.9, "IFR"), (500, 10, "IFR"),
    (499, 10, "LIFR"), (None, 0.9, "LIFR"),
])
def test_flight_categories_are_the_aims(ceiling, visibility, category):
    assert glmp.flight_category(ceiling, visibility) == category
