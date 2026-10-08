"""The app's two Claude features, called the way the app calls them, for
the nightly AI check (.github/workflows/ai-check.yml).

The tests stand Claude in, so they can't see what only a real reply
shows: the briefing came back empty for pilots for as long as a 512-token
cap left the model's thinking no room to write (#81), and every test
passed. This asks for one checkpoint description and one briefing with
the services' own code and settings, and fails, saying why, on a reply
that is empty, cut off or not what the prompt asks for.

    cd planning-service && python ../.github/ai-check/check.py note
    cd nav-log-agent && python ../.github/ai-check/check.py briefing

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


if __name__ == "__main__":
    which = sys.argv[1]
    try:
        text, problems = {"note": check_note, "briefing": check_briefing}[which]()
    except Exception as err:  # the check reports any failure, whatever raised it
        text, problems = "", [f"{type(err).__name__}: {err}"]
    print(f"--- the {which} ---\n{text}\n")
    if problems:
        print(f"::error title=AI check, the {which}::" + "; ".join(problems))
        sys.exit(1)
    print(f"The {which} is fine.")
