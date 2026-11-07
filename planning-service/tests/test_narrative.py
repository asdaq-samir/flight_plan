"""The Brief's narrative (app.narrative): the request it accepts, the one
prompt it writes from, and the stream it answers with -- with the model
stood in for, as test_assistant and test_oral stand in for theirs.
Ported from the two agents it replaced (nav-log-agent, crewai-agent)."""
import json
from types import SimpleNamespace

import anthropic
import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app import narrative
from app.main import app

client = TestClient(app)

LEG = {"from": "C81", "to": "KDLH", "distance_nm": 290.0, "magnetic_heading_deg": 335.0,
       "groundspeed_kt": 110.0, "ete_min": 158.0, "fuel_gal": 22.4}

SELECTION = {
    "floor_ft": 2200.0, "band_ceiling_ft": 3600.0, "icing_possible": False, "freezing_level_ft": None,
    "low_ceiling_or_visibility": False, "min_ceiling_ft": None, "min_visibility_sm": None, "hazards": [],
    "weather_unavailable": [],
}


def _request(**over):
    return {"departure_ident": "C81", "destination_ident": "KDLH", "altitude_ft": 4500, "legs": [LEG], **over}


def events(lines) -> list[dict]:
    return [json.loads(line) for line in "".join(lines).splitlines() if line.strip()]


# --- The prompt ----------------------------------------------------------------


def test_the_prompt_carries_every_leg_and_names_an_unflyable_one():
    unflyable = dict(LEG, **{"from": "KDLH", "to": "C81", "magnetic_heading_deg": None,
                              "groundspeed_kt": None, "ete_min": None, "fuel_gal": None})
    text = narrative.briefing_prompt("C81", "KDLH", 4500, None, [LEG, unflyable])
    assert "- C81 -> KDLH: 290.0nm, heading 335M, GS 110kt, ETE 158min, fuel 22.4gal" in text
    assert "UNFLYABLE" in text
    assert "at 4,500ft" in text
    assert "by hand" not in text


def test_a_leg_says_its_true_airspeed_in_its_own_air():
    leg = dict(LEG, tas_kt=112.4, density_altitude_ft=7240)
    text = narrative.briefing_prompt("C81", "KDLH", 6500.0, None, [leg])
    assert "heading 335M, TAS 112kt at density altitude 7,240ft, GS 110kt" in text


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


def test_the_clouds_the_altitudes_keep_under_are_briefed():
    sel = dict(SELECTION, cloud_base_ft=4100.0, cloud_station="KRHI", cloud_ceiling_ft=3600.0)
    text = narrative.briefing_prompt("C81", "KDLH", 2500, sel, [LEG])

    assert "Cloud clearance (14 CFR 91.155): clouds forecast at 4,100ft MSL near KRHI, so no altitude above 3,600ft" in text


def test_clouds_that_leave_no_altitude_are_briefed_as_such():
    sel = dict(SELECTION, cloud_base_ft=2200.0, cloud_station="KRHI", cloud_ceiling_ft=1700.0, cloud_clearance_kept=False)
    text = narrative.briefing_prompt("C81", "KDLH", 2500, sel, [LEG])

    assert "CLOUD CLEARANCE NOT POSSIBLE (14 CFR 91.155)" in text and "so no altitude above" not in text


def test_no_value_is_printed_as_none():
    """Flagged on visibility alone, and with no band ceiling: both used to
    read "Noneft"."""
    sel = dict(SELECTION, band_ceiling_ft=None, low_ceiling_or_visibility=True, min_visibility_sm=2.5)
    text = narrative.briefing_prompt("C81", "KDLH", 4500, sel, [LEG])

    assert "None" not in text
    assert "GO/NO-GO: forecast visibility 2.5SM near the route" in text
    assert "no ceiling below Class A" in text


@pytest.mark.parametrize("flown, says", [
    ("custom", "The altitude is the pilot's own"),
    ("fastest", "The altitudes are the planner's fastest plan."),
    ("economical", "The altitudes are the planner's economical plan."),
])
def test_whose_altitude_it_is_comes_from_flown(flown, says):
    text = narrative.briefing_prompt("C81", "KDLH", 4500, SELECTION, [LEG], flown=flown)
    assert says in text


def test_without_flown_the_prompt_says_nothing_of_whose_altitude():
    text = narrative.briefing_prompt("C81", "KDLH", 4500, SELECTION, [LEG])
    assert "pilot's own" not in text and "planner's" not in text


def test_the_request_is_prompted_with_its_legs_as_they_arrived():
    """A leg's other fields (its true airspeed) reach the prompt, under
    their own names ("from"), through the checked request."""
    request = narrative.NarrativeRequest.model_validate(_request(legs=[dict(LEG, tas_kt=112.4)], flown="highest"))
    text = narrative.prompt_for(request)
    assert "- C81 -> KDLH: 290.0nm, heading 335M, TAS 112kt" in text
    assert "The altitudes are the planner's highest plan." in text


# --- The request ---------------------------------------------------------------


def test_a_request_without_legs_is_refused_by_name():
    with pytest.raises(ValidationError) as err:
        narrative.NarrativeRequest.model_validate({"departure_ident": "C81", "destination_ident": "KDLH", "altitude_ft": 4500})
    assert err.value.errors()[0]["loc"] == ("legs",)


def test_the_aircraft_is_optional_so_the_planners_default_applies():
    assert narrative.NarrativeRequest.model_validate(_request()).aircraft_name is None


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


def test_a_nav_log_legs_other_fields_are_kept():
    leg = dict(LEG, wind={"dir": 270, "kt": 20}, altitude_ft=4500.0)
    kept = narrative.NarrativeRequest.model_validate(_request(legs=[leg])).leg_dicts()[0]
    assert kept["wind"] == {"dir": 270, "kt": 20} and kept["from"] == "C81" and kept["altitude_ft"] == 4500.0


def test_which_altitudes_are_flown_may_be_said():
    assert narrative.NarrativeRequest.model_validate(_request(flown="highest")).flown == "highest"
    with pytest.raises(ValidationError):
        narrative.NarrativeRequest.model_validate(_request(flown="sideways"))


# --- The stream ----------------------------------------------------------------


class FakeStream:
    """The SDK's message stream: these text deltas, then a final message
    with this stop reason."""

    def __init__(self, parts, stop_reason):
        self.text_stream, self.stop_reason = iter(parts), stop_reason

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def get_final_message(self):
        return SimpleNamespace(stop_reason=self.stop_reason)


def _claude_writes(monkeypatch, parts, stop_reason="end_turn"):
    asked = []

    def stream(**kw):
        asked.append(kw)
        return FakeStream(parts, stop_reason)

    monkeypatch.setattr(narrative, "_client", lambda: SimpleNamespace(messages=SimpleNamespace(stream=stream)))
    return asked


def _request_model(**over):
    return narrative.NarrativeRequest.model_validate(_request(**over))


def test_a_whole_briefing_streams_its_pieces_then_the_whole(monkeypatch):
    asked = _claude_writes(monkeypatch, ["Depart C81 ", "at 4,500 ft."])
    lines = events(narrative.stream(_request_model()))

    assert lines == [
        {"type": "delta", "text": "Depart C81 "},
        {"type": "delta", "text": "at 4,500 ft."},
        {"type": "done", "briefing": "Depart C81 at 4,500 ft."},
    ]
    assert asked[0]["model"] == narrative.NARRATIVE_MODEL
    assert asked[0]["max_tokens"] == narrative.NARRATIVE_MAX_TOKENS
    assert "- C81 -> KDLH: 290.0nm" in asked[0]["messages"][0]["content"]


def test_a_briefing_cut_off_at_the_cap_ends_in_an_error_not_done(monkeypatch):
    """Cut off before its weather, it would read as whole to a pilot."""
    _claude_writes(monkeypatch, ["Depart C81 at 4,500 ft. Weather along the route:"], "max_tokens")
    lines = events(narrative.stream(_request_model()))

    assert lines[-1]["type"] == "error" and "ran out of room" in lines[-1]["detail"]
    assert not any(line["type"] == "done" for line in lines)


def test_an_empty_answer_is_an_error(monkeypatch):
    _claude_writes(monkeypatch, ["  "])
    assert events(narrative.stream(_request_model()))[-1]["type"] == "error"


def test_claude_out_of_reach_is_an_error_line_without_its_internals(monkeypatch):
    def stream(**kw):
        raise anthropic.APIConnectionError(request=httpx.Request("POST", "https://api.anthropic.com/v1/messages"))

    monkeypatch.setattr(narrative, "_client", lambda: SimpleNamespace(messages=SimpleNamespace(stream=stream)))
    assert events(narrative.stream(_request_model())) == [{"type": "error", "detail": narrative.UNREACHABLE}]


def test_the_endpoint_streams_ndjson(monkeypatch):
    _claude_writes(monkeypatch, ["Depart C81."])
    resp = client.post("/api/briefing/narrative", json=_request())

    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/x-ndjson")
    assert events(resp.text)[-1] == {"type": "done", "briefing": "Depart C81."}


def test_the_endpoint_refuses_a_nav_log_it_cannot_read_before_claude_is_asked(monkeypatch):
    asked = _claude_writes(monkeypatch, ["never"])
    resp = client.post("/api/briefing/narrative", json=_request(legs=[]))

    assert resp.status_code == 422
    assert asked == []
