"""vfr.narrative: the request both narrative agents accept and the one
prompt both write from."""
import pytest
from pydantic import ValidationError

from vfr import narrative

LEG = {"from": "C81", "to": "KDLH", "distance_nm": 290.0, "magnetic_heading_deg": 335.0,
       "groundspeed_kt": 110.0, "ete_min": 158.0, "fuel_gal": 22.4}


def test_the_prompt_carries_every_leg_and_names_an_unflyable_one():
    unflyable = dict(LEG, **{"from": "KDLH", "to": "C81", "magnetic_heading_deg": None,
                              "groundspeed_kt": None, "ete_min": None, "fuel_gal": None})
    text = narrative.briefing_prompt("C81", "KDLH", 4500, None, [LEG, unflyable])
    assert "- C81 -> KDLH: 290.0nm, heading 335M, GS 110kt, ETE 158min, fuel 22.4gal" in text
    assert "UNFLYABLE" in text
    assert "at 4,500ft" in text
    # Nothing said the pilot typed it: that branch guessed from a
    # missing selection.
    assert "by hand" not in text


def test_memory_is_added_only_when_the_caller_has_one():
    assert "Similar past route briefings" not in narrative.briefing_prompt("C81", "KDLH", 4500, None, [LEG])
    text = narrative.briefing_prompt("C81", "KDLH", 4500, None, [LEG], similar_briefings=[])
    assert "(no similar past routes yet)" in text


def test_a_request_without_legs_is_refused_by_name():
    with pytest.raises(ValidationError) as err:
        narrative.NarrativeRequest.model_validate({"departure_ident": "C81", "destination_ident": "KDLH", "altitude_ft": 4500})
    assert err.value.errors()[0]["loc"] == ("legs",)


def test_the_aircraft_is_optional_so_the_planners_default_applies():
    body = narrative.NarrativeRequest.model_validate(
        {"departure_ident": "C81", "destination_ident": "KDLH", "altitude_ft": 4500, "legs": [LEG]},
    )
    assert body.aircraft_name is None


def _request(**over):
    return {"departure_ident": "C81", "destination_ident": "KDLH", "altitude_ft": 4500, "legs": [LEG], **over}


def test_a_nav_log_longer_than_any_route_is_refused():
    narrative.NarrativeRequest.model_validate(_request(legs=[LEG] * narrative.MAX_LEGS))
    with pytest.raises(ValidationError):
        narrative.NarrativeRequest.model_validate(_request(legs=[LEG] * (narrative.MAX_LEGS + 1)))


@pytest.mark.parametrize("leg", [
    {"to": "KDLH", "distance_nm": 290.0},                                     # no "from"
    dict(LEG, groundspeed_kt=None),                                           # flyable but incomplete
    dict(LEG, **{"from": "x" * 81}),                                          # a paragraph, not a fix name
    dict(LEG, distance_nm="far"),
])
def test_a_leg_the_prompt_cannot_read_is_refused_before_claude_is_asked(leg):
    with pytest.raises(ValidationError):
        narrative.NarrativeRequest.model_validate(_request(legs=[leg]))


def test_a_nav_log_legs_other_fields_are_kept_for_the_agents():
    leg = dict(LEG, wind={"dir": 270, "kt": 20}, altitude_ft=4500)
    assert narrative.NarrativeRequest.model_validate(_request(legs=[leg])).legs == [leg]


SELECTION = {
    "floor_ft": 2200.0, "band_ceiling_ft": 3600.0, "icing_possible": False, "freezing_level_ft": None,
    "low_ceiling_or_visibility": False, "min_ceiling_ft": None, "min_visibility_sm": None, "hazards": [],
    "weather_unavailable": [],
}


def test_a_stepped_plan_is_briefed_leg_by_leg_with_its_climb():
    """The header named the first leg's altitude as the flight's, and no
    leg line said where it was flown."""
    low = dict(LEG, **{"to": "BRAVO"}, altitude_ft=2500.0, climb_min=4.2)
    high = dict(LEG, **{"from": "BRAVO"}, altitude_ft=6500.0, climb_min=0.0)
    text = narrative.briefing_prompt("C81", "KDLH", 2500, SELECTION, [low, high])

    assert "stepping between 2,500ft and 6,500ft" in text and "at 2,500ft." not in text
    assert "- C81 -> BRAVO: 290.0nm at 2,500ft, climbing for 4min, heading 335M" in text
    assert "- BRAVO -> KDLH: 290.0nm at 6,500ft, heading 335M" in text


def test_weather_that_could_not_be_read_is_briefed_as_unknown_not_clear():
    sel = dict(SELECTION, weather_unavailable=["freezing_level", "ceiling_visibility", "hazards"])
    text = narrative.briefing_prompt("C81", "KDLH", 4500, sel, [LEG])

    assert "Icing: UNKNOWN" in text and "Ceiling/visibility: UNKNOWN" in text and "SIGMETs: UNKNOWN" in text
    assert "not expected" not in text and "none on the route" not in text


def test_no_value_is_printed_as_none():
    """Flagged on visibility alone, and with no band ceiling: both used to
    read "Noneft"."""
    sel = dict(SELECTION, band_ceiling_ft=None, low_ceiling_or_visibility=True, min_visibility_sm=2.5)
    text = narrative.briefing_prompt("C81", "KDLH", 4500, sel, [LEG])

    assert "None" not in text
    assert "GO/NO-GO: forecast visibility 2.5SM near the route" in text
    assert "no ceiling below Class A" in text
