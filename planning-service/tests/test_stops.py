"""A route that lands on the way (`stops`): each flight between two
landings -- a hop -- planned as a route of its own, and the course, the
checkpoints, the legs and the totals running on through each stop. The
same stubbed world as test_plan: every hop is read off the same two
candidates, flies at the one legal altitude, and each leg is 10 nm."""
import pytest
from fastapi.testclient import TestClient
from vfr import airports, fixes, geo, navlog
from vfr import altitude as altitude_module

from app import planning, scoring
from app.common import load_route
from app.main import app

from .conftest import airport, select_cruise_altitude_stub
from .test_plan import CANDIDATES, _leg

client = TestClient(app)

VIA_MADISON = {"dep": "C81", "dest": "KDLH", "stops": "KMSN"}


@pytest.fixture(autouse=True)
def _stubbed_world(monkeypatch, altitude):
    # Each hop's own points, as two corridors' reads are: ids of their own.
    monkeypatch.setattr(scoring, "score", lambda dep, dest: [{**c, "id": f"{dep}:{c['id']}"} for c in CANDIDATES])
    monkeypatch.setattr(altitude_module, "select_cruise_altitude", select_cruise_altitude_stub(altitude))
    monkeypatch.setattr(navlog, "assemble_leg", _leg)
    # No chart read to start: every hop's candidates are the stub's.
    monkeypatch.setattr(scoring.chart_model, "corridor", lambda route, wait: None)


def _hop_nm(a: str, b: str) -> float:
    pa, pb = airport(a), airport(b)
    return geo.distance_nm(pa["lat"], pa["lon"], pb["lat"], pb["lon"])


def test_the_course_lands_at_each_stop_and_is_as_long_as_its_hops():
    body = client.get("/api/course", params=VIA_MADISON).json()

    assert [s["ident"] for s in body["stops"]] == ["KMSN"]
    assert body["distance_nm"] == pytest.approx(_hop_nm("C81", "KMSN") + _hop_nm("KMSN", "KDLH"), abs=0.1)
    madison = airport("KMSN")
    assert [madison["lat"], madison["lon"]] in body["course_line"]


def test_the_checkpoints_are_each_hops_own_along_the_whole_route():
    body = client.get("/api/checkpoints", params=VIA_MADISON).json()

    first = _hop_nm("C81", "KMSN")
    hops = [c["hop"] for c in body["selected"]]
    assert set(hops) == {0, 1} and hops == sorted(hops)
    # The second hop's run on from the stop.
    assert all(c["along_track_nm"] >= first for c in body["selected"] if c["hop"] == 1)
    assert [c["along_track_nm"] for c in body["selected"]] == sorted(c["along_track_nm"] for c in body["selected"])


def test_the_legs_land_at_the_stop_and_each_hop_has_its_own_fuel_check():
    body = client.get("/api/plan", params=VIA_MADISON).json()

    legs = body["legs"]
    assert [leg["to"] for leg in legs].count("KMSN") == 1
    assert [leg["from"] for leg in legs].count("KMSN") == 1
    assert len(legs) == len(body["selected"]) + 2
    totals = body["totals"]
    assert [(h["departure"], h["destination"]) for h in totals["hops"]] == [("C81", "KMSN"), ("KMSN", "KDLH")]
    # The tanks are filled at the stop: no fuel check over the whole trip.
    assert totals["fuel_required_gal"] is None
    assert all(h["totals"]["fuel_required_gal"] is not None for h in totals["hops"])
    assert totals["fuel_gal"] == pytest.approx(sum(h["totals"]["fuel_gal"] for h in totals["hops"]), abs=0.15)
    # One breakdown for the route, a segment per leg.
    assert len(body["altitude_selection"]["segments"]) == len(legs)


def test_each_flight_climbs_from_its_field_and_comes_down_to_its_own_pattern():
    # The stub's 10 nm legs at 4,500 ft, the fields at 900: the climb
    # tops out on each flight's first leg, and each comes down to 1,900,
    # 2,600 ft at three to one, 7.8 nm out -- on the leg into the field.
    legs = client.get("/api/plan", params=VIA_MADISON).json()["legs"]

    assert [leg["from"] for leg in legs if leg["toc"]] == ["C81", "KMSN"]
    tods = [(leg["to"], leg["tod"]) for leg in legs if leg["tod"]]
    assert [to for to, _ in tods] == ["KMSN", "KDLH"]
    assert all(tod["to_ft"] == 1900.0 and tod["pattern"] and tod["along_nm"] == 2.2 for _, tod in tods)


def test_the_stream_runs_through_the_stop_and_ends_on_the_hops_totals(messages):
    lines = messages(client.get("/api/navlog", params=VIA_MADISON))

    legs = [m for m in lines if m["type"] == "leg"]
    assert legs[0]["from"] == "C81" and legs[-1]["to"] == "KDLH"
    assert any(leg["to"] == "KMSN" for leg in legs)
    assert len(lines[-1]["totals"]["hops"]) == 2


def test_a_hop_with_no_legal_altitude_is_named(monkeypatch, altitude, messages):
    madison = airport("KMSN")
    flyable = select_cruise_altitude_stub(altitude)
    stuck = select_cruise_altitude_stub({**altitude, "recommended_ft": None})

    def select(start, end, profile, **kw):
        north = start == (madison["lat"], madison["lon"])
        return (stuck if north else flyable)(start, end, profile, **kw)

    monkeypatch.setattr(altitude_module, "select_cruise_altitude", select)
    last = messages(client.get("/api/navlog", params=VIA_MADISON))[-1]

    assert last["type"] == "error" and last["retry"] is False
    assert "KMSN to KDLH" in last["detail"] or "out of KMSN toward KDLH" in last["detail"]
    assert client.get("/api/plan", params=VIA_MADISON).status_code == 422


def test_a_route_without_stops_is_planned_as_it_always_was():
    body = client.get("/api/plan", params={"dep": "C81", "dest": "KDLH"}).json()
    assert body["stops"] == []
    assert body["totals"]["hops"] == [] and body["totals"]["fuel_required_gal"] is not None


@pytest.mark.parametrize("stops", ["C81", "KMSN,KMSN"])
def test_a_stop_that_is_the_airport_before_it_is_refused(stops):
    assert client.get("/api/course", params={"dep": "C81", "dest": "KDLH", "stops": stops}).status_code == 422


def test_no_checkpoint_is_kept_just_off_a_stop(monkeypatch):
    # The field is the fix there: a river a few cables past it is no use.
    near = {**CANDIDATES[0], "id": "river@near", "along_track_nm": 0.4, "predicted_score": 4.9}
    monkeypatch.setattr(scoring, "score", lambda dep, dest: [{**c, "id": f"{dep}:{c['id']}"} for c in [near, *CANDIDATES]])
    body = client.get("/api/checkpoints", params=VIA_MADISON).json()
    assert all(not c["id"].endswith("river@near") for c in body["selected"])
    assert all(not c["selected"] for c in body["candidates"] if c["id"].endswith("river@near"))


def test_a_point_beside_a_stop_is_counted_once(monkeypatch):
    # The same place read on both hops: the first hop's.
    monkeypatch.setattr(scoring, "score", lambda dep, dest: [dict(c) for c in CANDIDATES])
    body = client.get("/api/checkpoints", params=VIA_MADISON).json()
    ids = [c["id"] for c in body["candidates"]]
    assert len(ids) == len(set(ids))


def test_a_round_trip_lands_where_it_left():
    r = load_route("C81", "C81", "KMSN")
    assert [(hop.dep_ident, hop.dest_ident) for hop in r.hops] == [("C81", "KMSN"), ("KMSN", "C81")]


def test_too_many_stops_are_refused():
    many = ",".join(["KMSN", "KDLH"] * 5)
    assert client.get("/api/course", params={"dep": "C81", "dest": "KMSN", "stops": many}).status_code == 422


def test_the_joined_breakdown_is_the_most_limiting_of_the_hops():
    a = {"floor_ft": 2000.0, "band_ceiling_ft": 9000.0, "airspace_ceiling_ft": None, "candidates_ft": [4500.0, 6500.0],
         "segments": [{"from_nm": 0.0, "to_nm": 40.0}], "special_use": [], "airspace_transits": [], "hazards": [],
         "weather_unavailable": [], "icing_possible": False, "low_ceiling_or_visibility": False}
    b = {**a, "floor_ft": 5000.0, "band_ceiling_ft": 7000.0, "airspace_ceiling_ft": 8000.0, "candidates_ft": [6500.0],
         "segments": [{"from_nm": 0.0, "to_nm": 60.0}], "icing_possible": None}

    joined = planning.join_selections([a, b], [0.0, 40.0])

    assert joined["floor_ft"] == 5000.0 and joined["band_ceiling_ft"] == 7000.0
    assert joined["airspace_ceiling_ft"] == 8000.0
    assert joined["candidates_ft"] == [6500.0] and joined["recommended_ft"] == 6500.0
    assert [(s["from_nm"], s["to_nm"]) for s in joined["segments"]] == [(0.0, 40.0), (40.0, 100.0)]
    # A hop that could not be checked: unknown, not "no icing".
    assert joined["icing_possible"] is None


VPBNG = {"ident": "VPBNG", "lat": 42.2673, "lon": -88.1311, "kind": "VFR waypoint", "vfr": True, "state": "IL"}


@pytest.fixture
def a_vfr_waypoint(monkeypatch):
    """VPBNG, a VFR waypoint, and no airport by its name."""
    def get_airport(ident, **kw):
        if ident.upper() not in ("C81", "KDLH", "KMSN"):
            raise ValueError(f"Airport identifier {ident.upper()!r} not found")
        return airport(ident.upper())
    monkeypatch.setattr(airports, "get_airport", get_airport)
    monkeypatch.setattr(fixes, "find_fix", lambda ident: VPBNG if ident.upper() == "VPBNG" else None)
    monkeypatch.setattr(fixes, "search_fixes", lambda q, limit=5: [VPBNG] if "VPBNG".startswith(q.upper()) else [])


def test_a_waypoint_is_flown_through_not_landed_at(a_vfr_waypoint):
    params = {"dep": "C81", "dest": "KDLH", "stops": "VPBNG"}
    course = client.get("/api/course", params=params).json()
    assert course["stops"][0] == {**course["stops"][0], "ident": "VPBNG", "kind": "fix", "elevation_ft": None}

    body = client.get("/api/plan", params=params).json()
    legs = body["legs"]
    out_of_it = next(i for i, leg in enumerate(legs) if leg["from"] == "VPBNG")
    # A climb from the field at the start, none out of the waypoint.
    assert legs[0]["climb_min"] > 0 and legs[out_of_it]["climb_min"] == 0
    # One flight, one fuel check: nothing is landed at on the way.
    assert body["totals"]["hops"] == [] and body["totals"]["fuel_required_gal"] is not None


def test_a_waypoint_between_two_landings_is_in_the_one_flights_fuel_check(a_vfr_waypoint):
    body = client.get("/api/plan", params={"dep": "C81", "dest": "KDLH", "stops": "VPBNG,KMSN"}).json()
    assert [(h["departure"], h["destination"]) for h in body["totals"]["hops"]] == [("C81", "KMSN"), ("KMSN", "KDLH")]


def test_neither_an_airport_nor_a_waypoint_is_a_404(a_vfr_waypoint):
    resp = client.get("/api/course", params={"dep": "C81", "dest": "KDLH", "stops": "VPZZZ"})
    assert resp.status_code == 404 and "VPZZZ" in resp.json()["detail"]


def test_a_stops_search_finds_the_waypoints_after_the_airports(a_vfr_waypoint, monkeypatch):
    monkeypatch.setattr(airports, "search_airports", lambda q: [])
    found = client.get("/api/airports/search", params={"q": "VPB", "fixes": True}).json()["airports"]
    assert found == [{"ident": "VPBNG", "name": "VFR waypoint", "municipality": None, "region": "IL", "kind": "fix"}]
    assert client.get("/api/airports/search", params={"q": "VPB"}).json()["airports"] == []
