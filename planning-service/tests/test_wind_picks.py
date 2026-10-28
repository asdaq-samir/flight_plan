"""The nav log's first plan flies the runways into the wind the page picks
a moment later (app.routers.plan wind_picks): a field within the hour by
its own report, the pilot's picks kept, the rest left for the page."""
from datetime import datetime, timezone
from types import SimpleNamespace

from app import planning
from app.routers import plan as plan_router

NOW = datetime(2026, 10, 28, 18, 0, tzinfo=timezone.utc)


def _flight(dep, dest, lands=True):
    return SimpleNamespace(idents=[dep, dest], dep_ident=dep, dest_ident=dest, takes_off=True, lands=lands,
                           dep_airport={"ident": dep, "lat": 1.0, "lon": 2.0}, dest_airport={"ident": dest, "lat": 3.0, "lon": 4.0})


def _stubbed(monkeypatch, favoured):
    monkeypatch.setattr(planning, "now", lambda: NOW)
    monkeypatch.setattr(plan_router.weather, "metar_for_idents", lambda idents: {i: {"wind_speed_kt": 10} for i in idents if i in favoured})
    monkeypatch.setattr(plan_router.airports, "get_runways", lambda ident: [ident])
    monkeypatch.setattr(plan_router.runway_wind, "with_winds", lambda runways, metar, lat, lon: runways)
    monkeypatch.setattr(plan_router.pattern, "with_traffic", lambda ways, ident, lat, lon: ways)
    monkeypatch.setattr(plan_router.runway_wind, "runway_in_use", lambda ways: favoured.get(ways[0]))


def test_each_field_within_the_hour_by_its_report_the_pilots_own_kept(monkeypatch):
    _stubbed(monkeypatch, {"KOSH": "18", "KGRB": "36"})
    r = SimpleNamespace(flights=[_flight("KOSH", "KGRB")])
    outcome = SimpleNamespace(hop_legs=[[{"ete_min": 20.8}]])
    q = plan_router.PlanQuery(dep="KOSH", dest="KGRB", wind_runways=True)
    assert plan_router.wind_picks(r, outcome, q) == ({"OSH": "18"}, {"GRB": "36"})
    # The pilot's own runway stands.
    q = plan_router.PlanQuery(dep="KOSH", dest="KGRB", wind_runways=True, patterns="KGRB:6")
    assert plan_router.wind_picks(r, outcome, q) == ({"OSH": "18"}, {"GRB": "6"})
    # Not asked for: the picks as sent.
    q = plan_router.PlanQuery(dep="KOSH", dest="KGRB")
    assert plan_router.wind_picks(r, outcome, q) == ({}, {})


def test_a_field_reached_after_the_hour_or_with_no_report_is_the_pages(monkeypatch):
    _stubbed(monkeypatch, {"KMSN": "18", "KDSM": "31"})
    # 61 minutes to Des Moines: its TAF's wind is the page's to go by.
    r = SimpleNamespace(flights=[_flight("KMSN", "KDSM")])
    q = plan_router.PlanQuery(dep="KMSN", dest="KDSM", wind_runways=True)
    assert plan_router.wind_picks(r, SimpleNamespace(hop_legs=[[{"ete_min": 61}]]), q) == ({"MSN": "18"}, {})
    # A departure two hours off: none, the forecast's.
    q = plan_router.PlanQuery(dep="KMSN", dest="KDSM", wind_runways=True, depart=datetime(2026, 10, 28, 20, 0, tzinfo=timezone.utc))
    assert plan_router.wind_picks(r, SimpleNamespace(hop_legs=[[{"ete_min": 30}]]), q) == ({}, {})
    # C81 reports nothing: the page goes by a nearby report's.
    r = SimpleNamespace(flights=[_flight("C81", "KMSN")])
    q = plan_router.PlanQuery(dep="C81", dest="KMSN", wind_runways=True)
    assert plan_router.wind_picks(r, SimpleNamespace(hop_legs=[[{"ete_min": 40}]]), q) == ({}, {"MSN": "18"})
