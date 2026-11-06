"""The app's Claude features, called the way the app calls them, for the
nightly AI check (.github/workflows/ai-check.yml): a checkpoint
description, a briefing, the pilot's assistant and the words with
citations.

The tests stand Claude in, so they can't see what only a real reply
shows: the briefing came back empty for pilots for as long as a 512-token
cap left the model's thinking no room to write (#81), and every test
passed. This asks for one checkpoint description and one briefing with
the services' own code and settings, and fails, saying why, on a reply
that is empty, cut off or not what the prompt asks for.

    cd planning-service && python ../.github/ai-check/check.py note
    cd nav-log-agent && python ../.github/ai-check/check.py briefing
    cd planning-service && python ../.github/ai-check/check.py assistant
    cd planning-service && python ../.github/ai-check/check.py words

Each needs ANTHROPIC_API_KEY and src on PYTHONPATH. Nothing is saved.
"""
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).parent
# Python puts this script's own folder on the path, not the one it runs
# in: the service's `app` package is in the latter.
sys.path.insert(0, str(pathlib.Path.cwd()))


def check_note() -> tuple[str, list[str]]:
    from app.routers import notes

    checkpoint = {"name": "Lake Mary", "category": "water", "along_track_nm": 45.8}
    # Raises on an empty reply or one cut off at the cap.
    text = notes._describe_checkpoint(checkpoint, "C81", "Round Lake Beach", "Watertown")
    problems = []
    words = len(text.split())
    if words > 40:
        problems.append(f"{words} words, where the prompt asks for under 20")
    if "\n" in text:
        problems.append("more than one line")
    if any(s in text.lower() for s in ("wait,", "i don't know", "i don't have")):
        problems.append("it talks about itself rather than the checkpoint")
    return text, problems


def check_briefing() -> tuple[str, list[str]]:
    from langgraph.graph import END, START, StateGraph

    from app import graph

    plan = json.loads((HERE / "plan-C81-KDLH.json").read_text())
    state = {
        "departure_ident": "C81", "destination_ident": "KDLH", "altitude_ft": plan["altitude_ft"],
        "altitude_selection": plan["altitude_selection"], "legs": plan["legs"],
        "flown": plan["altitude_choice"] or "custom", "similar_briefings": [],
    }
    # generate_briefing alone: no planner to fetch from and no database
    # to remember in, just its Claude call, in a graph so its stream
    # writer has one to write to.
    one = StateGraph(graph.NavLogState)
    one.add_node("generate_briefing", graph.generate_briefing)
    one.add_edge(START, "generate_briefing")
    one.add_edge("generate_briefing", END)
    out = one.compile().invoke(state)
    text = out["briefing"]
    if out.get("briefing_failed"):
        return text, [text]
    problems = []
    words = len(text.split())
    if not 60 <= words <= 320:
        problems.append(f"{words} words, where the prompt asks for under 200")
    if "**" in text or text.lstrip().startswith("#") or "\n#" in text:
        problems.append("Markdown in a briefing shown as plain text")
    return text, problems


METAR_KDLH = "KDLH 031753Z 27012G18KT 10SM OVC035 04/M02 A2992 RMK AO2 SLP138"


def check_assistant() -> tuple[str, list[str]]:
    """One question to the assistant with its one tool stood in for: the
    planner's data is not on the runner, so the weather tool answers a
    fixed METAR and the check is of the model's part, asking the tool,
    reading its answer, citing it, streaming the words."""
    from anthropic import beta_tool

    from app import assistant

    box = assistant.Toolbox(assistant.Context(dep="C81", dest="KDLH"))

    def weather_at(ident: str) -> str:
        """The weather at a field now: its METAR as sent and read.

        Args:
            ident: The airport's ident (KDLH, C81).
        """
        box.source("metar:KDLH", "METAR KDLH 1753Z", METAR_KDLH)
        return json.dumps({"ident": "KDLH", "elevation_ft": 1428, "metar": {"raw": METAR_KDLH, "flight_category": "VFR",
                           "ceiling_ft": 3500, "visibility_sm": 10, "wind_dir_true_deg": 270, "wind_speed_kt": 12,
                           "wind_gust_kt": 18}})

    box.tools = [beta_tool(weather_at)]
    ask = assistant.AssistantAsk(messages=[assistant.Turn(role="user", content="What is the wind at Duluth right now?")],
                                 context=assistant.Context(dep="C81", dest="KDLH"))
    runner = assistant.runner_for(assistant.conversation(ask), box)
    events = [json.loads(line) for line in assistant.answer(ask, runner=runner, box=box)]
    text = "".join(e["text"] for e in events if e["type"] == "text")
    problems = []
    kinds = [e["type"] for e in events]
    if "error" in kinds:
        problems.append("an error event: " + next(e["words"] for e in events if e["type"] == "error"))
    if "tool" not in kinds:
        problems.append("the model answered without asking the weather tool")
    if not text.strip():
        problems.append("no words")
    elif "KDLH" not in text and "Duluth" not in text:
        problems.append("the answer names neither KDLH nor Duluth")
    elif "12" not in text:
        problems.append("the answer does not give the METAR's 12 kt")
    sources = next((e["sources"] for e in events if e["type"] == "sources"), [])
    if not any(s["id"] == "metar:KDLH" for s in sources):
        problems.append("the METAR is not among the sources")
    if kinds[-1] != "done" and "error" not in kinds:
        problems.append("the stream did not end with done")
    return text, problems


def check_words() -> tuple[str, list[str]]:
    """The words module over two fixed sources: every sentence cites one
    of them (the module drops the rest, so an answer with no sentences is
    a model that cited nothing), and none is cut off."""
    from app import words

    sources = [
        words.Source(id="metar:KDLH", label="METAR KDLH 1753Z", text=METAR_KDLH),
        words.Source(id="hazard:1", label="AIRMET Sierra", text="AIRMET SIERRA FOR IFR AND MTN OBSCN VALID UNTIL 032100. "
                     "IFR... MN WI. CIG BLW 010/VIS BLW 3SM BR. CONDS CONTG BYD 21Z THRU 03Z."),
    ]
    answer = words.say("The weather for a flight from C81 to KDLH arriving at 1930Z, as a pilot would brief it.", sources)
    text = "\n".join(f"{s.text}  [{', '.join(s.sources)}]" for s in answer.sentences)
    problems = []
    if answer.unavailable:
        problems.append(answer.unavailable)
    if not answer.sentences:
        problems.append("no sentences survived the citation check")
    given = {s.id for s in sources}
    if any(set(s.sources) - given for s in answer.sentences):
        problems.append("a sentence cites a source that was not given")
    if any(not s.text.strip() or s.text.strip()[-1] not in ".!?" for s in answer.sentences):
        problems.append("a sentence is empty or cut off")
    return text, problems


if __name__ == "__main__":
    which = sys.argv[1]
    try:
        text, problems = {"note": check_note, "briefing": check_briefing, "assistant": check_assistant, "words": check_words}[which]()
    except Exception as err:  # the check reports any failure, whatever raised it
        text, problems = "", [f"{type(err).__name__}: {err}"]
    print(f"--- the {which} ---\n{text}\n")
    if problems:
        print(f"::error title=AI check, the {which}::" + "; ".join(problems))
        sys.exit(1)
    print(f"The {which} is fine.")
