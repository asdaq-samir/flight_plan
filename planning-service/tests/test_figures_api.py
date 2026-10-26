"""The four figures' endpoints through their models, the planner's airport
data and air stubbed: POST /api/debrief, GET /api/diversion, GET
/api/holding and POST /api/lost-comms."""
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.main import app
from app.routers import figures

from .test_figures_debrief import CHECKPOINTS, flown

client = TestClient(app)


def _places(monkeypatch, elevation=700.0):
    places = {"B": {"ident": "B", "name": "Bee Field", "lat": 43.0, "lon": -88.0, "elevation_ft": elevation},
              "KMSN": {"ident": "KMSN", "name": "Dane County Regional", "lat": 43.14, "lon": -89.34, "elevation_ft": 887.0}}
    monkeypatch.setattr(figures, "airports", SimpleNamespace(find_place=lambda ident: places.get(ident.upper())))
    monkeypatch.setattr(figures, "pattern", SimpleNamespace(
        pattern_at=lambda ident, elevation_ft: {"altitude_ft": None if elevation_ft is None else round(elevation_ft + 1000)}))


def test_the_debrief_grades_the_track_with_the_fields_pattern_altitudes(monkeypatch):
    _places(monkeypatch)
    answer = client.post("/api/debrief", json={"checkpoints": CHECKPOINTS, "points": flown()})
    assert answer.status_code == 200, answer.text
    body = answer.json()
    d = body["debrief"]
    assert body["tolerances"] == {"altitude_ft": 200, "course_deg": 15, "off_route_nm": 3, "eta_min": 5,
                                  "pattern_nm": 1.5, "pattern_ft": 100}
    assert [leg["from"] for leg in d["legs"]] == ["A", "Lake"]
    assert [leg["ok"] for leg in d["legs"]] == [True, False]
    assert d["passes"][0]["due_min"] == 18
    # B's pattern from the planner's own data, 700 + 1,000; A was not found.
    assert [p["pattern_ft"] for p in d["patterns"]] == [1700]


def test_a_track_that_never_flew_has_no_debrief(monkeypatch):
    _places(monkeypatch)
    answer = client.post("/api/debrief", json={"checkpoints": CHECKPOINTS, "points": flown()[:20]})
    assert answer.status_code == 200
    assert answer.json()["debrief"] is None


def test_the_diversion_in_the_planners_air_with_the_estimates_checked(monkeypatch):
    _places(monkeypatch)
    asked = {}

    def leg(start, end, altitude_ft, profile, fcst_hr):
        asked.update(start=start, end=end, altitude_ft=altitude_ft, tas=profile["cruise_tas_kt"])
        return {"true_course_deg": 360.0, "distance_nm": 18.0, "tas_kt": 110.0, "fuel_burn_gph": 8.5,
                "magnetic_variation_deg": -3.0, "wind": {"wind_dir_true_deg": 270.0, "wind_speed_kt": 20.0}}

    monkeypatch.setattr(figures, "navlog", SimpleNamespace(assemble_leg=leg))
    answer = client.get("/api/diversion", params={"lat": 43, "lon": -89, "to": "kmsn", "altitude_ft": 4500, "cruise_tas_kt": 110,
                                                  "mh": 355, "gs": 95, "fuel": 1.4})
    assert answer.status_code == 200, answer.text
    d = answer.json()
    assert asked == {"start": (43.0, -89.0), "end": (43.14, -89.34), "altitude_ft": 4500.0, "tas": 110.0}
    assert d["to"] == "KMSN" and d["problem"] is None
    assert round(d["solved"]["mh"], 1) == 352.5
    assert [s["name"] for s in d["steps"]][:2] == ["True course", "Wind correction"]
    assert d["steps"][0]["value"] == "360°, 18.0 nm"
    assert d["steps"][1]["value"] == "−10°"
    checks = {c["key"]: c for c in d["checks"]}
    assert checks["mh"]["reasonable"] is True and checks["mh"]["written"] == "353°"
    # 108 kt over the ground: 95 is more than 10 off.
    assert checks["gs"]["reasonable"] is False
    assert checks["ete"]["reasonable"] is None and checks["ete"]["written"] == "10 min"
    assert checks["fuel"]["reasonable"] is True


def test_a_diversion_no_heading_holds_says_so(monkeypatch):
    _places(monkeypatch)
    monkeypatch.setattr(figures, "navlog", SimpleNamespace(assemble_leg=lambda *a: {
        "true_course_deg": 360.0, "distance_nm": 18.0, "tas_kt": 50.0, "fuel_burn_gph": 5.0, "magnetic_variation_deg": 0.0,
        "wind": {"wind_dir_true_deg": 270.0, "wind_speed_kt": 60.0}}))
    d = client.get("/api/diversion", params={"lat": 43, "lon": -89, "to": "KMSN", "altitude_ft": 4500}).json()
    assert d["solved"] is None and d["steps"] == []
    assert d["problem"] == "The wind is too strong for a heading to KMSN to hold."
    assert client.get("/api/diversion", params={"lat": 43, "lon": -89, "to": "ZZZZ", "altitude_ft": 4500}).status_code == 404


def test_the_holding_entry_and_its_wind():
    d = client.get("/api/holding", params={"inbound": 360, "heading": 220, "turns": "right", "tas_kt": 100,
                                           "wind_from": 360, "wind_kt": 20, "altitude_ft": 5000}).json()
    assert d["entry"] == "parallel" and d["entry_name"] == "Parallel" and d["either"] is None
    assert d["steps"].startswith("At the fix, turn to 180°, parallel to the holding course on the non-holding side, for one minute")
    assert d["approach_relative"] == 40
    assert round(d["wind"]["outbound_sec"]) == 40
    assert d["wind"]["time_words"] == "So the inbound leg takes a minute at 80 kt; by the rule of a second a knot, 40 s"
    near = client.get("/api/holding", params={"inbound": 360, "heading": 112}).json()
    assert near["entry"] == "teardrop" and near["either_name"] == "Direct" and near["wind"] is None and near["wind_problem"] is None
    strong = client.get("/api/holding", params={"inbound": 360, "heading": 0, "tas_kt": 50, "wind_from": 90, "wind_kt": 60,
                                                "altitude_ft": 5000}).json()
    assert strong["wind"] is None and strong["wind_problem"] == "A wind stronger than the airplane holds no heading."


def test_lost_comms_altitudes_and_leaving_the_limit():
    d = client.post("/api/lost-comms", json={
        "segments": [{"name": "Departure to SWEDE", "minimum_ft": 2600}, {"name": "SWEDE to RAYMO", "minimum_ft": 5000}, {"name": ""}],
        "assigned_ft": 4000, "expected_ft": 6000, "expected_from": 1, "approach_fix": False, "efc": "", "eta": " 1435Z ",
    }).json()
    assert [s["words"] for s in d["segments"]] == ["Fly 4,000 ft: assigned", "Fly 6,000 ft: expected", "Fly 6,000 ft: expected"]
    assert d["segments"][2]["name"] == "Segment"
    assert d["leave"].endswith("estimated time of arrival, 1435Z.")
    assert [r["key"] for r in d["routes"]] == ["assigned", "vectored", "expected", "filed"]
    assert d["vfr"].startswith("In VFR conditions")
