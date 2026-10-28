"""Where and when the flight meets each hazard (app.exposure): the legs,
the times from the nav log's ETAs, and the hazard's valid window against
them, on both sides of its edges."""
from datetime import datetime, timezone

import pytest
from shapely.geometry import box

from app import exposure

#: 2026-10-04T14:00:00Z.
T0 = datetime(2026, 10, 4, 14, 0, tzinfo=timezone.utc).timestamp()
#: Two legs due north, each a degree of latitude (60 nm), 30 minutes each.
FIXES = [(42.0, -88.0), (43.0, -88.0), (44.0, -88.0)]


def legs(ground=None):
    return exposure.Legs.of(FIXES, T0, 3600, [30.0, 30.0], ground)


def area(south, north, west=-88.5, east=-87.5):
    return box(west, south, east, north)


def at(minutes):
    return T0 + minutes * 60


def test_a_hazard_on_one_leg_says_that_leg_and_when_the_airplane_is_in_it():
    place = exposure.over_area(legs(), area(42.4, 42.6), source="SIGMET")
    assert place["legs"] == [0]
    assert place["from_nm"] == pytest.approx(24.0, abs=0.3) and place["to_nm"] == pytest.approx(36.0, abs=0.3)
    assert (place["enter"], place["leave"]) == ("2026-10-04T14:12:00Z", "2026-10-04T14:18:00Z")


def test_a_hazard_over_both_legs_says_both_and_the_whole_stretch():
    place = exposure.over_area(legs(), area(42.5, 43.5), source="SIGMET")
    assert place["legs"] == [0, 1]
    assert (place["enter"], place["leave"]) == ("2026-10-04T14:15:00Z", "2026-10-04T14:45:00Z")


def test_the_time_on_the_ground_at_a_stop_puts_the_next_leg_later():
    """A stop of 20 minutes after the first leg: 27 nm into the second
    leg is reached at 30 + 20 + 13.5 minutes, not 43.5."""
    place = exposure.over_area(legs([20.0, 0.0]), area(43.45, 43.55), source="SIGMET")
    assert place["legs"] == [1]
    assert place["enter"] == "2026-10-04T15:03:30Z"


def test_without_the_nav_log_the_flight_time_is_shared_by_distance():
    """The route as entered, 120 minutes over 120 nm: a minute a mile."""
    plain = exposure.Legs.of(FIXES, T0, 7200)
    assert not plain.from_navlog
    assert plain.time_at(90.0) == pytest.approx(at(90), abs=60)
    # Leg minutes that do not match the legs are not taken.
    assert not exposure.Legs.of(FIXES, T0, 7200, [30.0]).from_navlog


def test_a_hazard_the_nav_logs_line_misses_is_placed_at_its_nearest_point():
    """The route as entered crosses it, the checkpoints' line passes by:
    it is still said, on the leg that comes nearest."""
    place = exposure.over_area(legs(), area(43.2, 43.4, west=-87.9, east=-87.6), source="SIGMET")
    assert place["legs"] == [1]
    assert place["from_nm"] == place["to_nm"] and 71.0 <= place["from_nm"] <= 85.0


def test_a_hazard_the_route_misses_has_no_legs():
    assert exposure._span(legs(), area(42.4, 42.6, west=-80.0, east=-79.0)) is None
    # And with no area at all and nothing to go by, no place.
    assert exposure.over_area(legs(), None, source="SIGMET") is None


@pytest.mark.parametrize(("enter_min", "when"), [(29, "during"), (31, "after")])
def test_a_sigmet_that_ends_before_the_airplane_gets_there_is_after_it(enter_min, when):
    """Valid to 14:00 (T0), half an hour's margin for an estimate: 29
    minutes past is still during it, 31 minutes past is after."""
    assert exposure.window_when(at(enter_min), at(enter_min + 5), at(-120), T0) == when


@pytest.mark.parametrize(("leave_min", "when"), [(29, "before"), (31, "during")])
def test_a_sigmet_that_starts_after_the_airplane_has_left_is_before_it(leave_min, when):
    """Valid from 15:00: an airplane out of it by 14:29 is before it, one
    still in it at 14:31 within the half hour's margin is not."""
    assert exposure.window_when(at(leave_min - 10), at(leave_min), at(60), None) == when


def test_a_hazard_with_no_valid_times_has_no_when():
    assert exposure.window_when(T0, T0, None, None) is None


def test_a_sigmet_is_told_with_its_place_source_and_times():
    hazard = {"hazard": "CONVECTIVE", "type": "SIGMET", "raw": "CONVECTIVE SIGMET 45C", "issued": "2026-10-04T13:55:00Z",
              "valid_from": at(-5), "valid_to": at(10), "coords": [(42.4, -88.5), (42.4, -87.5), (42.6, -87.5), (42.6, -88.5)]}
    told = exposure.sigmets(legs(), [hazard])[0]
    assert "coords" not in told and "valid_from" not in told
    on = told["on_route"]
    assert on["source"] == "Convective SIGMET" and on["issued"] == "2026-10-04T13:55:00Z"
    assert (on["valid_from"], on["valid_to"]) == ("2026-10-04T13:55:00Z", "2026-10-04T14:10:00Z")
    # In it 14:12-14:18, two minutes after it ends: within the margin.
    assert on["when"] == "during"


def test_each_g_airmet_is_the_snapshot_nearest_when_the_airplane_is_in_it():
    """Icing at 12Z, 15Z and 18Z over the second leg, flown 14:30-15:00:
    the 15Z snapshot, not the 12Z one nearest the departure."""
    square = [(43.2, -88.5), (43.2, -87.5), (43.8, -87.5), (43.8, -88.5)]
    snaps = [{"hazard": "Icing", "valid_at": f"2026-10-04T{h}:00:00Z", "valid": at((int(h) - 14) * 60), "coords": square}
             for h in ("12", "15", "18")]
    told = exposure.gairmets(legs(), snaps, ["Icing"])
    assert [g["valid_at"] for g in told] == ["2026-10-04T15:00:00Z"]
    on = told[0]["on_route"]
    # A snapshot stands for up to three hours either side of it (AIM 7-1-6).
    assert (on["valid_from"], on["valid_to"], on["when"]) == ("2026-10-04T12:00:00Z", "2026-10-04T18:00:00Z", "during")
    assert on["legs"] == [1] and "coords" not in told[0]


def test_a_tfr_beside_the_route_is_placed_where_the_route_comes_nearest():
    ring = [[-87.95, 42.95], [-87.9, 42.95], [-87.9, 43.05], [-87.95, 43.05], [-87.95, 42.95]]
    beside = {"type": "MultiPolygon", "coordinates": [[ring]]}
    found = [{"notam_id": "6/1234", "geometry": beside, "effective": "2026-10-04T18:00:00Z", "expires": None, "along_track_nm": 60.0}]
    on = exposure.tfrs(legs(), found)[0]["on_route"]
    assert on["source"] == "TFR" and on["when"] == "before"
    assert on["from_nm"] == pytest.approx(60.0, abs=3.0)


def test_a_tfr_with_no_shape_is_placed_by_its_distance_along():
    on = exposure.tfrs(legs(), [{"notam_id": "6/1", "geometry": {"type": "MultiPolygon"}, "along_track_nm": 90.0}])[0]["on_route"]
    assert on["legs"] == [1] and on["enter"].startswith("2026-10-04T14:4") and on["when"] is None
    assert abs(exposure._unix(on["enter"]) - at(45)) < 10


def test_a_pilot_report_is_abeam_where_it_was_made_with_when_it_was_made():
    on = exposure.pireps(legs(), [{"lat": 43.5, "lon": -88.2, "observed_at": "2026-10-04T13:40:00Z", "along_track_nm": 0.0}])[0]["on_route"]
    assert on["legs"] == [1] and on["enter"] == "2026-10-04T14:45:00Z"
    assert on["issued"] == "2026-10-04T13:40:00Z" and on["when"] is None


def test_the_fields_below_vfr_are_met_where_the_flight_is_there():
    """The destination reporting IFR is met at the end of the last leg; a
    TAF station forecast under 1,000 ft for then on the way, abeam; one
    forecast VFR then is not said."""
    from vfr.weather import below_vfr_minimums

    metars = {"KAAA": {"flight_category": "VFR"}, "KCCC": {"flight_category": "IFR", "ceiling_ft": 700.0, "visibility_sm": 2.0,
                                                          "observed_at": "2026-10-04T13:53:00Z"}}
    stations = [{"icaoId": "KBBB", "lat": 42.5, "lon": -88.0, "eta_ceiling_ft": 800.0, "eta_visibility_sm": 6.0},
                {"icaoId": "KDDD", "lat": 43.5, "lon": -88.0, "eta_ceiling_ft": 4000.0, "eta_visibility_sm": 6.0}]
    where = {"KAAA": FIXES[0], "KCCC": FIXES[-1]}
    found = exposure.fields_below_vfr(legs(), ["KAAA", "KCCC"], "KCCC", where, metars, stations, below_vfr_minimums)
    assert [(f["ident"], f["source"], f["on_route"]["legs"]) for f in found] == [("KBBB", "TAF", [0]), ("KCCC", "METAR", [1])]
    assert found[1]["on_route"]["enter"] == "2026-10-04T15:00:00Z" and found[1]["on_route"]["issued"] == "2026-10-04T13:53:00Z"


def test_the_maps_layers_say_when_their_data_was_fetched(monkeypatch):
    from fastapi.testclient import TestClient
    from vfr import tfr, weather

    from app.main import app

    monkeypatch.setattr(weather, "dataset_status", lambda: {"metars": T0, "tafs": None})
    monkeypatch.setattr(tfr, "fetched_at", lambda: None)
    assert TestClient(app).get("/api/map/ages").json() == {"metars_at": "2026-10-04T14:00:00Z", "tfrs_at": None}


def test_the_briefing_places_its_hazards_on_the_nav_logs_legs(monkeypatch):
    """Sent the nav log's fixes and minutes, the briefing's legs are those
    -- its leg numbers the nav log's rows' -- and a TFR on the second leg
    says so, with when the airplane is there against its NOTAM's times."""
    from fastapi.testclient import TestClient
    from vfr import airports, tfr, weather

    from app.main import app

    monkeypatch.setattr(weather, "hazards_along_route", lambda start, end: [])
    monkeypatch.setattr(weather, "ceiling_visibility_along_route", lambda start, end, window=None: (
        {"min_ceiling_ft": None, "min_visibility_sm": None, "stations": []}))
    monkeypatch.setattr(weather, "metar_for_idents", lambda idents: {ident: None for ident in idents})
    monkeypatch.setattr(airports, "get_runways", lambda ident: [])
    monkeypatch.setattr(airports, "get_frequencies", lambda ident: [])
    ring = [[-88.5, 43.4], [-87.5, 43.4], [-87.5, 43.6], [-88.5, 43.6], [-88.5, 43.4]]
    monkeypatch.setattr(tfr, "along_route", lambda path, start, end: [{
        "notam_id": "6/6664", "effective": "2026-10-04T15:00:00Z", "expires": "2026-10-04T17:00:00Z",
        "along_track_nm": 100.0, "crosses": True, "active_now": False,
        "geometry": {"type": "MultiPolygon", "coordinates": [[ring]]}}])

    body = TestClient(app).get("/api/briefing", params={
        "dep": "C81", "dest": "KDLH", "depart": "2026-10-04T14:00:00Z", "ete_min": 60,
        "fixes": ";".join(f"{lat},{lon}" for lat, lon in FIXES), "leg_min": "30,30", "ground_min": "0,0"}).json()

    assert body["legs_from"] == "navlog" and [(p["lat"], p["lon"]) for p in body["leg_fixes"]] == FIXES
    on = body["tfrs"][0]["on_route"]
    assert on["legs"] == [1] and on["source"] == "TFR"
    # In it about 14:42-14:48, twelve minutes before it starts: within the
    # half hour either side an estimate is given.
    assert on["when"] == "during" and on["valid_from"] == "2026-10-04T15:00:00Z"


def test_fixes_that_do_not_read_are_a_422():
    from fastapi.testclient import TestClient

    from app.main import app

    resp = TestClient(app).get("/api/briefing", params={"dep": "C81", "dest": "KDLH", "fixes": "42,-88;bad"})
    assert resp.status_code == 422
