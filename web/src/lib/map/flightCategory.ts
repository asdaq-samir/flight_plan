/** The FAA's own categories, in the colours a pilot already reads them
 *  in: green good, blue marginal, red instrument, magenta worse than
 *  that. Grey where the field filed no report -- which is not "fine",
 *  it is "unknown", and it must not look like the green one.
 *
 *  The one map of them on the page: every marker that colours itself
 *  by current weather (Class B airports, and the route's own departure
 *  and destination) and the briefing's METAR badges. */
const CATEGORY_COLOURS: Record<string, string> = {
  VFR: "#1a7f37",
  MVFR: "#1f6feb",
  IFR: "#b3261e",
  LIFR: "#a371f7",
};
const UNKNOWN_COLOUR = "#8fa3b0";

/** The category a ceiling and a visibility fall in, by the FAA's own
 *  bounds (AIM 7-1-7, "Categorical Outlooks"; the worse of the two
 *  decides): LIFR "ceiling less than 500 feet and/or visibility less
 *  than 1 mile", IFR 500 to less than 1,000 ft or 1 to less than 3,
 *  MVFR "1,000 to 3,000 feet and/or visibility 3 to 5 miles inclusive",
 *  VFR above both -- statute miles, as US reports give visibility. No
 *  ceiling is no limit. With no visibility only a ceiling under 500 ft
 *  decides it, LIFR whatever the visibility is: over that the visibility
 *  could still make it worse, and a category said then is a guess (a TAF
 *  period's read gave one, a METAR heard over FIS-B none). A METAR from
 *  the planner comes with its category; a TAF period's figures and a
 *  METAR's text read here do not. */
export function categoryOf(ceilingFt: number | null | undefined, visibilitySm: number | null | undefined): string | null {
  const ceiling = ceilingFt ?? Infinity;
  if (visibilitySm == null) return ceiling < 500 ? "LIFR" : null;
  if (ceiling < 500 || visibilitySm < 1) return "LIFR";
  if (ceiling < 1000 || visibilitySm < 3) return "IFR";
  if (ceiling <= 3000 || visibilitySm <= 5) return "MVFR";
  return "VFR";
}

export function colourOf(category: string | null | undefined): string {
  return (category && CATEGORY_COLOURS[category]) || UNKNOWN_COLOUR;
}

/** A chip's colour for what is known of a field's weather: its category
 *  once there is a report, grey while checking, when it could not be
 *  checked, and when the field has no report. */
export function chipColourOf(weather: { status: string; category: string | null } | null | undefined): string {
  return colourOf(weather?.status === "reported" ? weather.category : null);
}
