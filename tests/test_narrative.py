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
    assert "at 4500ft" in text
    assert "set this altitude by hand" in text


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
