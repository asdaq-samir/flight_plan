"""The Brief's narrative: the nav log on the pilot's screen told in a
page of plain words by Claude, streamed as it is written
(app.routers.narrative).

The nav log is the one the page already shows -- the planner computed
it seconds earlier, and the pilot may have set an altitude of their own
-- so it is sent here whole rather than planned again, and the words are
about those numbers. Every number the model needs is in the prompt; it
is told not to look anything up.

This used to be two services, nav-log-agent (LangGraph, with a pgvector
memory of past briefings) and crewai-agent (CrewAI), kept to compare the
frameworks on one task. The task is one Claude call, so it is one call
here, with the SDK, as the planner's other Claude features are
(app.words, app.oral, app.assistant). The memory went with them: it
needed a local sentence-transformers model to embed each briefing, and a
briefing of the route on screen is written from its own figures, not
from another route's.
"""
from __future__ import annotations

import json
import logging
import os
from collections.abc import Iterator
from typing import Literal

import anthropic
from pydantic import BaseModel, ConfigDict, Field, model_validator

from .schemas import NarrativeDelta, NarrativeDone, NarrativeError

log = logging.getLogger(__name__)

# Haiku: on the C81 to KDLH route (2026-10-08) it wrote the whole
# briefing, three times out of three, for about $0.001 each, where
# claude-sonnet-5 spent $0.009 and wrote nothing (below). Named by the
# environment, as the planner's other models are.
NARRATIVE_MODEL = os.environ.get("NARRATIVE_MODEL", "claude-haiku-5-5")
# The model thinks before it writes, and the thinking counts toward this
# cap: at 512, claude-sonnet-5 thought until the cap and returned no
# text at all (stop reason max_tokens); Haiku at 1,536 did the same on
# two runs of three. At 4,096 every run finished, in 8 to 10 s. Thinking
# stays on: turned off, the same briefing read a 9,000 ft freezing level
# as "a serious icing risk" at 3,000 ft.
NARRATIVE_MAX_TOKENS = 4096
NARRATIVE_EFFORT = "low"

BRIEFING_WORDS = 200
#: A long cross-country is a few dozen legs; anything near this is not a
#: nav log, and every leg is prompt text Claude is billed for reading.
MAX_LEGS = 100

#: What the pilot reads when Claude cannot be asked: the reason itself
#: (its status, its request id) is the log's, not the pilot's.
UNREACHABLE = "The narrative cannot be written just now; the nav log and the briefing above are still right."


class NarrativeLeg(BaseModel):
    """What the prompt reads from one leg, checked before a word of it is
    sent. The rest of a nav-log leg (its wind, its true airspeed and
    density altitude, its fixes) is kept and read where the prompt has a
    use for it. A flyable leg (one with an ETE) needs its heading, ground
    speed and fuel; an unflyable one needs none of them."""

    model_config = ConfigDict(populate_by_name=True, extra="allow")

    from_: str = Field(alias="from", max_length=80)
    to: str = Field(max_length=80)
    distance_nm: float
    altitude_ft: float | None = None
    climb_min: float | None = None
    magnetic_heading_deg: float | None = None
    groundspeed_kt: float | None = None
    ete_min: float | None = None
    fuel_gal: float | None = None

    @model_validator(mode="after")
    def _flyable_legs_are_complete(self):
        if self.ete_min is not None and None in (self.magnetic_heading_deg, self.groundspeed_kt, self.fuel_gal):
            raise ValueError("a leg with an ETE needs its heading, ground speed and fuel")
        return self


class NarrativeRequest(BaseModel):
    """The nav log the Brief shows, to be told in words rather than
    recomputed. `aircraft_name` omitted means the planner's own default
    airplane. `flown`, when sent, says whose altitudes the legs fly:
    "custom" for the pilot's own, else the planner's plan of that name.
    `altitude_selection` is the planner's reasoning for the altitude
    (the nav log's own), read field by field below."""

    departure_ident: str = Field(max_length=10)
    destination_ident: str = Field(max_length=10)
    aircraft_name: str | None = Field(default=None, max_length=40)
    altitude_ft: float
    altitude_selection: dict | None = None
    flown: Literal["custom", "lowest", "highest", "fastest", "economical"] | None = None
    legs: list[NarrativeLeg] = Field(min_length=1, max_length=MAX_LEGS)

    def leg_dicts(self) -> list[dict]:
        """Each leg as it arrived, under its own key names ("from")."""
        return [leg.model_dump(by_alias=True) for leg in self.legs]


# --- The prompt --------------------------------------------------------------


def briefing_prompt(
    departure_ident: str,
    destination_ident: str,
    altitude_ft: float,
    altitude_selection: dict | None,
    legs: list[dict],
    *,
    flown: str | None = None,
) -> str:
    """The instruction Claude writes the briefing from: every number it
    needs, the altitude's reasoning and the legs. `flown` is
    NarrativeRequest's: whose altitudes the legs fly, said only when it
    is known."""
    prompt = (
        f"Write a concise VFR pilot briefing, under {BRIEFING_WORDS} words, for a flight from "
        f"{departure_ident} to {destination_ident} {_cruising(altitude_ft, legs)}. "
        "Plain prose in short paragraphs -- no Markdown headings, bold or bullet lists; it is shown as plain text. "
        "Every number you need is below; do not look anything up.\n\n"
        + (f"{_provenance(flown)}\n\n" if flown else "")
        + f"Altitude selection:\n{_format_altitude_selection(altitude_selection)}\n\n"
        f"Dead-reckoning legs:\n{_format_legs(legs)}"
    )
    # Said again last, after the data: claude-haiku-5-5 bolded its
    # headings with only the rule at the top (2026-10-08).
    return prompt + "\n\nWrite the briefing as plain text: no Markdown, so no ** or # anywhere."


def prompt_for(request: NarrativeRequest) -> str:
    return briefing_prompt(
        request.departure_ident, request.destination_ident, request.altitude_ft,
        request.altitude_selection, request.leg_dicts(), flown=request.flown,
    )


def _ft(value) -> str:
    return f"{float(value):,.0f}ft"


def _cruising(altitude_ft: float, legs: list[dict]) -> str:
    """The altitude the whole flight cruises at, when it has one. A plan
    steps from leg to leg -- under a Class B shelf, then up past it -- and
    naming the first leg's altitude as the flight's briefed a stepped plan
    as a level one; each leg's own is in its line."""
    altitudes = {leg["altitude_ft"] for leg in legs if leg.get("altitude_ft") is not None}
    if len(altitudes) > 1:
        return f"stepping between {_ft(min(altitudes))} and {_ft(max(altitudes))} (each leg's altitude is on its line)"
    return f"at {_ft(altitudes.pop() if altitudes else altitude_ft)}"


def _provenance(flown: str) -> str:
    """Whose altitudes the legs fly -- from the field that says so."""
    if flown == "custom":
        return "The altitude is the pilot's own, flown the whole way; the planner's reasoning below is what it would have chosen."
    return f"The altitudes are the planner's {flown} plan."


def _format_legs(legs: list[dict]) -> str:
    """One line per leg, at its own altitude, with the climb from the
    field where the leg has one, and the true airspeed it cruises at in
    its own air where the leg says (a planner leg does: the density
    altitude sets it). An unflyable leg (a headwind at or above cruise
    TAS -- ETE, fuel and groundspeed are None) is named as such rather
    than formatted as a number."""
    lines = []
    for leg in legs:
        where = f"{leg['from']} -> {leg['to']}: {leg['distance_nm']:.1f}nm"
        if leg.get("altitude_ft") is not None:
            where += f" at {_ft(leg['altitude_ft'])}"
        if leg.get("ete_min") is None:
            lines.append(f"- {where}, UNFLYABLE at this altitude (headwind at or above cruise TAS)")
            continue
        climb = f", climbing for {leg['climb_min']:.0f}min" if (leg.get("climb_min") or 0) > 0 else ""
        air = ""
        if leg.get("tas_kt") is not None:
            air = f", TAS {leg['tas_kt']:.0f}kt"
            if leg.get("density_altitude_ft") is not None:
                air += f" at density altitude {_ft(leg['density_altitude_ft'])}"
        lines.append(
            f"- {where}{climb}, heading {leg['magnetic_heading_deg']:.0f}M{air}, GS {leg['groundspeed_kt']:.0f}kt, "
            f"ETE {leg['ete_min']:.0f}min, fuel {leg['fuel_gal']:.1f}gal"
        )
    return "\n".join(lines)


def _format_altitude_selection(sel: dict | None) -> str:
    """The planner's reasoning, each fact from the field that owns it. The
    weather is a row per check -- could not be read, flagged, or fine --
    by `weather_unavailable`: a check that failed used to read as a check
    that found nothing, and a value that is None was printed as "Noneft".
    Without a selection there is nothing to say about it."""
    if not sel:
        return "(none given)"
    unavailable = set(sel.get("weather_unavailable") or [])
    band = sel.get("band_ceiling_ft")
    lines = [
        f"Terrain/obstacle floor: {_ft(sel['floor_ft'])}",
        f"Airspace/service-ceiling/cloud band: {_ft(band) if band is not None else 'no ceiling below Class A'}",
    ]
    if sel.get("service_ceiling_ft") is not None:
        lines.append(f"Service ceiling in the forecast temperatures (a density altitude): {_ft(sel['service_ceiling_ft'])}")
    if sel.get("cloud_clearance_kept") is False:
        lines.append(
            f"CLOUD CLEARANCE NOT POSSIBLE (14 CFR 91.155): the clouds forecast near {sel.get('cloud_station')} "
            "leave no VFR altitude on some legs, and the altitudes there leave them out"
        )
    elif sel.get("cloud_base_ft") is not None and sel.get("cloud_ceiling_ft") is not None:
        lines.append(
            f"Cloud clearance (14 CFR 91.155): clouds forecast at {_ft(sel['cloud_base_ft'])} MSL near "
            f"{sel.get('cloud_station')}, so no altitude above {_ft(sel['cloud_ceiling_ft'])}"
        )

    if "freezing_level" in unavailable:
        lines.append("Icing: UNKNOWN -- the freezing level could not be read")
    elif sel.get("icing_possible"):
        level = sel.get("freezing_level_ft")
        where = ""
        if level is not None:
            where = f"at or below {_ft(level)}" if sel.get("freezing_level_at_or_below") else f"at {_ft(level)}"
        lines.append(f"ICING POSSIBLE: freezing level {where}, with cloud or an icing AIRMET forecast along the route")
    else:
        lines.append("Icing: not expected")

    if "ceiling_visibility" in unavailable:
        lines.append("Ceiling/visibility: UNKNOWN -- the forecast along the route could not be read")
    elif sel.get("low_ceiling_or_visibility"):
        parts = []
        if sel.get("min_ceiling_ft") is not None:
            parts.append(f"ceiling {_ft(sel['min_ceiling_ft'])}")
        if sel.get("min_visibility_sm") is not None:
            parts.append(f"visibility {sel['min_visibility_sm']:g}SM")
        lines.append(f"GO/NO-GO: forecast {' / '.join(parts)} near the route is below typical VFR minimums")
    else:
        lines.append("Ceiling/visibility: at or above VFR minimums along the route")

    if "hazards" in unavailable:
        lines.append("SIGMETs: UNKNOWN -- they could not be checked")
    elif sel.get("hazards"):
        lines.append(f"GO/NO-GO: {len(sel['hazards'])} SIGMET/AIRMET(s) intersect the route")
    else:
        lines.append("SIGMETs: none on the route")

    if "special_use" in unavailable:
        lines.append("Special-use airspace: UNKNOWN -- it could not be checked")
    return "\n".join(lines)


# --- The call ----------------------------------------------------------------


def _client() -> anthropic.Anthropic:
    """The seam the tests stand a fake model in at."""
    return anthropic.Anthropic()


def _line(message: BaseModel) -> str:
    return json.dumps(message.model_dump(), ensure_ascii=False) + "\n"


def stream(request: NarrativeRequest) -> Iterator[str]:
    """The briefing as newline-delimited JSON: a `delta` line for each
    piece of text as Claude writes it, then a `done` line with the whole
    briefing, or an `error` line saying why there is none. Thinking
    blocks are not part of text_stream, so nothing here skips them.

    A briefing cut off at the token cap ends in an error, not a `done`:
    it can stop before its weather or its icing, and shown whole a pilot
    would take it as whole."""
    parts: list[str] = []
    try:
        with _client().messages.stream(
            model=NARRATIVE_MODEL,
            max_tokens=NARRATIVE_MAX_TOKENS,
            output_config={"effort": NARRATIVE_EFFORT},
            messages=[{"role": "user", "content": prompt_for(request)}],
        ) as said:
            for text in said.text_stream:
                parts.append(text)
                yield _line(NarrativeDelta(text=text))
            stop_reason = said.get_final_message().stop_reason
    except anthropic.AnthropicError as err:
        # No key, a refused one, no network, a limit: the reason is the
        # log's (CodeQL's py/stack-trace-exposure), the pilot's is plain.
        log.warning("narrative unreachable: %s", err)
        yield _line(NarrativeError(detail=UNREACHABLE))
        return
    briefing = "".join(parts).strip()
    if stop_reason == "max_tokens":
        yield _line(NarrativeError(detail="The narrative ran out of room before it was finished; ask again."))
    elif stop_reason == "refusal":
        yield _line(NarrativeError(detail="The narrative was declined for this flight."))
    elif not briefing:
        yield _line(NarrativeError(detail="The narrative came back empty; ask again."))
    else:
        yield _line(NarrativeDone(briefing=briefing))
