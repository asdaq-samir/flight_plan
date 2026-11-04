"""The pilot's assistant (app.assistant): the conversation as the API
takes it, the events it streams, and the sources its tools keep -- with
the model stood in for, as test_oral stands in for the examiner."""
import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import assistant
from app.assistant import AssistantAsk, Context, OwnShip, Toolbox, Turn
from app.main import app

client = TestClient(app)


def events(lines: str) -> list[dict]:
    return [json.loads(line) for line in lines.splitlines() if line.strip()]


class FakeStream:
    """One turn of the model as the SDK streams it: text events, then the
    final message with its blocks and stop reason."""

    def __init__(self, texts, blocks=(), stop_reason="end_turn"):
        self.texts = texts
        self.message = SimpleNamespace(content=list(blocks), stop_reason=stop_reason)

    def __iter__(self):
        for text in self.texts:
            yield SimpleNamespace(type="text", text=text)

    def get_final_message(self):
        return self.message


def tool_use(name, **input):
    return SimpleNamespace(type="tool_use", name=name, input=input)


def test_the_context_is_written_into_the_last_question_only():
    ask = AssistantAsk(
        messages=[Turn(role="user", content="Hi"), Turn(role="assistant", content="Hello"), Turn(role="user", content="Can I go?")],
        context=Context(dep="C81", dest="KDLH", aircraft="c172", altitude_ft=4500, own_ship=OwnShip(lat=42.3, lon=-88.1),
                        pilot={"personal_minimums": {"ceiling_ft": 3000}}),
    )
    turns = assistant.conversation(ask)
    assert turns[0] == {"role": "user", "content": "Hi"}
    assert turns[1] == {"role": "assistant", "content": "Hello"}
    last = turns[2]["content"]
    assert last.startswith("<context>")
    assert "route: C81 KDLH" in last and "airplane: c172" in last and "cruise altitude: 4500 ft" in last
    assert "own ship: 42.300, -88.100" in last and '"ceiling_ft":3000' in last
    assert last.endswith("<question>\nCan I go?\n</question>")


def test_a_conversation_not_ending_on_the_pilot_is_refused():
    ask = AssistantAsk(messages=[Turn(role="user", content="Hi"), Turn(role="assistant", content="Hello")])
    with pytest.raises(HTTPException) as err:
        assistant.conversation(ask)
    assert err.value.status_code == 422


def test_the_tools_are_the_planners_nine_by_name():
    box = Toolbox(Context(dep="C81", dest="KDLH", stops=["KJVL"]))
    assert sorted(box.by_name) == ["airport", "briefing_for", "divert", "find_place", "go_no_go", "hold_entry",
                                   "nearest_airports", "plan_flight", "weather_at"]
    # The plan's route fills what the question left out.
    assert box.route("", "", "") == ("C81", "KDLH", "KJVL")
    assert box.route("kjvl", "", "") == ("KJVL", "KDLH", "KJVL")


def test_the_events_stream_in_order_with_the_tools_sources():
    box = Toolbox(Context(dep="C81", dest="KDLH"))
    # The model asks for the weather (the tool reads a METAR), then answers.
    box.source("metar:KDLH", "METAR KDLH 1753Z", "KDLH 031753Z 27012G18KT 10SM OVC035 04/M02 A2992")
    runner = iter([FakeStream([], blocks=[tool_use("weather_at", ident="KDLH")], stop_reason="tool_use"),
                   FakeStream(["Duluth is ", "VFR now."], stop_reason="end_turn")])
    ask = AssistantAsk(messages=[Turn(role="user", content="How is Duluth?")], context=Context(dep="C81", dest="KDLH"))
    got = events("".join(assistant.answer(ask, runner=runner, box=box)))
    assert got[0] == {"type": "tool", "name": "weather_at", "label": "The weather at KDLH"}
    assert [e["text"] for e in got if e["type"] == "text"] == ["Duluth is ", "VFR now."]
    sources = next(e for e in got if e["type"] == "sources")["sources"]
    assert sources == [{"id": "metar:KDLH", "label": "METAR KDLH 1753Z", "text": "KDLH 031753Z 27012G18KT 10SM OVC035 04/M02 A2992"}]
    assert got[-1] == {"type": "done"}


def test_a_refusal_and_a_cut_off_answer_are_errors_in_words():
    ask = AssistantAsk(messages=[Turn(role="user", content="?")])
    refused = events("".join(assistant.answer(ask, runner=iter([FakeStream([], stop_reason="refusal")]))))
    assert refused[-1]["type"] == "error" and "declined" in refused[-1]["words"]
    cut = events("".join(assistant.answer(ask, runner=iter([FakeStream(["so"], stop_reason="max_tokens")]))))
    assert cut[-1]["type"] == "error" and "room" in cut[-1]["words"]


def test_the_weather_tool_keeps_the_metar_as_sent_as_a_source(monkeypatch):
    from app.routers import airports
    from app.schemas import Metar

    metar = Metar(raw="KDLH 031753Z 27012KT 10SM CLR 04/M02 A2992", observed_at="2026-11-03T17:53:00Z", flight_category="VFR")
    place = SimpleNamespace(ident="KDLH", name="Duluth Intl", elevation_ft=1428.0, metar=metar, nearby_metar=None)
    monkeypatch.setattr(airports, "airport_place", lambda ident: place)
    box = Toolbox()
    answer = json.loads(box.by_name["weather_at"].call({"ident": "KDLH"}))
    assert answer["metar"]["flight_category"] == "VFR" and answer["elevation_ft"] == 1428.0
    assert [s.id for s in box.sources] == ["metar:KDLH"] and box.sources[0].label == "METAR KDLH 1753Z"


def test_a_tool_that_fails_tells_the_model_in_the_planners_words(monkeypatch):
    from app.routers import airports

    def missing(ident):
        raise HTTPException(404, "No US airport goes by 'ZZZZ'.")

    monkeypatch.setattr(airports, "airport_place", missing)
    assert Toolbox().by_name["weather_at"].call({"ident": "ZZZZ"}) == "Error: No US airport goes by 'ZZZZ'."


def test_the_endpoint_streams_ndjson(monkeypatch):
    monkeypatch.setattr(assistant, "runner_for", lambda turns, box: iter([FakeStream(["Yes."], stop_reason="end_turn")]))
    response = client.post("/api/assistant", json={"messages": [{"role": "user", "content": "Can I go?"}],
                                                   "context": {"dep": "C81", "dest": "KDLH", "stops": []}})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/x-ndjson")
    got = events(response.text)
    assert got[0] == {"type": "text", "text": "Yes."} and got[-1] == {"type": "done"}


def test_the_endpoint_refuses_a_conversation_that_is_not_the_pilots_turn():
    response = client.post("/api/assistant", json={"messages": [{"role": "assistant", "content": "Hello"}]})
    assert response.status_code == 422
