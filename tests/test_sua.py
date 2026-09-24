"""vfr.sua: the FAA's special-use airspace along a route, read from its
feature service (mocked here with GeoJSON in the service's own shape)."""
from unittest.mock import Mock, patch

import pytest

from vfr import sua


def _feature(name, type_code, ring, lower=("0", "FT", "SFC"), upper=("18000", "FT", "MSL"), times="CONTINUOUS"):
    return {
        "type": "Feature",
        "properties": {"NAME": name, "TYPE_CODE": type_code, "LOWER_VAL": lower[0], "LOWER_UOM": lower[1],
                       "LOWER_CODE": lower[2], "UPPER_VAL": upper[0], "UPPER_UOM": upper[1], "UPPER_CODE": upper[2],
                       "TIMESOFUSE": times, "CONT_AGENT": "ZDC"},
        "geometry": {"type": "Polygon", "coordinates": [ring]},
    }


BOX_ON_ROUTE = [[-90.2, 45.4], [-89.8, 45.4], [-89.8, 45.6], [-90.2, 45.6], [-90.2, 45.4]]
BOX_OFF_ROUTE = [[-88.2, 45.4], [-87.8, 45.4], [-87.8, 45.6], [-88.2, 45.6], [-88.2, 45.4]]


@pytest.fixture(autouse=True)
def _fresh_cache(monkeypatch):
    monkeypatch.setattr(sua, "_CACHE", {})


def _service(features):
    resp = Mock()
    resp.raise_for_status = Mock()
    resp.json = Mock(return_value={"type": "FeatureCollection", "features": features})
    return resp


def test_areas_the_route_crosses_are_listed_in_order_with_their_limits():
    features = [
        _feature("MOA NORTH", "MOA", BOX_ON_ROUTE, lower=("500", "FT", "AGL"), upper=("180", "FL", "MSL"),
                 times="0800-2200 LOCAL MON-FRI"),
        _feature("R-OFF", "R", BOX_OFF_ROUTE),
    ]
    with patch("vfr.sua.requests.get", return_value=_service(features)) as get:
        areas = sua.along_route((45.0, -90.0), (46.0, -90.0))

    assert get.call_args.kwargs["params"]["geometryType"] == "esriGeometryEnvelope"
    (moa,) = areas
    assert moa["name"] == "MOA NORTH" and moa["kind"] == "military operations area"
    assert moa["floor_ft"] == 500.0 and moa["floor_ref"] == "AGL"
    assert moa["ceiling_ft"] == 18000.0                          # FL180
    assert moa["times_of_use"] == "0800-2200 LOCAL MON-FRI"
    assert moa["legs"] == [0]


def test_one_answer_serves_the_day():
    with patch("vfr.sua.requests.get", return_value=_service([])) as get:
        sua.along_route((45.0, -90.0), (46.0, -90.0))
        sua.along_route((45.0, -90.0), (46.0, -90.0))
    assert get.call_count == 1


def test_a_service_that_does_not_answer_says_so():
    import requests
    with patch("vfr.sua.requests.get", side_effect=requests.ConnectionError("down")):
        with pytest.raises(sua.SpecialUseUnavailable):
            sua.along_route((45.0, -90.0), (46.0, -90.0))


@pytest.mark.parametrize("altitude, expected", [(4500, True), (18000, True), (18500, False)])
def test_a_prohibited_area_blocks_the_altitudes_between_its_limits(altitude, expected):
    area = {"type": "P", "floor_ft": 0.0, "ceiling_ft": 18000.0, "ceiling_ref": "MSL"}
    assert sua.blocked(altitude, [area]) is expected


def test_an_agl_ceiling_is_taken_as_unlimited_and_a_restricted_area_blocks_nothing():
    assert sua.blocked(30000, [{"type": "P", "floor_ft": 0.0, "ceiling_ft": 3000.0, "ceiling_ref": "AGL"}])
    assert not sua.blocked(4500, [{"type": "R", "floor_ft": 0.0, "ceiling_ft": 18000.0, "ceiling_ref": "MSL"}])
