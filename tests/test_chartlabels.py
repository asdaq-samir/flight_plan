import pytest

from vfr.chartlabels import (
    delete_pick,
    load_picks,
    route_key,
    save_pick,
    summarise,
)

ROUTE = "KDSM->KOMA"
LAT, LON = 41.5443, -93.6208


@pytest.fixture
def picks_file(tmp_path):
    return tmp_path / "chart_picks.csv"


def _pick(lat=LAT, lon=LON, source="detected", rating=4, category="water", route=ROUTE):
    return {
        "route": route, "source": source, "category": category,
        "lat": lat, "lon": lon, "along_track_nm": 1.7, "cross_track_nm": 0.4,
        "rating": rating, "area_m2": 1000.0, "note": None,
    }


def test_route_key_is_case_insensitive():
    assert route_key(" kdsm ", "koma") == "KDSM->KOMA"


def test_no_file_means_no_picks_not_an_error(picks_file):
    """The normal state before any labeling has happened."""
    assert load_picks(path=picks_file) == []
    assert summarise(path=picks_file)["total"] == 0


def test_saving_then_loading_round_trips_types(picks_file):
    save_pick(_pick(), path=picks_file)
    (row,) = load_picks(ROUTE, path=picks_file)
    assert row["lat"] == pytest.approx(LAT)
    assert row["rating"] == 4
    assert isinstance(row["rating"], int)


def test_changing_your_mind_replaces_rather_than_duplicates(picks_file):
    """Two contradictory rows for one place would be training noise."""
    save_pick(_pick(rating=4), path=picks_file)
    result = save_pick(_pick(rating=2), path=picks_file)
    rows = load_picks(ROUTE, path=picks_file)
    assert len(rows) == 1
    assert rows[0]["rating"] == 2
    assert result["replaced"] is True


def test_a_nearby_click_counts_as_the_same_place(picks_file):
    """A detection centroid shifts between tile blocks, and nobody
    clicks the same pixel twice."""
    save_pick(_pick(), path=picks_file)
    save_pick(_pick(lat=LAT + 0.0005, lon=LON + 0.0005, rating=1), path=picks_file)
    assert len(load_picks(ROUTE, path=picks_file)) == 1


def test_a_pick_on_another_point_nearby_is_named_when_it_is_displaced(picks_file):
    # One pick per place, whatever each point is: rating the bridge takes
    # the river's pick beside it, and the save says so, so the page can
    # stop showing the river as rated. Re-rating the same point is no
    # displacement at all.
    save_pick(_pick(category="river"), path=picks_file)
    again = save_pick(_pick(lat=LAT + 0.0002, category="river", rating=2), path=picks_file)   # the same river, re-rated
    assert again["replaced"] and again["displaced"] == []

    bridge = save_pick(_pick(lat=LAT + 0.0005, category="road_or_rail"), path=picks_file)

    assert bridge["displaced"] == [{"lat": LAT + 0.0002, "lon": LON, "category": "river"}]
    assert [p["category"] for p in load_picks(ROUTE, path=picks_file)] == ["road_or_rail"]


def test_a_genuinely_different_place_is_its_own_pick(picks_file):
    save_pick(_pick(), path=picks_file)
    save_pick(_pick(lat=LAT + 0.5, lon=LON + 0.5), path=picks_file)
    assert len(load_picks(ROUTE, path=picks_file)) == 2


def test_the_same_point_on_another_route_is_separate(picks_file):
    save_pick(_pick(), path=picks_file)
    save_pick(_pick(route="C81->KDLH"), path=picks_file)
    assert len(load_picks(path=picks_file)) == 2
    assert len(load_picks(ROUTE, path=picks_file)) == 1


def test_delete_removes_only_that_pick(picks_file):
    save_pick(_pick(), path=picks_file)
    save_pick(_pick(lat=LAT + 0.5), path=picks_file)
    assert delete_pick(ROUTE, LAT, LON, path=picks_file) is True
    assert len(load_picks(ROUTE, path=picks_file)) == 1


def test_delete_reports_when_there_was_nothing_there(picks_file):
    save_pick(_pick(), path=picks_file)
    assert delete_pick(ROUTE, 10.0, 10.0, path=picks_file) is False


def test_summary_separates_the_three_kinds_of_signal(picks_file):
    """Accepted detections, rejected detections and misses answer
    different questions -- the last one says whether the palette rules
    need work at all."""
    save_pick(_pick(rating=5), path=picks_file)
    save_pick(_pick(lat=LAT + 0.5, rating=0), path=picks_file)
    save_pick(_pick(lat=LAT + 1.0, source="added", rating=4, category="road"), path=picks_file)
    s = summarise(ROUTE, path=picks_file)
    assert (s["accepted"], s["rejected"], s["added"]) == (1, 1, 1)
    assert s["added_categories"] == ["road"]


def test_a_zero_rating_is_a_rejection_not_a_missing_value(picks_file):
    save_pick(_pick(rating=0), path=picks_file)
    (row,) = load_picks(ROUTE, path=picks_file)
    assert row["rating"] == 0
    assert summarise(ROUTE, path=picks_file)["rejected"] == 1


# --- DR checkpoints and visual references are different jobs ---

from vfr.chartlabels import ROLES, default_role  # noqa: E402


def test_on_course_defaults_to_a_dead_reckoning_checkpoint():
    assert default_role(0.0) == "dr"
    assert default_role(-0.4) == "dr"


def test_well_off_course_defaults_to_a_visual_reference():
    """An airport three miles abeam is not something you fly over; it is
    something you look at to confirm position."""
    assert default_role(3.58) == "visual"
    assert default_role(-1.8) == "visual"


def test_role_survives_a_save_and_load(picks_file):
    save_pick({**_pick(), "role": "visual"}, path=picks_file)
    (row,) = load_picks(ROUTE, path=picks_file)
    assert row["role"] == "visual"


def test_summary_counts_both_roles(picks_file):
    save_pick({**_pick(), "role": "dr"}, path=picks_file)
    save_pick({**_pick(lat=LAT + 0.5), "role": "visual"}, path=picks_file)
    assert summarise(ROUTE, path=picks_file)["by_role"] == {"dr": 1, "visual": 1}


def test_roles_are_the_two_documented_ones():
    assert ROLES == ("dr", "visual")
