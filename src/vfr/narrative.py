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
    planner's own default aeroplane; `altitude_selection` is null when the
    pilot typed the altitude."""

    departure_ident: str = Field(max_length=10)
    destination_ident: str = Field(max_length=10)
    aircraft_name: str | None = Field(default=None, max_length=40)
    altitude_ft: float
    altitude_selection: dict | None = None
    legs: list[dict] = Field(min_length=1, max_length=MAX_LEGS)

    @field_validator("legs")
    @classmethod
    def _legs_are_legs(cls, legs: list[dict]) -> list[dict]:
        """Each leg is checked against NarrativeLeg and kept as the dict
        it arrived as, which is what both agents' prompts read."""
        for leg in legs:
            NarrativeLeg.model_validate(leg)
        return legs


def briefing_prompt(
    departure_ident: str,
    destination_ident: str,
    altitude_ft: float,
    altitude_selection: dict | None,
    legs: list[dict],
    similar_briefings: list[dict] | None = None,
) -> str:
    """The instruction both agents hand Claude. `similar_briefings`, the
    past briefings nav-log-agent's pgvector memory found, adds them as
    precedent; crewai-agent keeps no memory and leaves it out."""
    prompt = (
        f"Write a concise VFR pilot briefing, under {BRIEFING_WORDS} words, for a flight from "
        f"{departure_ident} to {destination_ident} at {float(altitude_ft):.0f}ft. "
        "Plain prose in short paragraphs -- no Markdown headings, bold or bullet lists; it is shown as plain text. "
        "Every number you need is below; do not look anything up.\n\n"
        f"Altitude selection:\n{_format_altitude_selection(altitude_selection)}\n\n"
        f"Dead-reckoning legs:\n{_format_legs(legs)}"
    )
    if similar_briefings is not None:
        prompt += (
            "\n\nSimilar past route briefings (for context/consistency, not to copy verbatim):\n"
            f"{_format_memory(similar_briefings)}"
        )
    return prompt


def _format_legs(legs: list[dict]) -> str:
    """One line per leg. An unflyable leg (a headwind at or above cruise
    TAS -- ETE, fuel and groundspeed are None) is named as such rather
    than formatted as a number."""
    lines = []
    for leg in legs:
        if leg.get("ete_min") is None:
            lines.append(
                f"- {leg['from']} -> {leg['to']}: {leg['distance_nm']:.1f}nm, "
                "UNFLYABLE at this altitude (headwind at or above cruise TAS)"
            )
            continue
        lines.append(
            f"- {leg['from']} -> {leg['to']}: {leg['distance_nm']:.1f}nm, "
            f"heading {leg['magnetic_heading_deg']:.0f}M, GS {leg['groundspeed_kt']:.0f}kt, "
            f"ETE {leg['ete_min']:.0f}min, fuel {leg['fuel_gal']:.1f}gal"
        )
    return "\n".join(lines)


def _format_altitude_selection(sel: dict | None) -> str:
    if not sel:
        return "(the pilot set this altitude by hand; nothing was auto-selected)"
    lines = [
        f"Terrain/obstacle floor: {sel['floor_ft']:.0f}ft",
        f"Airspace/service-ceiling band: {sel['band_ceiling_ft']}ft",
    ]
    if sel.get("icing_possible"):
        level = sel.get("freezing_level_ft")
        where = (f"at or below {level:.0f}ft" if sel.get("freezing_level_at_or_below") else f"at {level:.0f}ft") if level else ""
        lines.append(f"ICING POSSIBLE: freezing level {where}, with cloud or an icing AIRMET forecast along the route")
    if sel.get("low_ceiling_or_visibility"):
        lines.append(
            f"GO/NO-GO: ceiling {sel['min_ceiling_ft']}ft / visibility {sel['min_visibility_sm']}SM "
            "near the route is below typical VFR minimums"
        )
    if sel.get("hazards"):
        lines.append(f"GO/NO-GO: {len(sel['hazards'])} SIGMET/AIRMET(s) intersect the route")
    return "\n".join(lines)


def _format_memory(similar_briefings: list[dict]) -> str:
    if not similar_briefings:
        return "(no similar past routes yet)"
    return "\n".join(
        f"- {b['departure_ident']}->{b['destination_ident']}: {b['briefing'][:200]}" for b in similar_briefings
    )
