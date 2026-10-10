"""vfr.alerts: what is ahead of own ship, with the airspace, special-use
areas, TFRs, ground and obstacles stubbed. Own ship is at 42 N 88 W
going east at 120 kt -- two miles a minute, 0.0224 degrees of longitude
a mile there."""
from datetime import datetime, timedelta, timezone

import pandas as pd
import pytest
import requests
from shapely.geometry import box

from vfr import airports, airspace, alerts, elevation, faa_data, sua, tfr

LAT, LON = 42.0, -88.0
NOW = datetime(2026, 10, 10, 18, 0, tzinfo=timezone.utc)
#: Degrees of longitude in a nautical mile at 42 N.
MILE = 1 / (60 * 0.7431)


def _east(from_nm: float, to_nm: float, half_width_nm: float = 2.0):
    """A box across the track from `from_nm` to `to_nm` ahead."""
    return box(LON + from_nm * MILE, LAT - half_width_nm / 60, LON + to_nm * MILE, LAT + half_width_nm / 60)


def _volume(name, klass, geometry, floor=0.0, ceiling=5000.0):
    return {"name": name, "class": klass, "ident": "", "floor_ft_msl": floor, "ceiling_ft_msl": ceiling,
            "geometry": geometry, "bbox": geometry.bounds}


def _area(name, type_code, geometry, floor=0.0, floor_ref="SFC", ceiling=18000.0, ceiling_ref="MSL"):
    return ({"name": name, "type": type_code, "kind": sua.TYPES.get(type_code), "floor_ft": floor, "floor_ref": floor_ref,
             "ceiling_ft": ceiling, "ceiling_ref": ceiling_ref, "times_of_use": "0700-2200 MON-FRI",
             "controlling_agency": "ZAU"}, geometry)


def _obstacles(rows=()):
    return pd.DataFrame(list(rows), columns=["lat", "lon", "city", "type", "agl_ft", "amsl_ft", "lit"])


@pytest.fixture
def ahead(monkeypatch):
    """alerts.ahead over what each test puts in `world`."""
    world = {"volumes": [], "areas": [], "tfrs": [], "ground_ft": lambda lat, lon: 800.0,
             "obstacles": _obstacles(), "nearest_nm": 20.0, "field_ft": 800.0}
    monkeypatch.setattr(airspace, "load_controlled_airspace", lambda shp, bbox: world["volumes"])
    monkeypatch.setattr(sua, "areas_in", lambda bbox: world["areas"])
    monkeypatch.setattr(tfr, "all_tfrs", lambda: world["tfrs"])
    monkeypatch.setattr(elevation, "ground_m", lambda lat, lon: world["ground_ft"](lat, lon) / 3.28084)
    monkeypatch.setattr(faa_data, "ensure_nasr_file", lambda name, cache_dir: "DOF.DAT")
    monkeypatch.setattr(faa_data, "load_obstacles", lambda path, bbox, min_agl_ft=0: world["obstacles"])
    monkeypatch.setattr(airports, "nearest", lambda lat, lon, limit=1: [
        {"ident": "C81", "distance_nm": world["nearest_nm"], "elevation_ft": world["field_ft"]}])

    def run(alt=3000.0, vs=0.0, gs=120.0, track=90.0):
        return alerts.ahead(LAT, LON, track, gs, alt, vs, shp_path="Class_Airspace.shp", faa_cache_dir="faa", now=NOW)

    run.world = world
    return run


def test_a_class_c_ahead_is_said_with_how_long_until_it(ahead):
    ahead.world["volumes"] = [_volume("ROCKFORD CLASS C", "C", _east(4, 8))]
    (alert,) = ahead()["alerts"]
    assert alert["kind"] == "airspace" and alert["class"] == "C" and alert["level"] == "caution"
    # Four miles at two a minute, to the five seconds the track is tested at.
    assert alert["seconds"] == pytest.approx(120, abs=5)
    assert alert["distance_nm"] == pytest.approx(4.0, abs=0.25)
    assert "91.130(c)(1)" in alert["need"]
    assert alert["inside"] is False


def test_a_class_b_wants_a_clearance_and_is_a_warning(ahead):
    ahead.world["volumes"] = [_volume("CHICAGO CLASS B", "B", _east(2, 20), floor=0.0, ceiling=10000.0)]
    (alert,) = ahead()["alerts"]
    assert alert["level"] == "warning" and "91.131(a)(1)" in alert["need"]


def test_nothing_is_said_of_the_airspace_the_airplane_is_in(ahead):
    # Out of a towered field: in its Class D, whose tower it has talked to.
    ahead.world["volumes"] = [_volume("DUPAGE CLASS D", "D", _east(-3, 3), ceiling=3300.0)]
    assert ahead(alt=2000.0)["alerts"] == []


def test_a_shelf_overhead_is_said_only_as_the_airplane_climbs_to_it(ahead):
    ahead.world["volumes"] = [_volume("CHICAGO CLASS B", "B", _east(-5, 20), floor=3600.0, ceiling=10000.0)]
    # Level 600 ft under it, more than the 200 ft that counts as going in.
    assert ahead(alt=3000.0)["alerts"] == []
    # Climbing at 500 ft a minute: within 200 ft of the floor in 48 s.
    (alert,) = ahead(alt=3000.0, vs=500.0)["alerts"]
    assert alert["seconds"] == pytest.approx(50, abs=5)


def test_without_an_altitude_the_airspace_is_looked_at_laterally_and_the_ground_not_at_all(ahead):
    ahead.world["volumes"] = [_volume("CHICAGO CLASS B", "B", _east(3, 20), floor=3600.0, ceiling=10000.0)]
    ahead.world["ground_ft"] = lambda lat, lon: 5000.0
    (alert,) = ahead(alt=None)["alerts"]
    assert alert["kind"] == "airspace"


def test_special_use_areas_ahead_and_the_one_the_airplane_is_in(ahead):
    ahead.world["areas"] = [
        _area("P-56A", "P", _east(3, 4)),
        _area("R-6901A", "R", _east(-1, 1)),
        _area("VOLK EAST MOA", "MOA", _east(6, 9), floor=500.0, floor_ref="AGL"),
        _area("R-HIGH", "R", _east(2, 5), floor=10000.0, floor_ref="MSL"),
    ]
    found = {a["name"]: a for a in ahead()["alerts"]}
    assert set(found) == {"P-56A", "R-6901A", "VOLK EAST MOA"}
    assert found["P-56A"]["level"] == "warning" and "91.133(a)" in found["P-56A"]["need"]
    assert found["R-6901A"]["inside"] is True and found["R-6901A"]["seconds"] == 0
    assert found["VOLK EAST MOA"]["level"] == "caution" and "AIM 3-4-5" in found["VOLK EAST MOA"]["need"]
    # An AGL floor over the ground under the airplane: 500 over 800 ft.
    assert found["VOLK EAST MOA"]["floor_ft"] == 1300.0


def test_a_tfr_in_force_ahead_is_a_warning_and_one_not_in_force_is_not_said(ahead):
    def restriction(notam, effective, expires):
        return {"notam_id": notam, "title": "Stadium", "kind": "Security", "rule": "special security instructions (99.7)",
                "effective": effective.isoformat(), "expires": expires.isoformat(),
                "geometry": _east(3, 5).__geo_interface__, "floor_ft": 0.0, "floor_ref": "AGL",
                "ceiling_ft": 3000.0, "ceiling_ref": "AGL"}

    ahead.world["tfrs"] = [
        restriction("6/1111", NOW - timedelta(hours=1), NOW + timedelta(hours=2)),
        restriction("6/2222", NOW + timedelta(days=1), NOW + timedelta(days=2)),
    ]
    (alert,) = ahead()["alerts"]
    assert alert["kind"] == "tfr" and alert["level"] == "warning" and alert["notam_id"] == "6/1111"
    assert "NOTAM 6/1111" in alert["need"] and "99.7" in alert["need"]
    assert alert["ceiling_ft"] == 3800.0


def test_rising_ground_within_500_ft_in_the_next_minute_is_a_caution(ahead):
    # The ground rises to 2,600 ft a mile ahead: 400 ft under 3,000.
    ahead.world["ground_ft"] = lambda lat, lon: 2600.0 if lon > LON + 0.9 * MILE else 800.0
    (alert,) = ahead()["alerts"]
    assert alert["kind"] == "terrain" and alert["level"] == "caution"
    assert alert["top_ft"] == 2600.0 and alert["clearance_ft"] == 400.0
    assert "91.119(c)" in alert["need"]


def test_ground_at_the_airplanes_altitude_within_half_a_minute_is_a_warning(ahead):
    ahead.world["ground_ft"] = lambda lat, lon: 2950.0 if lon > LON + 0.6 * MILE else 800.0
    (alert,) = ahead()["alerts"]
    assert alert["level"] == "warning" and alert["seconds"] <= alerts.TERRAIN_WARNING_S


def test_descending_into_the_ground_is_seen_before_it_is_reached(ahead):
    ahead.world["ground_ft"] = lambda lat, lon: 800.0
    # 1,000 ft over the ground, 1,000 ft a minute down: 500 ft over it in 30 s.
    (alert,) = ahead(alt=1800.0, vs=-1000.0)["alerts"]
    assert alert["kind"] == "terrain" and alert["level"] == "caution"


def test_near_a_field_the_ground_is_not_alerted_but_obstacles_are(ahead):
    ahead.world["nearest_nm"] = 2.0
    ahead.world["field_ft"] = 2400.0
    ahead.world["ground_ft"] = lambda lat, lon: 2600.0
    ahead.world["obstacles"] = _obstacles([(LAT, LON + 1.0 * MILE, "X", "TOWER", 1900.0, 2700.0, True)])
    (alert,) = ahead()["alerts"]
    assert alert["kind"] == "obstacle" and alert["name"] == "TOWER"
    assert alert["top_ft"] == 2700.0 and alert["clearance_ft"] == 300.0
    assert alert["seconds"] == pytest.approx(30, abs=1)


def test_passing_high_over_a_field_the_ground_is_still_alerted(ahead):
    ahead.world["nearest_nm"] = 2.0
    ahead.world["field_ft"] = 800.0
    ahead.world["ground_ft"] = lambda lat, lon: 2600.0 if lon > LON + 0.9 * MILE else 800.0
    (alert,) = ahead()["alerts"]
    assert alert["kind"] == "terrain"


def test_an_agl_ceiling_is_over_the_ground_under_the_area_and_no_limit_where_unread(ahead, monkeypatch):
    ahead.world["areas"] = [_area("HIGH MOA", "MOA", _east(3, 5), floor=0.0, ceiling=1000.0, ceiling_ref="AGL")]
    # 1,000 AGL over 2,500 ft ground is 3,500 MSL: the airplane at 3,000 is in it.
    ahead.world["ground_ft"] = lambda lat, lon: 2500.0 if lon > LON + 2.0 * MILE else 800.0
    assert [a["name"] for a in ahead()["alerts"] if a["kind"] == "special_use"] == ["HIGH MOA"]
    # At 4,300 it is above that ceiling; with the ground unread there is no saying, so it is alerted.
    assert [a for a in ahead(alt=4300.0)["alerts"] if a["kind"] == "special_use"] == []
    monkeypatch.setattr(alerts, "_ground_ft", lambda lat, lon: None)
    assert [a["name"] for a in ahead(alt=4300.0)["alerts"] if a["kind"] == "special_use"] == ["HIGH MOA"]


def test_without_an_altitude_the_ground_is_said_not_read(ahead):
    assert ahead(alt=None)["unavailable"] == ["terrain and obstacles, with no GPS altitude"]


def test_an_obstacle_off_the_track_or_well_below_is_not_said(ahead):
    ahead.world["obstacles"] = _obstacles([
        (LAT + 0.5 / 60, LON + 1.0 * MILE, "X", "TOWER", 1900.0, 2700.0, True),   # half a mile north
        (LAT, LON + 1.0 * MILE, "X", "STACK", 400.0, 1200.0, True),                # 1,800 ft below
    ])
    assert ahead()["alerts"] == []


def test_warnings_come_first_then_the_soonest(ahead):
    ahead.world["volumes"] = [_volume("ROCKFORD CLASS C", "C", _east(1, 3)), _volume("CHICAGO CLASS B", "B", _east(6, 9))]
    assert [a["class"] for a in ahead()["alerts"]] == ["B", "C"]


def test_on_the_ground_nothing_is_said(ahead):
    ahead.world["volumes"] = [_volume("ROCKFORD CLASS C", "C", _east(0.1, 3))]
    assert ahead(gs=20.0)["alerts"] == []


def test_what_cannot_be_read_is_said(ahead, monkeypatch):
    def sua_down(bbox):
        raise sua.SpecialUseUnavailable("down")

    def tfr_down():
        raise tfr.TfrUnavailable("down")

    def no_tiles(lat, lon):
        raise requests.ConnectionError("no tiles")

    monkeypatch.setattr(sua, "areas_in", sua_down)
    monkeypatch.setattr(tfr, "all_tfrs", tfr_down)
    monkeypatch.setattr(elevation, "ground_m", no_tiles)
    assert ahead()["unavailable"] == ["special-use airspace", "TFRs", "terrain"]
