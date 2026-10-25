"""POST /api/go-no-go through its models, the planner's plan and briefing
stubbed: what the pilot sends -- minimums, the load, the ticks, the
logbook -- is what the findings are worked out with, as the web's
FlightBriefingView feeds lib/verdict."""
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from vfr.aircraft import load_aircraft_profile

from app.main import app
from app.routers import gonogo

client = TestClient(app)
DEPART = datetime(2026, 10, 6, 14, 0, tzinfo=timezone.utc)
PROFILE = {"name": "c172", **load_aircraft_profile("c172")}


def legs() -> list[dict]:
    return [{"from": "C81", "to": "KDLH", "distance_nm": 300.0, "altitude_ft": 5500.0, "ete_min": 150.0}]


def nav(**over) -> dict:
    return {"flown": "lowest", "altitude_ft": 5500.0, "selection": {"special_use": []}, "aircraft": PROFILE, "cautions": [],
            "options": [{"kind": "lowest", "steps": [{"altitude_ft": 5500.0, "to": "KDLH"}]}], **over}


def totals(**over) -> dict:
    return {"ete_min": 150.0, "fuel_gal": 24.0, "fuel_required_gal": 30.2, "fuel_margin_gal": 22.8, "reserve_min": 30.0,
            "night": False, "hops": [], **over}


def runways(length: int = 5000) -> list[dict]:
    return [{"ends": "09/27", "length_ft": length, "surface": "ASP", "closed": False,
             "runway_ends": [{"ident": "09", "heading_true_deg": 90}, {"ident": "27", "heading_true_deg": 270}],
             "wind": {"end": "27", "headwind_kt": 5, "crosswind_kt": 2, "gust_crosswind_kt": None}}]


def briefing(**over) -> dict:
    return {
        "hazards": [], "gairmets": [], "pireps": [], "tfrs": [], "weather_unavailable": [], "vfr_not_recommended": [],
        "metars": {"C81": {"ceiling_ft": None, "visibility_sm": 10, "wind_speed_kt": 6, "wind_gust_kt": None, "temp_c": 15,
                           "altimeter_in_hg": 29.92}, "KDLH": None},
        "forecast": {"min_ceiling_ft": 3500, "min_visibility_sm": 6, "stations": []},
        "airports": {"C81": {"runways": runways()}, "KDLH": {"runways": runways(9000)}},
        **over,
    }


@pytest.fixture
def stubbed(monkeypatch):
    """The route, its plan and its briefing, each replaceable by a test."""
    world = {"planned": gonogo.Planned(nav=nav(), legs=legs(), totals=totals()), "briefing": briefing(), "asked": {}}
    route = SimpleNamespace(idents=["C81", "KDLH"], airports=[{"elevation_ft": 900.0}, {"elevation_ft": 1400.0}])
    monkeypatch.setattr(gonogo, "load_route", lambda dep, dest, stops: route)
    monkeypatch.setattr(gonogo, "plan_for", lambda q, r: world["planned"])

    def brief(q, ete_min):
        world["asked"]["ete_min"] = ete_min
        if isinstance(world["briefing"], Exception):
            raise world["briefing"]
        return world["briefing"]

    monkeypatch.setattr(gonogo, "brief_for", brief)
    return world


def ask(**over) -> dict:
    return {"dep": "C81", "dest": "KDLH", "depart": DEPART.isoformat(), "day": "2026-10-06", **over}


def by_key(body: dict) -> dict:
    return {i["key"]: i for i in body["items"]}


def test_a_quiet_flight_with_the_sample_load_and_a_pilot_is_nothing_found_against_it(stubbed):
    resp = client.post("/api/go-no-go", json=ask())
    assert resp.status_code == 200
    body = resp.json()
    items = by_key(body)
    assert [i["finding"] for i in body["items"]] == ["ok"] * 7
    assert body["line"] == {"finding": "ok", "words": "Nothing found against this flight"}
    assert items["weather"]["detail"] == "No hazards; at worst 3,500 ft · 6 sm"
    assert items["altitude"]["detail"] == "5,500 ft · Lowest plan"
    assert items["fuel"]["detail"] == "Needs 30.2 gal with taxi and a 30 min reserve; 22.8 gal spare"
    assert (items["fuel"]["tab"], items["fuel"]["section"]) == ("preflight", "Fuel")
    # The POH's sample airplane, a pilot of 170 lb and the usable fuel.
    assert body["balance"]["load"]["stations_lb"] == [170, 0, 0, 0]
    assert body["loading"]["stations"][0]["name"]
    assert items["balance"]["detail"].endswith(", within limits")
    assert body["risk"]["line"] == "Low · 0 points"
    assert [c["key"] for c in body["self_checks"]][:2] == ["illness", "medication"]
    # Each check's mark as the web's RiskAssessment draws it.
    marks = {c["key"]: (c["finding"], c["stop"]) for c in body["self_checks"]}
    assert marks["alcohol"] == ("stop", True) and marks["stress"] == ("caution", False)
    # The briefing for the flight's own hours.
    assert stubbed["asked"]["ete_min"] == 150.0


def test_what_the_pilot_sends_decides_the_minimums_the_loading_and_the_risk(stubbed):
    resp = client.post("/api/go-no-go", json=ask(
        minimums={"ceiling_ft": 5000},
        load={"empty_weight_lb": 1642, "empty_arm_in": 38.1, "stations_lb": [170, 400, 120, 50], "fuel_gal": 53},
        ticked=["alcohol"],
    ))
    body = resp.json()
    items = by_key(body)
    assert items["weather"]["finding"] == "stop"
    assert items["weather"]["detail"] == "Under your minimums: Along the route, forecast ceiling 3,500 ft, under your 5,000 ft"
    assert items["balance"]["finding"] == "stop"
    assert "The baggage, 170 lb in all, is over its 120 lb" in body["balance"]["problems"]
    assert body["risk"]["level"] == "high"
    assert body["line"]["words"] == "No-go as planned: Weather, Weight & balance, Risk"


def test_a_tfr_crossed_while_in_force_and_one_passed_before_it_starts(stubbed):
    stubbed["briefing"] = briefing(tfrs=[
        {"notam_id": "6/1111", "crosses": True, "along_track_nm": 150.0, "effective": "2026-10-06T15:00:00Z", "expires": None},
        {"notam_id": "6/2222", "crosses": True, "along_track_nm": 10.0, "effective": "2026-10-06T18:00:00Z", "expires": None},
    ])
    items = by_key(client.post("/api/go-no-go", json=ask()).json())
    # At 150 nm the flight is there at 15:15Z, in the first one's window.
    assert items["airspace"]["finding"] == "stop"
    assert items["airspace"]["detail"] == "TFR 6/1111 in force when you get there"


def test_a_route_with_no_legal_altitude_is_no_go_and_the_rest_waits_as_on_the_web(stubbed):
    stubbed["planned"] = gonogo.Planned(nav=None, legs=[], totals=None, problem="No legal altitude past KDLH")
    body = client.post("/api/go-no-go", json=ask()).json()
    items = by_key(body)
    assert (items["altitude"]["finding"], items["altitude"]["detail"]) == ("stop", "No legal altitude past KDLH")
    assert items["fuel"]["finding"] == "pending"
    assert body["line"]["finding"] == "stop"


def test_a_briefing_that_failed_is_said_as_not_fetched(stubbed):
    from fastapi import HTTPException
    stubbed["briefing"] = HTTPException(502, "aviationweather.gov did not answer")
    body = client.post("/api/go-no-go", json=ask()).json()
    items = by_key(body)
    assert (items["weather"]["finding"], items["weather"]["detail"]) == ("unknown", "Not fetched: aviationweather.gov did not answer")
    assert items["airspace"]["detail"] == "Not checked: see tfr.faa.gov"
    assert body["risk"] is None


def test_under_ifr_the_alternate_speaks_for_the_weather(stubbed, monkeypatch):
    asked = {}

    def alternate(dest, eta, tas, filed):
        asked.update(dest=dest, eta=eta, tas=tas, filed=filed)
        return {"destination": {"required": True}, "alternate": None}

    monkeypatch.setattr(gonogo, "alternate_for", alternate)
    body = client.post("/api/go-no-go", json=ask(rules="ifr")).json()
    weather = by_key(body)["weather"]
    assert weather["detail"] == "An alternate is required (14 CFR 91.169): file one in Weather"
    assert (weather["tab"], weather["section"]) == ("arrive", "Alternate")
    assert asked["dest"] == "KDLH" and asked["eta"] == datetime(2026, 10, 6, 16, 30, tzinfo=timezone.utc)
