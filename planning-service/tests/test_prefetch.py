"""A route's slow parts -- the chart's read, the ground under it -- started
as its course is asked for (app.prefetch), once a route, off the request."""
from fastapi.testclient import TestClient

from app import prefetch
from app.main import app

client = TestClient(app)
# The real one: the shared fixtures put a still one in its place.
start_reads = prefetch.route


def test_the_course_starts_the_route_reads(monkeypatch):
    asked = []
    monkeypatch.setattr(prefetch, "route", lambda dep, dest, stops="": asked.append((dep, dest, stops)))
    assert client.get("/api/course", params={"dep": "C81", "dest": "KDLH"}).status_code == 200
    assert asked == [("C81", "KDLH", "")]


def test_a_route_is_read_ahead_once_a_while_however_often_its_course_is_asked(monkeypatch):
    queued = []
    monkeypatch.setattr(prefetch, "_STARTED", type(prefetch._STARTED)(maxsize=8, ttl=600))
    monkeypatch.setattr(prefetch._POOL, "submit", lambda fn, *args: queued.append(args))
    start_reads("C81", "KDLH")
    start_reads("c81", "kdlh")
    start_reads("C81", "KMSN")
    assert queued == [("C81", "KDLH", ""), ("C81", "KMSN", "")]


def test_the_reads_ahead_are_each_hops_chart_and_ground(monkeypatch):
    charts, grounds = [], []
    monkeypatch.setattr(prefetch.chart_model, "corridor", lambda route, wait: charts.append((route, wait)))
    monkeypatch.setattr(prefetch.terrain, "floor_profile", lambda start, end, breaks: grounds.append(breaks[0]))
    prefetch._read("C81", "KDLH", "KMSN")
    assert charts == [("C81->KMSN", False), ("KMSN->KDLH", False)]
    assert grounds == [0.0, 0.0]


def test_a_route_that_does_not_load_reads_nothing(monkeypatch):
    def unknown(*args):
        raise ValueError("no such airport")
    monkeypatch.setattr(prefetch, "load_route", unknown)
    monkeypatch.setattr(prefetch.chart_model, "corridor", lambda route, wait: (_ for _ in ()).throw(AssertionError))
    prefetch._read("ZZZZ", "KDLH", "")


def test_a_hop_across_the_country_is_not_read_ahead(monkeypatch):
    charts = []
    monkeypatch.setattr(prefetch.chart_model, "corridor", lambda route, wait: charts.append(route))
    monkeypatch.setattr(prefetch.terrain, "floor_profile", lambda start, end, breaks: None)
    monkeypatch.setattr(prefetch, "MAX_HOP_NM", 100)
    prefetch._read("C81", "KDLH", "KMSN")  # 82 nm, then 255 nm
    assert charts == ["C81->KMSN"]
