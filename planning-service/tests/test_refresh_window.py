"""The planner's own chart refresh keeps to its night-time window --
except on a stack with no complete pyramid at all, which renders at
once -- and the window arithmetic handles one that runs past midnight."""
import time

from vfr import charts

from app import main


def _clock(hhmm: str) -> time.struct_time:
    return time.strptime(f"2026-10-29 {hhmm}", "%Y-%m-%d %H:%M")


def test_refresh_window_arithmetic():
    assert main._in_refresh_window(_clock("02:30"), "01:00-06:00")
    assert not main._in_refresh_window(_clock("14:00"), "01:00-06:00")
    assert not main._in_refresh_window(_clock("06:00"), "01:00-06:00")   # the end is exclusive
    assert main._in_refresh_window(_clock("23:30"), "22:00-05:00")       # past midnight
    assert main._in_refresh_window(_clock("04:59"), "22:00-05:00")
    assert not main._in_refresh_window(_clock("12:00"), "22:00-05:00")
    assert main._in_refresh_window(_clock("12:00"), "")                   # blank: any time


def test_refresh_waits_for_the_window_while_an_older_cycle_serves(monkeypatch):
    started = []
    monkeypatch.setattr(charts, "refresh_due", lambda: True)
    monkeypatch.setattr(charts, "serving_cycle", lambda: "09-03-2026")
    monkeypatch.setattr(charts, "current_cycle", lambda *a, **k: "10-29-2026")
    monkeypatch.setattr(charts, "pyramid_complete", lambda cycle, kinds=None: cycle == "09-03-2026")
    monkeypatch.setattr(charts, "refresh_in_background", lambda **kw: started.append(kw) or True)

    monkeypatch.setattr(main, "_in_refresh_window", lambda *a, **k: False)
    main._refresh_charts_if_due()
    assert started == []

    monkeypatch.setattr(main, "_in_refresh_window", lambda *a, **k: True)
    main._refresh_charts_if_due()
    assert started == [{"workers": main.CHARTS_REFRESH_WORKERS}]


def test_refresh_starts_at_once_when_nothing_complete_is_on_disk(monkeypatch):
    started = []
    monkeypatch.setattr(charts, "refresh_due", lambda: True)
    monkeypatch.setattr(charts, "serving_cycle", lambda: "10-29-2026")
    monkeypatch.setattr(charts, "current_cycle", lambda *a, **k: "10-29-2026")
    monkeypatch.setattr(charts, "pyramid_complete", lambda cycle, kinds=None: False)
    monkeypatch.setattr(charts, "refresh_in_background", lambda **kw: started.append(kw) or True)
    monkeypatch.setattr(main, "_in_refresh_window", lambda *a, **k: False)
    main._refresh_charts_if_due()
    assert len(started) == 1


def test_nothing_starts_when_the_cycle_is_complete(monkeypatch):
    monkeypatch.setattr(charts, "refresh_due", lambda: False)
    monkeypatch.setattr(charts, "refresh_in_background", lambda **kw: (_ for _ in ()).throw(AssertionError("started")))
    main._refresh_charts_if_due()
