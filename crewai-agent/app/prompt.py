"""The briefing prompt for a nav log the caller already has -- the same
facts, in the same words, nav-log-agent's graph puts in front of Claude
(see its briefing_prompt), so the two frameworks are compared on one
task rather than on two prompts. Kept as plain text here rather than
imported from nav-log-agent: the two images are built separately and
share only src/vfr."""

BRIEFING_WORDS = 200


def _format_legs(legs: list[dict]) -> str:
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
        f"Airspace/freezing-level/service-ceiling band: {sel['band_ceiling_ft']}ft",
    ]
    if sel.get("low_ceiling_or_visibility"):
        lines.append(
            f"GO/NO-GO: ceiling {sel['min_ceiling_ft']}ft / visibility {sel['min_visibility_sm']}SM "
            "near the route is below typical VFR minimums"
        )
    if sel.get("hazards"):
        lines.append(f"GO/NO-GO: {len(sel['hazards'])} SIGMET/AIRMET(s) intersect the route")
    return "\n".join(lines)


def briefing_prompt(departure_ident: str, destination_ident: str, nav_log: dict) -> str:
    return (
        f"Write a concise VFR pilot briefing, under {BRIEFING_WORDS} words, for a flight from "
        f"{departure_ident} to {destination_ident} at {float(nav_log['altitude_ft']):.0f}ft. "
        "Plain prose in short paragraphs -- no Markdown headings, bold or bullet lists; it is shown as plain text. "
        "Every number you need is below; do not look anything up.\n\n"
        f"Altitude selection:\n{_format_altitude_selection(nav_log.get('altitude_selection'))}\n\n"
        f"Dead-reckoning legs:\n{_format_legs(nav_log['legs'])}"
    )
