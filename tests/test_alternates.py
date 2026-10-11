"""vfr.alternates: 14 CFR 91.169 read from a TAF and the d-TPP's charts --
the destination's "1-2-3" an hour either side of the ETA (2,000 ft and 3
sm, an instrument approach published), and an alternate's minimums at
its ETA (600-2 with an ILS, 800-2 without, its own where it publishes
them). The TAFs and charts are made here; the figures are the rule's."""
import pytest

from vfr import alternates, publications, weather

ETA = 1_800_000_000.0   # an hour boundary
HOUR = 3600.0

ILS = {"kind": "IAP", "name": "ILS OR LOC RWY 27", "url": "u"}
RNAV = {"kind": "IAP", "name": "RNAV (GPS) RWY 09", "url": "u"}
ALT_MINS = {"kind": "MIN", "name": "ALTERNATE MINIMUMS", "url": "https://aeronav.faa.gov/d-tpp/2610/NC3ALT.PDF"}


def _period(start, end, ceiling=None, visibility=6.0, change=""):
    clouds = [{"cover": "OVC", "base": ceiling}] if ceiling is not None else [{"cover": "SCT", "base": 3000}]
    return {"timeFrom": start, "timeTo": end, "change": change, "clouds": clouds, "visib": str(visibility), "vert_vis": None}


@pytest.fixture
def world(monkeypatch):
    """Fields with TAFs and charts a test sets: {ident: [periods]}, {ident: [charts]}."""
    tafs, charts = {}, {}
    places = {"KDST": (45.0, -90.0), "KALT": (45.5, -90.0), "KFAR": (46.5, -90.0), "KNOA": (45.2, -90.0)}
    monkeypatch.setattr(weather, "_dataset", lambda name: [
        {"icaoId": ident, "lat": places[ident][0], "lon": places[ident][1], "raw": f"TAF {ident}", "fcsts": fcsts}
        for ident, fcsts in tafs.items()])
    monkeypatch.setattr(publications, "terminal_charts", lambda ident: charts.get(ident, []))
    return tafs, charts


def test_123_holds_with_an_approach_and_2000_and_3_an_hour_either_side(world):
    tafs, charts = world
    charts["KDST"] = [ILS]
    tafs["KDST"] = [_period(ETA - 6 * HOUR, ETA + 6 * HOUR, ceiling=2000, visibility=3)]
    check = alternates.destination("KDST", ETA)
    assert check["required"] is False and check["reasons"] == []
    assert check["ceiling_ft"] == 2000 and check["visibility_sm"] == 3


def test_a_tempo_under_2000_within_the_hour_after_asks_for_an_alternate(world):
    tafs, charts = world
    charts["KDST"] = [ILS]
    tafs["KDST"] = [_period(ETA - 6 * HOUR, ETA + 6 * HOUR, ceiling=3000),
                    _period(ETA + 0.5 * HOUR, ETA + 2 * HOUR, ceiling=1900, change="TEMPO")]
    check = alternates.destination("KDST", ETA)
    assert check["required"] is True
    assert check["reasons"] == ["The TAF has a 1,900 ft ceiling within an hour of the ETA: under 2,000 ft."]


def test_a_tempo_more_than_an_hour_after_the_eta_does_not(world):
    tafs, charts = world
    charts["KDST"] = [ILS]
    tafs["KDST"] = [_period(ETA - 6 * HOUR, ETA + 6 * HOUR, ceiling=3000),
                    _period(ETA + 1.5 * HOUR, ETA + 3 * HOUR, ceiling=500, change="TEMPO")]
    assert alternates.destination("KDST", ETA)["required"] is False


def test_no_approach_or_no_taf_asks_for_an_alternate_whatever_the_weather(world):
    tafs, charts = world
    tafs["KDST"] = [_period(ETA - 6 * HOUR, ETA + 6 * HOUR)]
    assert alternates.destination("KDST", ETA)["reasons"] == [
        "KDST has no instrument approach published (14 CFR 91.169(b)(1)).",
    ]
    charts["KDST"] = [ILS]
    assert alternates.destination("KNOA", ETA)["reasons"][-1] == "No TAF for KNOA covers an hour either side of the ETA."


def test_an_alternate_with_an_ils_needs_600_and_2_and_without_800_and_2(world):
    tafs, charts = world
    charts["KALT"] = [ILS]
    tafs["KALT"] = [_period(ETA - HOUR, ETA + HOUR, ceiling=700, visibility=2)]
    check = alternates.alternate("KALT", ETA)
    assert check["good"] is True and check["minimums"] == {"ceiling_ft": 600, "visibility_sm": 2}
    # The same field with an RNAV approach alone: nonprecision, 800 and 2.
    charts["KALT"] = [RNAV]
    check = alternates.alternate("KALT", ETA)
    assert check["good"] is False and check["minimums"] == {"ceiling_ft": 800, "visibility_sm": 2}
    assert check["reasons"] == ["The TAF has a 700 ft ceiling at the ETA: under 800 ft."]


def test_an_alternate_with_its_own_minimums_or_no_approach_is_the_pilots_to_check(world):
    tafs, charts = world
    tafs["KALT"] = [_period(ETA - HOUR, ETA + HOUR, ceiling=3000)]
    charts["KALT"] = [ILS, ALT_MINS]
    check = alternates.alternate("KALT", ETA)
    assert check["good"] is None and check["alternate_minimums_url"] == ALT_MINS["url"]
    charts["KALT"] = []
    check = alternates.alternate("KALT", ETA)
    assert check["good"] is None and "91.169(c)(2)" in check["reasons"][0]


def test_the_nearest_that_will_do_are_offered_nearest_first(world):
    tafs, charts = world
    for ident in ("KALT", "KFAR", "KNOA"):
        tafs[ident] = [_period(ETA - 3 * HOUR, ETA + 3 * HOUR, ceiling=3000)]
    charts["KALT"] = [RNAV]
    charts["KFAR"] = [ILS]
    tafs["KDST"] = [_period(ETA - 3 * HOUR, ETA + 3 * HOUR, ceiling=500)]
    charts["KDST"] = [ILS]
    # KNOA has no approach: not offered. KDST is the destination.
    found = alternates.nearby((45.0, -90.0), "KDST", lambda lat, lon: ETA)
    assert [f["ident"] for f in found] == ["KALT", "KFAR"]
    assert found[0]["distance_nm"] == pytest.approx(30.0, abs=0.1)
    # One that publishes its own minimums is offered after those that will
    # do, for the pilot to check.
    charts["KALT"] = [RNAV, ALT_MINS]
    found = alternates.nearby((45.0, -90.0), "KDST", lambda lat, lon: ETA)
    assert [(f["ident"], f["good"]) for f in found] == [("KFAR", True), ("KALT", None)]
