import { callEngine } from "../engine/engine";

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

/** JSON has no Infinity or NaN: an unlimited figure goes as the largest
 *  number, and NaN, which every bound passes as it passes Infinity, the
 *  same. */
function figure(x: number | null | undefined): number | null {
  if (x == null) return null;
  if (Number.isNaN(x) || x === Infinity) return Number.MAX_VALUE;
  return x === -Infinity ? -Number.MAX_VALUE : x;
}

/** The category a ceiling and a visibility fall in, by the FAA's own
 *  bounds (AIM 7-1-7, "Categorical Outlooks"; the worse of the two
 *  decides), worked out by the shared engine (native/engine/src/forecast,
 *  through lib/engine), the very rule the planner's modelled weather and
 *  the phones use: the bounds and their sources live there. No ceiling is
 *  no limit; with no visibility only a ceiling under 500 ft decides it,
 *  LIFR, and over that there is no category -- the visibility could still
 *  make it worse (a TAF period's read gave one, a METAR heard over FIS-B
 *  none). A METAR from the planner comes with its category; a TAF
 *  period's figures and a METAR's text read here do not. */
export function categoryOf(ceilingFt: number | null | undefined, visibilitySm: number | null | undefined): string | null {
  return callEngine<string | null>("flight_category", { ceiling_ft: figure(ceilingFt), visibility_sm: figure(visibilitySm) });
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
