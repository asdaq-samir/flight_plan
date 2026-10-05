"""The mock oral's review sheet: the roadmap's release gate, for a CFI.

Asks the examiner (app.oral) a question on each of a spread of the
Private Pilot ACS's cross-country knowledge elements, about three planned
flights, and writes each down -- the question, its answer, its key points
and the passages it quotes, with a line for the instructor's mark -- as
one Markdown file to read, mark and hand back, and the same as JSON
beside it for a page to show. Until enough of them are
marked right, the mock oral stays the developer's.

    docker exec flight_plan-planning-service-1 sh -c \\
        'cd /workspace/planning-service && python -m app.oral_review --count 12 --out /workspace/data/oral-review.md'

Each question is two billed calls' worth of a large model; --count says
how many.
"""
from __future__ import annotations

import argparse
import json
import random
import time
from pathlib import Path

from . import oral

ACS = Path(__file__).resolve().parents[2] / "web" / "src" / "lib" / "acs.json"

#: Three flights an examiner might be shown: one under a Class B shelf
#: into a Class C, one at night over a MOA into a Class D, one short and
#: uncontrolled.
PLANS = [
    "Route: KMSN (Madison; Class C at the surface) to KOSH (Oshkosh; Class D, tower part-time).\n"
    "Aircraft: Cessna 172, cruise 4,500 ft, 62 nm, 0 h 38 min en route, 6.1 gal planned, 30-minute reserve.\n"
    "METAR KOSH: KOSH 051953Z 31014G22KT 10SM SCT035 BKN050 12/03 A3002.",
    "Route: C81 (Campbell; Class G at the surface, under the Chicago Class B shelf) to KDLH (Duluth; Class D).\n"
    "Aircraft: Cessna 172, cruise 5,500 ft, 323 nm, 2 h 50 min en route, 29.0 gal planned, 45-minute reserve.\n"
    "Departing Mon 5 Oct, 18:00, part of the flight at night.\n"
    "Special-use airspace crossed: VOLK EAST MOA (military operations area), 8,000 ft to FL180.",
    "Route: 3CK (Lake in the Hills; Class G at the surface, pattern altitude 1,700 ft) to C81 (Campbell; Class G).\n"
    "Aircraft: Piper PA-28-181 Archer, cruise 2,500 ft, 14 nm, 0 h 9 min en route, 1.6 gal planned.\n"
    "Adverse conditions along the route: G-AIRMET IFR, ceilings below 1,000 ft.",
]

TASKS = ("PA.I.C", "PA.I.D", "PA.I.E", "PA.I.F", "PA.I.H", "PA.VI.A", "PA.VI.B", "PA.VI.C")


def elements() -> list[dict]:
    """The cross-country tasks' knowledge and risk elements, each with its
    task's words, as the page sends them."""
    table = json.loads(ACS.read_text())
    out = []
    for code, words in table["elements"].items():
        task = ".".join(code.split(".")[:3])
        if task in TASKS and code.split(".")[3][0] in "KR":
            out.append({"code": code, "text": f"{table['tasks'][task]['task']}: {words}"[:400]})
    return out


def review(count: int, seed: int = 0) -> dict:
    """The questions, each asked once: its element, the flight, and what
    the examiner gave (or why it could not), with the sources' editions."""
    pool = elements()
    picked = random.Random(seed).sample(pool, min(count, len(pool)))
    items = []
    for n, focus in enumerate(picked, 1):
        plan = PLANS[(n - 1) % len(PLANS)]
        try:
            items.append({"n": n, "focus": focus, "plan": plan, **oral.ask(plan, [focus], [])})
        except oral.OralUnavailable as err:
            items.append({"n": n, "focus": focus, "plan": plan, "error": str(err)})
    return {
        "model": oral.ORAL_MODEL, "made": time.strftime("%Y-%m-%d"), "editions": oral.editions(), "items": items,
    }


def sheet(made: dict) -> str:
    """The review as Markdown, a question a section with a line for its mark."""
    lines = [
        "# Mock oral review",
        "",
        f"{len(made['items'])} questions from the mock oral ({made['model']}), {made['made']}. "
        f"Sources: {json.dumps(made['editions'])}.",
        "",
        "For each: is the question one an examiner would ask, is the answer right and complete at the private "
        "pilot level, and do the quotes support it? Mark it, and note what is wrong.",
        "",
    ]
    for q in made["items"]:
        if "error" in q:
            lines += [f"## {q['n']}. {q['focus']['code']}", "", f"Not asked: {q['error']}", ""]
            continue
        lines += [
            f"## {q['n']}. {q['acs_code']}", "",
            f"**The flight.** {q['plan'].splitlines()[0]}", "",
            f"**Question.** {q['question']}", "",
            f"**Answer.** {q['model_answer']}", "",
            "**Key points.** " + "; ".join(q["key_points"]), "",
            "**Quoted.**" + (" none survived the check: unsupported" if q["unsupported"] else ""),
            *[f"- {c['source']}: \u201c{c['quote']}\u201d" for c in q["citations"]], "",
            "**Mark.** Right / Partly / Wrong. Notes:", "", "---", "",
        ]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--count", type=int, default=12)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--out", type=Path, required=True, help="The Markdown sheet; its JSON beside it, as .json.")
    args = parser.parse_args()
    made = review(args.count, args.seed)
    args.out.write_text(sheet(made))
    args.out.with_suffix(".json").write_text(json.dumps(made, indent=1))
    print(f"wrote {args.out} and {args.out.with_suffix('.json')}")


if __name__ == "__main__":
    main()
