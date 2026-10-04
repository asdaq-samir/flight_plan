"""A route's side view: the ground and the airspace along it."""
import pytest
from shapely.geometry import box

from vfr import profile


@pytest.fixture
def flat_world(monkeypatch):
    """Ground at 300 m everywhere, and one Class D box over the middle of
    a route north from (42, -88)."""
    monkeypatch.setattr(profile.elevation, "get_elevations_m", lambda points: {p: 300.0 for p in points})
    monkeypatch.setattr(profile, "load_controlled_airspace", lambda shp, bbox: [{
        "name": "SOMEWHERE CLASS D", "class": "D", "floor_ft_msl": 0.0, "ceiling_ft_msl": 3500.0,
        "geometry": box(-88.1, 42.4, -87.9, 42.6),
    }])


def test_the_ground_every_two_miles_and_the_airspace_where_the_route_is_in_it(flat_world):
    side = profile.route_profile([(42.0, -88.0), (43.0, -88.0)], "unused.shp")
    assert side["length_nm"] == pytest.approx(60.0, abs=0.2)
    assert len(side["terrain"]) == 31 and side["terrain"][0] == {"along_nm": 0.0, "ground_ft": 984}
    (d,) = side["airspace"]
    assert d["class"] == "D" and d["floor_ft"] == 0.0 and d["ceiling_ft"] == 3500.0
    assert d["from_nm"] == pytest.approx(24.0, abs=0.3) and d["to_nm"] == pytest.approx(36.0, abs=0.3)


def test_a_stop_runs_the_distances_on_and_its_ground_once(flat_world):
    side = profile.route_profile([(42.0, -88.0), (42.5, -88.0), (43.0, -88.0)], "unused.shp")
    alongs = [t["along_nm"] for t in side["terrain"]]
    assert alongs == sorted(set(alongs)) and alongs[-1] == pytest.approx(60.0, abs=0.2)
