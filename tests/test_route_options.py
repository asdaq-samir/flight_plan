"""vfr.route_options: the ways round storms, weather under the pilot's
minimums, prohibited airspace and high ground, with the fuel stops."""

import time

import numpy as np
import pandas as pd
import pytest
from shapely.geometry import Polygon

from vfr import fixes, fuelstops, geo, route_options, sua, sun, terrain_detour, tfr, water, weather

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
    # No fix to turn at unless a test puts one there.
    monkeypatch.setattr(fixes, "within", lambda south, west, north, east: [])
    # Dry land everywhere unless a test floods it.
    monkeypatch.setattr(water, "is_water", lambda lats, lons: np.zeros(np.shape(lats), dtype=bool))
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
    assert only["kinds"] == ["fastest", "weather", "stops", "land"]
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
    # Flat ground at sea level: 91.119's 1,000 ft alone, the coarse read's
    # own margin kept by the planner, not told.
    assert fastest["floor_ft"] == 1000
    assert [b["kind"] for b in out["current_along"]["bands"]] == ["vfr", "mvfr", "vfr"]


def test_the_pilots_own_route_gets_its_fuel_stops_put_in_among_its_points(sky):
    dest = {"ident": "CCC", "lat": 0.0, "lon": 10.0}
    table = fields(*[(f"F{k}", 0.0, float(k)) for k in range(1, 10)])
    # The pilot's route through their own point at 2 degrees east.
    current = [(0.0, 0.0), (0.0, 2.0), (0.0, 10.0)]
    out = route_options.options(DEP, dest, PROFILE, fields=table, current=current, current_idents=["MINE"])
    own = out["own"]
    assert own["kind"] == "own" and own["landings"] >= 1
    assert own["stops"][0] == "MINE"
    assert set(own["fuel"]) < set(own["stops"])
    # In order along it: each fuel stop east of the one before.
    east = [float(s[1:]) for s in own["stops"][1:]]
    assert east == sorted(east)


def test_a_landing_the_pilot_makes_is_a_refuel_not_a_stop_to_add(sky):
    # Two hops of 300 nm in tanks for 400: each is flown on its own, so no
    # fuel stop is needed -- and the field landed at was offered as the
    # stop to add, twice over in the route (the audit of 2026-10-24).
    dest = {"ident": "CCC", "lat": 0.0, "lon": 10.0}
    table = fields(("MID", 0.0, 5.0), *[(f"F{k}", 0.0, float(k)) for k in (2, 3, 7, 8)])
    current = [(0.0, 0.0), (0.0, 5.0), (0.0, 10.0)]
    out = route_options.options(DEP, dest, PROFILE, fields=table, current=current, current_idents=["MID"], current_landed=[True])
    own = out["own"]
    assert own["stops"] == ["MID"]
    assert own["fuel"] == []
    # Its landing counted, with the owner's 30 minutes on the ground.
    assert own["landings"] == 1 and own["ground_min"] == route_options.TURNAROUND_MIN
    # Flown over instead (a fix), the whole 600 nm is one flight that needs a stop.
    over = route_options.options(DEP, dest, PROFILE, fields=table, current=current, current_idents=["MINE"], current_landed=[False])
    assert over["own"]["fuel"], "a stop is needed when nothing is landed at"
    assert "MINE" not in over["own"]["fuel"]


def test_a_way_no_fuel_field_reaches_is_offered_with_that_said(sky):
    # 600 nm in tanks for 400 and no field at all: the way is offered, the
    # want of fuel one of the things it meets, never dropped.
    dest = {"ident": "CCC", "lat": 0.0, "lon": 10.0}
    out = route_options.options(DEP, dest, PROFILE, fields=NO_FIELDS)
    assert out["options"], "offered all the same"
    kinds = {out["hazards"][i]["kind"] for i in out["options"][0]["crosses"]}
    assert "fuel" in kinds
    assert out["own"] is not None and "fuel" in {out["hazards"][i]["kind"] for i in out["own"]["crosses"]}


def test_a_turn_with_no_fix_near_is_a_position_of_the_pilots_own(monkeypatch, sky):
    sky["tafs"].append(taf("STRM", 0.0, 2.0, wx="TSRA"))
    monkeypatch.setattr(route_options.fixes, "frd_near", lambda lat, lon: None)
    out = route_options.options(DEP, DEST, PROFILE, fields=NO_FIELDS)
    way = out["options"][0]
    assert way["stops"], "the way round the storm turns somewhere"
    assert all(s.startswith("@") for s in way["stops"])


def test_terrain_that_cannot_be_read_is_said_not_fatal(monkeypatch, sky):
    def down(lats, lons):
        raise OSError("tiles unreachable")
    monkeypatch.setattr(terrain_detour, "_heights_ft", down)
    out = route_options.options(DEP, DEST, PROFILE, fields=NO_FIELDS)
    assert "terrain" in out["unchecked"]
    assert out["options"]


def test_the_floor_told_is_the_ground_with_its_thousand_feet_alone(sky):
    out = route_options.options(DEP, DEST, PROFILE, fields=NO_FIELDS)
    # Sea level everywhere: 91.119's 1,000 ft, not the coarse read's margin too.
    assert out["options"][0]["floor_ft"] == terrain_detour.TERRAIN_MARGIN_FT


def test_the_pilots_own_route_is_given_as_a_path_for_the_map(sky):
    current = [(0.0, 0.0), (1.0, 2.0), (0.0, 4.0)]
    out = route_options.options(DEP, DEST, PROFILE, fields=NO_FIELDS, current=current)
    assert out["current_path"] == [[0.0, 0.0], [1.0, 2.0], [0.0, 4.0]]
    straight = route_options.options(DEP, DEST, PROFILE, fields=NO_FIELDS)
    assert straight["current_path"] == [[0.0, 0.0], [0.0, 4.0]]


def test_the_way_over_land_goes_round_a_lake_out_of_glide_of_the_shore(monkeypatch, sky):
    # A lake 1.6 degrees across (96 nm) across the straight line, a band of
    # land to the north of it: the fastest crosses it, the way over land
    # keeps within a glide of the shore (the owner's ask, 2026-10-25).
    def lake(lats, lons):
        return (np.abs(np.asarray(lons) - 2.0) < 0.8) & (np.asarray(lats) < 1.2)
    monkeypatch.setattr(water, "is_water", lake)
    out = route_options.options(DEP, DEST, PROFILE, fields=NO_FIELDS)
    fastest = next(o for o in out["options"] if "fastest" in o["kinds"])
    land = next(o for o in out["options"] if "land" in o["kinds"])
    assert fastest["water_nm"] > 60
    assert land["water_nm"] < fastest["water_nm"] / 4
    assert land is not fastest and land["air_min"] > fastest["air_min"]


def test_water_that_cannot_be_read_is_said_not_fatal(monkeypatch, sky):
    def down(lats, lons):
        raise water.WaterUnavailable("no shores")
    monkeypatch.setattr(water, "is_water", down)
    out = route_options.options(DEP, DEST, PROFILE, fields=NO_FIELDS)
    assert "water" in out["unchecked"] and out["options"]


def test_out_of_glide_is_the_water_beyond_a_glide_of_land():
    # A strip of water 0.5 degrees wide (30 nm) between land: its middle,
    # 15 nm from either shore, out of a 6 nm glide; its edges in reach.
    flat = water.is_water
    try:
        water.is_water = lambda lats, lons: (np.asarray(lons) > 1.0) & (np.asarray(lons) < 1.5)
        share = water.out_of_glide(0.0, 0.0, 4, 10, 0.25)
    finally:
        water.is_water = flat
    assert share[:, 0].max() == 0.0                      # dry land
    assert share[:, 4].min() > 0.5 and share[:, 5].min() > 0.5    # the strait's middle
    assert share.max() <= 1.0


def test_a_turn_is_made_at_a_fix_nearby_where_one_keeps_the_way(monkeypatch, sky):
    # A storm on the straight line, so the way turns; a GPS waypoint 3 nm
    # off where it turns, away from the storm, is loaded instead of a point of the pilot's own
    # (the owner's "Isn't there a gps fix nearby ... that we can use?").
    sky["tafs"].append(taf("STRM", 0.0, 2.0, wx="TSRA"))
    first = route_options.options(DEP, DEST, PROFILE, fields=NO_FIELDS)
    way = first["options"][0]
    turn = way["path"][1]
    # On the storm's far side of the turn: one nearer it would close the way.
    away = -0.05 if turn[0] < 0 else 0.05
    fix = {"ident": "BUCKY", "lat": turn[0] + away, "lon": turn[1], "kind": "fix"}
    def within(south, west, north, east):
        return [fix] if south <= fix["lat"] <= north and west <= fix["lon"] <= east else []
    monkeypatch.setattr(fixes, "within", within)
    out = route_options.options(DEP, DEST, PROFILE, fields=NO_FIELDS)
    snapped = out["options"][0]
    assert "BUCKY" in snapped["stops"]
    assert [fix["lat"], fix["lon"]] in snapped["path"]
    assert snapped["crosses"] == way["crosses"]


def test_a_fix_that_would_take_the_way_into_the_storm_is_not_turned_at(monkeypatch, sky):
    sky["tafs"].append(taf("STRM", 0.0, 2.0, wx="TSRA"))
    turn = route_options.options(DEP, DEST, PROFILE, fields=NO_FIELDS)["options"][0]["path"][1]
    # Toward the storm's middle, 7 nm: inside its 20 nm.
    toward = 0.12 if turn[0] < 0 else -0.12
    fix = {"ident": "STORM", "lat": turn[0] + toward, "lon": turn[1], "kind": "fix"}

    def within(south, west, north, east):
        return [fix] if south <= fix["lat"] <= north and west <= fix["lon"] <= east else []
    monkeypatch.setattr(fixes, "within", within)
    out = route_options.options(DEP, DEST, PROFILE, fields=NO_FIELDS)
    assert "STORM" not in out["options"][0]["stops"]


def test_a_fuel_stop_in_marginal_weather_gives_way_to_one_in_the_clear(sky):
    # Tanks for some 290 nm on a 600 nm flight: two stops. A field a third
    # of the way is under MVFR; one a little further on is in the clear,
    # and is landed at instead (the owner's "Or even a different fuel stop
    # to avoid weather?", 2026-10-25).
    dest = {"ident": "CCC", "lat": 0.0, "lon": 10.0}
    sky["tafs"].append(taf("WETT", 0.0, 3.0, ceiling=2500))
    table = fields(("WETT", 0.0, 3.0), ("DRYY", 0.0, 3.6), ("MIDD", 0.0, 6.5), ("LATE", 0.0, 7.0))
    small = {**PROFILE, "usable_fuel_gal": 30.0}       # some 290 nm with the reserve
    out = route_options.options(DEP, dest, small, fields=table)
    fastest = next(o for o in out["options"] if "fastest" in o["kinds"])
    assert "WETT" not in fastest["fuel"] and "DRYY" in fastest["fuel"]


def test_a_fuel_stop_whose_way_in_crosses_a_storm_is_not_landed_at(sky):
    dest = {"ident": "CCC", "lat": 0.0, "lon": 10.0}
    # A storm between the way and a field 12 nm off it.
    sky["tafs"].append(taf("STRM", 0.1, 4.0, wx="TSRA"))
    table = fields(("BEHIND", 0.2, 4.0), ("CLEAR", 0.0, 3.0), ("MIDD", 0.0, 6.5))
    out = route_options.options(DEP, dest, PROFILE, fields=table)
    for option in out["options"]:
        assert "BEHIND" not in option["fuel"]


def test_the_fastest_is_the_way_that_is_fastest_whatever_search_found_it(sky):
    # Two ways a search may find, the one called fastest the slower: the
    # name goes to the quicker (KSEA to KSFO's "fastest" was 110 minutes
    # slower than the best weather's, out over the Pacific, 2026-10-25).
    grid = route_options._Grid((0.0, 0.0), (0.0, 4.0))
    slow = {"kind": "fastest", "kinds": ["fastest"], "title": "Fastest", "air_min": 600.0, "ground_min": 0.0,
            "crosses": [], "marginal": [], "landings": 0, "stops": ["A"]}
    quick = {"kind": "weather", "kinds": ["weather"], "title": "Best weather", "air_min": 490.0, "ground_min": 0.0,
             "crosses": [], "marginal": [], "landings": 0, "stops": ["B"]}
    named = route_options._named_by_what_they_are(grid, [slow, quick])
    assert named == [quick]
    assert set(quick["kinds"]) == {"weather", "fastest", "stops"} and quick["kind"] == "weather"


def test_the_cells_near_a_point_are_the_whole_grids_measure_in_its_box():
    # near() measures only the box round the point: the same cells as
    # measuring every one, north and south, wide and narrow, and for a
    # point off the grid's edge.
    rng = np.random.default_rng(7)
    for start, end in [((42.2, -88.0), (39.8, -104.7)), ((25.8, -80.3), (47.5, -122.3)), ((61.2, -150.0), (64.8, -147.9))]:
        grid = route_options._Grid(start, end)
        for _ in range(40):
            lat = rng.uniform(grid.lat0 - 0.5, grid.lat0 + grid.rows * route_options.CELL_DEG + 0.5)
            lon = rng.uniform(grid.lon0 - 0.5, grid.lon0 + grid.cols * route_options.CELL_DEG + 0.5)
            nm = float(rng.choice([route_options.STORM_NM, route_options.FIELD_WX_NM, route_options.MARGINAL_NM]))
            whole = geo.distance_nm(lat, lon, grid.lat_grid, grid.lon_grid) <= nm
            assert (grid.near(lat, lon, nm) == whole).all()


def test_the_most_filed_route_is_flown_over_its_fixes_with_its_fuel_stops_put_in(sky):
    dest = {"ident": "CCC", "lat": 0.0, "lon": 10.0}
    table = fields(*[(f"F{k}", 0.0, float(k)) for k in range(1, 10)])
    # Filed by way of a fix a degree north of the line: the grid reaches it.
    out = route_options.options(DEP, dest, PROFILE, fields=table, filed=([(1.0, 5.0)], ["NORTH"]))
    filed = out["filed"]
    assert (filed["kind"], filed["title"]) == ("filed", "Most Filed")
    assert "NORTH" in filed["stops"] and "NORTH" not in filed["fuel"] and filed["fuel"]
    assert [1.0, 5.0] in filed["path"]
    assert route_options.options(DEP, DEST, PROFILE, fields=NO_FIELDS)["filed"] is None


def test_a_fuel_stop_with_somewhere_to_eat_is_landed_at_among_chains_of_as_many_stops(sky):
    # The owner, 2026-10-27: "try to find a fuel stop that also has food
    # while still maintaining min stops". 600 nm on 528 nm of reach: one
    # stop, and of the fields that would do, the one with a meal.
    dest = {"ident": "CCC", "lat": 0.0, "lon": 10.0}
    table = fields(*[(f"F{k}", 0.0, float(k)) for k in range(1, 10)])
    out = route_options.options(DEP, dest, PROFILE, fields=table, food=lambda ident, lat, lon: ident == "F6")
    own = out["own"]
    assert own["fuel"] == ["F6"] and own["food"] == ["F6"] and own["landings"] == 1
    for option in out["options"]:
        assert option["landings"] == 1 and option["food"] == ["F6"]


def test_a_meal_never_costs_another_landing(sky):
    # Food only at F1, a degree out: landing there leaves 540 nm, past the
    # reach, so a second stop -- the one stop elsewhere is kept, no meal.
    dest = {"ident": "CCC", "lat": 0.0, "lon": 10.0}
    table = fields(*[(f"F{k}", 0.0, float(k)) for k in range(1, 10)])
    out = route_options.options(DEP, dest, PROFILE, fields=table, food=lambda ident, lat, lon: ident == "F1")
    assert out["own"]["landings"] == 1 and out["own"]["fuel"] != ["F1"] and out["own"]["food"] == []
