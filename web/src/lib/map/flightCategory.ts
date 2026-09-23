/** The FAA's own categories, in the colours a pilot already reads them
 *  in: green good, blue marginal, red instrument, magenta worse than
 *  that. Grey where the field filed no report -- which is not "fine",
 *  it is "unknown", and it must not look like the green one.
 *
 *  Shared by every marker that colours itself by current weather --
 *  Class B airports and, since they carry a live METAR too, the
 *  route's own departure and destination. */
const CATEGORY_COLOURS: Record<string, string> = {
  VFR: "#1a7f37",
  MVFR: "#1f6feb",
  IFR: "#b3261e",
  LIFR: "#a371f7",
};
const UNKNOWN_COLOUR = "#8fa3b0";

export function colourOf(category: string | null | undefined): string {
  return (category && CATEGORY_COLOURS[category]) || UNKNOWN_COLOUR;
}

export function feet(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${Math.round(value).toLocaleString()} ft`;
}

export function miles(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${value} sm`;
}
