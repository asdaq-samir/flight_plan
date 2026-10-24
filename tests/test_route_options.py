"""vfr.route_options: the ways round storms, weather under the pilot's
minimums, prohibited airspace and high ground, with the fuel stops."""

import time

import numpy as np
import pandas as pd
import pytest
from shapely.geometry import Polygon

from vfr import fixes, fuelstops, geo, route_options, sua, sun, terrain_detour, tfr, weather

# On the equator a degree is about 60 nm either way.
DEP = {"ident": "AAA", "lat": 0.0, "lon": 0.0}
DEST = {"ident": "BBB", "lat": 0.0, "lon": 4.0}   # about 240 nm east
PROFILE = {"cruise_tas_kt": 120.0, "fuel_burn_gph": 10.0, "usable_fuel_gal": 50.0, "taxi_fuel_gal": 1.0,
           "service_ceiling_ft": 13000.0}


def fields(*rows) -> pd.DataFrame:
    return pd.DataFrame([
        {"ident": ident, "faa_ident": ident, "name": f"{ident} FIELD", "city": "", "lat": lat, "lon": lon,
         "elevation_ft": 0.0, "fuel_types": "100LL"}
        for ident, lat, lon in rows
    ], columns=["ident", "faa_ident", "name", "city", "lat", "lon", "elevation_ft", "fuel_types"])


NO_FIELDS = fields()


def taf(ident, lat, lon, ceiling=None, visibility=10.0, wx=""):
    now = time.time()
    clouds = [{"cover": "BKN", "base": int(ceiling)}] if ceiling else []
    return {"icaoId": ident, "lat": lat, "lon": lon, "elevation_ft": 0, "raw": "", "fcsts": [{
        "timeFrom": now - 3600, "timeTo": now + 24 * 3600, "change": "", "clouds": clouds,
        "visib": str(visibility), "vert_vis": None, "wx": wx,
    }]}


@pytest.fixture
def sky(monkeypatch):
    """Flat ground, no wind, no airspace; the TAFs, METARs and SIGMETs
    the test puts in `data`."""
    data = {"tafs": [], "metars": {}, "airsigmets": [], "gairmets": []}
    monkeypatch.setattr(weather, "_dataset", lambda name: data[name])
    monkeypatch.setattr(weather, "wind_stations", lambda fcst_hr="06": ([], np.array([]), np.array([]), []))
    monkeypatch.setattr(terrain_detour, "_heights_ft", lambda lats, lons: np.zeros(lats.shape))
    monkeypatch.setattr(sua, "areas_in", lambda bbox: [])
    monkeypatch.setattr(tfr, "all_tfrs", lambda: [])
    monkeypatch.setattr(sun, "is_night", lambda lat, lon, at: False)
    monkeypatch.setattr(fuelstops, "paved_runway_ft", lambda ident: 5000)
    monkeypatch.setattr(fixes, "frd_near", lambda lat, lon, max_nm=0: {"ident": f"P{lat:.2f}/{lon:.2f}", "name": "point"})
    return data


def nearest_nm(path, lat, lon) -> float:
    """How near a way through `path` comes to a point, nm."""
    best = np.inf
    for a, b in zip(path, path[1:]):
        for t in np.linspace(0, 1, 50):
            p = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
            best = min(best, float(geo.distance_nm(p[0], p[1], lat, lon)))
    return best


def test_a_clear_day_is_the_straight_line_for_every_kind(sky):
    out = route_options.options(DEP, DEST, PROFILE, fields=NO_FIELDS)
    assert len(out["options"]) == 1
    only = out["options"][0]
    assert only["stops"] == [] and only["landings"] == 0
    assert only["kinds"] == ["fastest", "weather", "stops"]
    assert out["direct"] == []
    assert only["distance_nm"] == pytest.approx(240, abs=2)


def test_a_thunderstorm_on_the_line_is_gone_round_by_twenty_miles(sky):
    sky["tafs"].append(taf("STRM", 0.0, 2.0, wx="TSRA"))
    out = route_options.options(DEP, DEST, PROFILE, fields=NO_FIELDS)
    names = [out["hazards"][i]["name"] for i in out["direct"]]
    assert names == ["Thunderstorms forecast at STRM"]
    fastest = out["options"][0]
    assert fastest["stops"], "a way round needs a turn"
    assert fastest["crosses"] == []
    # AIM 7-1-29's 20 miles, less the grid's half cell.
    assert nearest_nm(fastest["path"], 0.0, 2.0) >= route_options.STORM_NM - 8


def test_the_pilots_minimums_close_what_the_rules_alone_would_not(sky):
    # A 2,500 ft ceiling: legal (91.155) but under a 3,000 ft personal minimum.
    sky["tafs"].append(taf("LOWW", 0.0, 2.0, ceiling=2500))
    legal = route_options.options(DEP, DEST, PROFILE, fields=NO_FIELDS)
    assert legal["direct"] == []
    # Marginal (MVFR), so the best weather's way keeps off it where the fastest does not.
    fastest = next(o for o in legal["options"] if "fastest" in o["kinds"])
    best = next(o for o in legal["options"] if "weather" in o["kinds"])
    assert fastest["stops"] == [] and fastest["marginal"]
    assert best is not fastest and best["marginal"] == []
    personal = route_options.options(DEP, DEST, PROFILE, fields=NO_FIELDS, min_ceiling_ft=3000)
    assert [personal["hazards"][i]["kind"] for i in personal["direct"]] == ["weather"]
    assert all(o["crosses"] == [] for o in personal["options"])


def test_minimums_never_go_under_the_rules(sky):
    sky["tafs"].append(taf("FOGG", 0.0, 2.0, ceiling=800))
    out = route_options.options(DEP, DEST, PROFILE, fields=NO_FIELDS, min_ceiling_ft=500)
    assert [out["hazards"][i]["kind"] for i in out["direct"]] == ["weather"]


def test_a_prohibited_area_is_gone_round(monkeypatch, sky):
    box = Polygon([(1.8, -0.2), (2.2, -0.2), (2.2, 0.2), (1.8, 0.2)])
    monkeypatch.setattr(sua, "areas_in", lambda bbox: [({"name": "P-99", "type": "P"}, box)])
    out = route_options.options(DEP, DEST, PROFILE, fields=NO_FIELDS)
    assert [out["hazards"][i]["name"] for i in out["direct"]] == ["Prohibited area P-99"]
    assert out["options"][0]["crosses"] == []


def test_the_destinations_own_weather_is_said_not_gone_round(sky):
    sky["tafs"].append(taf("BBB", 0.0, 4.0, ceiling=300, visibility=1))
    out = route_options.options(DEP, DEST, PROFILE, fields=NO_FIELDS)
    assert [out["hazards"][i]["name"] for i in out["ends"]] == ["BBB forecast under minimums (ceiling 300 ft, visibility 1 sm)"]
    assert out["options"][0]["crosses"] == []


def test_fuel_stops_land_with_the_reserve_and_the_fewest_kind_lands_least(sky):
    # 600 nm at 120 kt is 5 h, 50 gal; the tanks hold 49 less 5 of
    # reserve (30 minutes by day, 91.151), 4.4 h or 528 nm.
    dest = {"ident": "CCC", "lat": 0.0, "lon": 10.0}
    table = fields(*[(f"F{k}", 0.0, float(k)) for k in range(1, 10)])
    out = route_options.options(DEP, dest, PROFILE, fields=table)
    fastest = next(o for o in out["options"] if "fastest" in o["kinds"])
    assert fastest["landings"] >= 1
    assert set(fastest["fuel"]) <= set(fastest["stops"])
    # Each flight between landings within the tanks.
    ends = [0.0] + [float(f[1:]) for f in fastest["fuel"]] + [10.0]
    assert all((b - a) * 60 <= 528 + 1 for a, b in zip(ends, ends[1:]))
    fewest = next(o for o in out["options"] if "stops" in o["kinds"])
    assert fewest["landings"] <= fastest["landings"]


def test_the_pilots_own_route_is_kept_and_what_it_crosses_said(sky):
    sky["tafs"].append(taf("STRM", 0.0, 2.0, wx="TSRA"))
    through = [(0.0, 0.0), (0.0, 2.0), (0.0, 4.0)]
    round_it = [(0.0, 0.0), (1.0, 2.0), (0.0, 4.0)]
    crossing = route_options.options(DEP, DEST, PROFILE, fields=NO_FIELDS, current=through)
    assert [crossing["hazards"][i]["name"] for i in crossing["current"]] == ["Thunderstorms forecast at STRM"]
    clear = route_options.options(DEP, DEST, PROFILE, fields=NO_FIELDS, current=round_it)
    assert clear["current"] == []


def test_an_ifr_g_airmet_between_the_fields_is_gone_round(sky):
    sky["gairmets"].append({"hazard": "IFR conditions", "valid": time.time(), "altitude_low_ft": None,
                            "coords": [(-0.3, 1.7), (0.3, 1.7), (0.3, 2.3), (-0.3, 2.3)]})
    out = route_options.options(DEP, DEST, PROFILE, fields=NO_FIELDS)
    assert [out["hazards"][i]["name"] for i in out["direct"]] == ["G-AIRMET for IFR conditions"]
    assert out["options"][0]["crosses"] == []


def test_where_nothing_keeps_clear_the_way_crossing_least_is_offered_with_what_it_crosses(monkeypatch, sky):
    # A wall of high ground across the whole grid, over the airplane's reach.
    monkeypatch.setattr(terrain_detour, "_heights_ft",
                        lambda lats, lons: np.where(np.abs(lons - 2.0) < 0.3, 20000.0, 0.0))
    out = route_options.options(DEP, DEST, PROFILE, fields=NO_FIELDS)
    assert out["options"], "a way is offered all the same"
    crossing = out["options"][0]
    assert [out["hazards"][i]["kind"] for i in crossing["crosses"]] == ["terrain"]
    assert len(crossing["stops"]) <= route_options.MAX_TURNS


def test_each_way_says_the_weather_it_meets_its_wind_and_its_floor(sky):
    sky["tafs"].append(taf("LOWW", 0.0, 2.0, ceiling=2500))
    out = route_options.options(DEP, DEST, PROFILE, fields=NO_FIELDS)
    fastest = next(o for o in out["options"] if "fastest" in o["kinds"])
    kinds = [b["kind"] for b in fastest["bands"]]
    assert kinds == ["vfr", "mvfr", "vfr"]
    assert sum(b["min"] for b in fastest["bands"]) == pytest.approx(fastest["air_min"], rel=0.05)
    assert fastest["tail_kt"] == 0.0                       # no wind in this sky
    # Flat ground at sea level: 91.119's 1,000 and the coarse read's 1,000.
    assert fastest["floor_ft"] == 2000
    assert [b["kind"] for b in out["current_along"]["bands"]] == ["vfr", "mvfr", "vfr"]
