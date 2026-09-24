"""app.chart_refresh: the planner's own chart refresh keeps to its
night-time window -- except on a stack with no complete pyramid at all,
which renders at once -- the window arithmetic handles one that runs
past midnight, and a request from the Dev console starts at once."""
import time

from vfr import charts

from app import chart_refresh


def _clock(hhmm: str) -> time.struct_time:
    return time.strptime(f"2026-10-29 {hhmm}", "%Y-%m-%d %H:%M")


def test_refresh_window_arithmetic():
    assert chart_refresh.in_window(_clock("02:30"), "01:00-06:00")
    assert not chart_refresh.in_window(_clock("14:00"), "01:00-06:00")
    assert not chart_refresh.in_window(_clock("06:00"), "01:00-06:00")   # the end is exclusive
    assert chart_refresh.in_window(_clock("23:30"), "22:00-05:00")       # past midnight
    assert chart_refresh.in_window(_clock("04:59"), "22:00-05:00")
    assert not chart_refresh.in_window(_clock("12:00"), "22:00-05:00")
    assert chart_refresh.in_window(_clock("12:00"), "")                   # blank: any time


def test_refresh_waits_for_the_window_while_an_older_cycle_serves(monkeypatch):
    started = []
    monkeypatch.setattr(charts, "refresh_due", lambda: True)
    monkeypatch.setattr(charts, "serving_cycle", lambda: "09-03-2026")
    monkeypatch.setattr(charts, "current_cycle", lambda *a, **k: "10-29-2026")
    monkeypatch.setattr(charts, "pyramid_complete", lambda cycle, kinds=None: cycle == "09-03-2026")
    monkeypatch.setattr(charts, "refresh_in_background", lambda **kw: started.append(kw) or True)

    monkeypatch.setattr(chart_refresh, "in_window", lambda *a, **k: False)
    chart_refresh.maybe_refresh()
    assert started == []

    monkeypatch.setattr(chart_refresh, "in_window", lambda *a, **k: True)
    chart_refresh.maybe_refresh()
    assert started == [{"workers": chart_refresh.CHARTS_REFRESH_WORKERS}]


def test_refresh_starts_at_once_when_nothing_complete_is_on_disk(monkeypatch):
    started = []
    monkeypatch.setattr(charts, "refresh_due", lambda: True)
    monkeypatch.setattr(charts, "serving_cycle", lambda: "10-29-2026")
    monkeypatch.setattr(charts, "current_cycle", lambda *a, **k: "10-29-2026")
    monkeypatch.setattr(charts, "pyramid_complete", lambda cycle, kinds=None: False)
    monkeypatch.setattr(charts, "refresh_in_background", lambda **kw: started.append(kw) or True)
    monkeypatch.setattr(chart_refresh, "in_window", lambda *a, **k: False)
    chart_refresh.maybe_refresh()
    assert len(started) == 1


def test_nothing_starts_when_the_cycle_is_complete(monkeypatch):
    monkeypatch.setattr(charts, "refresh_due", lambda: False)
    monkeypatch.setattr(charts, "refresh_in_background", lambda **kw: (_ for _ in ()).throw(AssertionError("started")))
    chart_refresh.maybe_refresh()


def test_a_request_starts_at_once_with_more_workers(monkeypatch):
    started = []
    monkeypatch.setattr(charts, "refresh_in_background", lambda **kw: started.append(kw) or True)
    monkeypatch.setattr(chart_refresh, "in_window", lambda *a, **k: False)
    assert chart_refresh.refresh_now() is True
    assert started == [{"workers": chart_refresh.ON_REQUEST_WORKERS}]


def test_a_served_cycle_whose_sectional_is_whole_waits_for_the_window(monkeypatch):
    """What serving_cycle serves is decided by the sectional; the check
    that let a refresh wait asked every kind, so one TAC short started a
    render in the middle of the day."""
    started = []
    monkeypatch.setattr(charts, "refresh_due", lambda: True)
    monkeypatch.setattr(charts, "serving_cycle", lambda: "09-03-2026")
    monkeypatch.setattr(charts, "current_cycle", lambda *a, **k: "10-29-2026")
    monkeypatch.setattr(charts, "pyramid_complete", lambda cycle, kinds=None: kinds == ("sec",))
    monkeypatch.setattr(charts, "refresh_in_background", lambda **kw: started.append(kw) or True)
    monkeypatch.setattr(chart_refresh, "in_window", lambda *a, **k: False)

    chart_refresh.maybe_refresh()

    assert started == []
