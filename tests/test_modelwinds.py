"""The GFS's winds aloft, the planner's since the FB ended (NWS Service
Change Notice 26-47): each forecast hour used only in its own window,
and a plan never waiting on NOMADS while a valid copy is held."""
from datetime import datetime, timedelta, timezone

import pytest

from wingtip import modelwinds, weather


@pytest.fixture(autouse=True)
def _nothing_held(monkeypatch):
    monkeypatch.setattr(modelwinds, "_HELD", {})
    monkeypatch.setattr(modelwinds, "_FAILED", {})
    monkeypatch.setattr(modelwinds, "_NOT_UP", {})


RUN = datetime(2026, 11, 7, 12, tzinfo=timezone.utc)


def test_each_period_has_tbl_9_3_1s_window_round_its_forecast_hour():
    # FAA Order JO 7110.10 TBL 9-3-1: the 6-hour FB valid 1800Z was for use
    # 1400-2100Z, the 12-hour valid 0000Z 2100-0600Z, the 24-hour valid
    # 1200Z 0600-1800Z.
    assert modelwinds.period_of(RUN, 6, "06") == {
        "valid_at": "2026-11-07T18:00:00Z", "use_from": "2026-11-07T14:00:00Z", "use_to": "2026-11-07T21:00:00Z",
        "run": "2026-11-07T12:00:00Z", "forecast_hour": 6,
    }
    twelve = modelwinds.period_of(RUN, 12, "12")
    assert (twelve["use_from"], twelve["use_to"]) == ("2026-11-07T21:00:00Z", "2026-11-08T06:00:00Z")
    day = modelwinds.period_of(RUN, 24, "24")
    assert (day["use_from"], day["use_to"]) == ("2026-11-08T06:00:00Z", "2026-11-08T18:00:00Z")


def test_the_periods_windows_run_on_from_one_another_from_the_current_hour():
    # Valid times placed so 06 ends where 12 starts, and 12 where 24 does.
    ends = {hr: hours + after for hr, (hours, _, after) in modelwinds._PERIODS.items()}
    starts = {hr: hours - before for hr, (hours, before, _) in modelwinds._PERIODS.items()}
    assert starts["06"] <= 0 < ends["06"] == starts["12"] and ends["12"] == starts["24"]
    # weather.forecast_hour's rule by hours ahead ends where they do.
    assert [weather.forecast_hour(h) for h in (None, 6, 6.5, 15, 15.5)] == ["06", "06", "12", "12", "24"]


def test_forecast_hours_are_hourly_to_120_then_three_hourly():
    # NOMADS gfs.YYYYMMDD/HH/atmos: f000-f120 every hour, f123 on every third.
    run = RUN.replace(hour=0)
    at = lambda h: run + timedelta(hours=h)  # noqa: E731
    assert modelwinds.forecast_step(run, at(7)) == 7
    assert modelwinds.forecast_step(run, at(120)) == 120
    assert modelwinds.forecast_step(run, at(121)) == 120
    assert modelwinds.forecast_step(run, at(125)) == 126


def _copy(period: dict):
    out = weather.FdStations({"DLH": {9000: {"wind_dir_true_deg": 270, "wind_speed_kt": 30, "temp_c": -8}}})
    out.period, out.modelled = period, True
    return out


def test_a_copy_inside_its_window_is_served_without_waiting_and_read_again_behind(monkeypatch):
    period = modelwinds.period_of(RUN, 6, "06")   # for use 1400-2100Z
    copy = _copy(period)
    t = datetime(2026, 11, 7, 16, 30, tzinfo=timezone.utc).timestamp()
    modelwinds._HELD["06"] = (t - 2 * 3600, copy)
    behind = []
    monkeypatch.setattr(modelwinds, "_read_behind", behind.append)
    monkeypatch.setattr(modelwinds, "_fetch", lambda *a: pytest.fail("a plan waited on NOMADS"))
    monkeypatch.setattr(modelwinds.time, "time", lambda: t)
    assert modelwinds.stations("06") is copy
    assert behind == ["06"]


def test_a_forecast_hour_is_never_served_past_its_window(monkeypatch):
    copy = _copy(modelwinds.period_of(RUN, 6, "06"))   # for use to 2100Z
    t = datetime(2026, 11, 7, 21, 0, tzinfo=timezone.utc).timestamp()
    modelwinds._HELD["06"] = (t - 600, copy)

    def down(*a):
        raise modelwinds.ModelWindsUnavailable("NOMADS answered 503")

    monkeypatch.setattr(modelwinds, "_fetch", down)
    monkeypatch.setattr(modelwinds.time, "time", lambda: t)
    with pytest.raises(modelwinds.ModelWindsUnavailable):
        modelwinds.stations("06")
    # The failure is the answer for a minute, not a download per lookup.
    monkeypatch.setattr(modelwinds, "_fetch", lambda *a: pytest.fail("asked NOMADS again within the minute"))
    with pytest.raises(modelwinds.ModelWindsUnavailable):
        modelwinds.stations("06")


def test_warm_reads_every_period_and_leaves_a_fresh_one(monkeypatch):
    read = []
    monkeypatch.setattr(modelwinds, "_read", lambda hr, force: read.append(hr))
    modelwinds.warm(force=True)
    assert read == ["06", "12", "24"]
    read.clear()
    now = modelwinds.time.time()
    modelwinds._HELD["06"] = (now, _copy(modelwinds.period_of(RUN, 6, "06")))
    modelwinds.warm()
    assert read == ["12", "24"]
