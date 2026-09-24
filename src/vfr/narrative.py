"""What both narrative agents write from: the nav log they are handed
(NarrativeRequest) and the one prompt they turn it into.

nav-log-agent (LangGraph) and crewai-agent (CrewAI) exist to compare two
frameworks on the same task, so they must be given the same task: the
same request, checked the same way, and the same words in front of
Claude. Each used to keep its own copy of both -- the prompt's leg and
altitude formatting word for word in two files, the request model in two
servers -- which is two chances for the comparison to stop being fair.

Here, beside vfr.planner_client, because both agents already import vfr
for that and nothing else. Unlike the rest of vfr this needs pydantic,
which both agents install through their own frameworks (mcp, fastapi);
nothing else imports this module.
"""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

BRIEFING_WORDS = 200
#: A long cross-country is a few dozen legs; anything near this is not a
#: nav log, and every leg is prompt text Claude is billed for reading.
MAX_LEGS = 100


class NarrativeLeg(BaseModel):
    """What the prompt reads from one leg, checked before a word of it
    is sent. Other fields a nav-log leg carries are allowed and ignored.
    A flyable leg (an ETE) needs its heading, ground speed and fuel; an
    unflyable one needs none of them."""

    model_config = ConfigDict(populate_by_name=True)

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
    """The nav log the flight planning drawer already shows, handed to an
    agent to write about rather than to recompute -- what the webapp's
    /api/comparison forwards untouched. `aircraft_name` omitted means the
    planner's own default aeroplane. `flown`, when sent, says which
    altitudes the legs fly: "custom" for the pilot's own, else the
    planner's plan of that name.

    A field it does not know is refused, not dropped: the two frameworks
    are compared on the same input, and one that quietly ignored a field
    the other read would be narrating a different nav log with nothing
    to show for it."""

    model_config = ConfigDict(extra="forbid")

    departure_ident: str = Field(max_length=10)
    destination_ident: str = Field(max_length=10)
    aircraft_name: str | None = Field(default=None, max_length=40)
    altitude_ft: float
    altitude_selection: dict | None = None
    flown: Literal["custom", "lowest", "highest", "fastest"] | None = None
    legs: list[dict] = Field(min_length=1, max_length=MAX_LEGS)

    @field_validator("legs")
    @classmethod
    def _legs_are_legs(cls, legs: list[dict]) -> list[dict]:
        """Each leg is checked against NarrativeLeg and kept as the dict
        it arrived as, which is what both agents' prompts read."""
        for leg in legs:
            NarrativeLeg.model_validate(leg)
        return legs


def invalid_detail(err: Exception) -> str:
    """The one 422 `detail` both agents answer a bad NarrativeRequest with,
    naming each field and what was wrong -- nav-log-agent's own, which
    crewai-agent's FastAPI list-of-errors used to differ from. `err` is a
    pydantic ValidationError, FastAPI's RequestValidationError (whose
    locations start at "body") or the ValueError of a body that is not
    JSON."""
    errors = err.errors() if hasattr(err, "errors") else []
    if not errors or any(e.get("type") == "json_invalid" for e in errors):
        return "invalid nav log: the request body is not JSON"
    parts = []
    for e in errors:
        loc = [str(part) for part in e["loc"]]
        if loc[:1] == ["body"]:
            loc = loc[1:]
        parts.append(f"{'.'.join(loc)}: {e['msg']}")
    return "invalid nav log: " + "; ".join(parts)


def briefing_prompt(
    departure_ident: str,
    destination_ident: str,
    altitude_ft: float,
    altitude_selection: dict | None,
    legs: list[dict],
    similar_briefings: list[dict] | None = None,
    *,
    flown: str | None = None,
) -> str:
    """The instruction both agents hand Claude. `similar_briefings`, the
    past briefings nav-log-agent's pgvector memory found, adds them as
    precedent; crewai-agent keeps no memory and leaves it out. `flown` is
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
    if similar_briefings is not None:
        prompt += (
            "\n\nSimilar past route briefings (for context/consistency, not to copy verbatim):\n"
            f"{_format_memory(similar_briefings)}"
        )
    return prompt


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
    """Whose altitudes the legs fly -- from the field that says so. The
    prompt used to guess it from whether a selection was sent."""
    if flown == "custom":
        return "The altitude is the pilot's own, flown the whole way; the planner's reasoning below is what it would have chosen."
    return f"The altitudes are the planner's {flown} plan."


def _format_legs(legs: list[dict]) -> str:
    """One line per leg, at its own altitude, with the climb from the
    field where the leg has one. An unflyable leg (a headwind at or above
    cruise TAS -- ETE, fuel and groundspeed are None) is named as such
    rather than formatted as a number."""
    lines = []
    for leg in legs:
        where = f"{leg['from']} -> {leg['to']}: {leg['distance_nm']:.1f}nm"
        if leg.get("altitude_ft") is not None:
            where += f" at {_ft(leg['altitude_ft'])}"
        if leg.get("ete_min") is None:
            lines.append(f"- {where}, UNFLYABLE at this altitude (headwind at or above cruise TAS)")
            continue
        climb = f", climbing for {leg['climb_min']:.0f}min" if (leg.get("climb_min") or 0) > 0 else ""
        lines.append(
            f"- {where}{climb}, heading {leg['magnetic_heading_deg']:.0f}M, GS {leg['groundspeed_kt']:.0f}kt, "
            f"ETE {leg['ete_min']:.0f}min, fuel {leg['fuel_gal']:.1f}gal"
        )
    return "\n".join(lines)


def _format_altitude_selection(sel: dict | None) -> str:
    """The planner's reasoning, each fact from the field that owns it. The
    weather is a row per check -- could not be read, flagged, or fine --
    by `weather_unavailable`: a check that failed used to read as a check
    that found nothing, and a value that is None was printed as "Noneft".
    Without a selection there is nothing to say about it; this used to
    claim the pilot had typed the altitude, which nothing told it."""
    if not sel:
        return "(none given)"
    unavailable = set(sel.get("weather_unavailable") or [])
    band = sel.get("band_ceiling_ft")
    lines = [
        f"Terrain/obstacle floor: {_ft(sel['floor_ft'])}",
        f"Airspace/service-ceiling band: {_ft(band) if band is not None else 'no ceiling below Class A'}",
    ]

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


def _format_memory(similar_briefings: list[dict]) -> str:
    if not similar_briefings:
        return "(no similar past routes yet)"
    return "\n".join(
        f"- {b['departure_ident']}->{b['destination_ident']}: {b['briefing'][:200]}" for b in similar_briefings
    )
