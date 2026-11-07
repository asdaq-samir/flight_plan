/** A line's look: its ink, width, opacity and dash (the card's swatch). */
export interface LineLook { color: string; weight: number; opacity: number; dashArray?: string; lineCap?: "butt" | "round"; interactive?: boolean }
import type { AirspaceVolume } from "../api/types";

type Class = AirspaceVolume["airspace_class"];

/** The airspace lines' own inks, as ForeFlight draws its Class B and C
 *  over the same sectional (the owner's screenshot, 2026-10-30): a light
 *  sky blue and a clear magenta, which stand off the chart's darker
 *  printed blue they lie on, where a line in that blue sank into it. */
const AIRSPACE_BLUE = "#4b9df8";
const AIRSPACE_MAGENTA = "#c43fc0";

/**
 * The airspace's lines as the sectional draws them (FAA Aeronautical
 * Chart User's Guide, VFR Terms and Symbols, Airspace): Class B a solid
 * blue line, Class C solid magenta, Class D dashed blue. Constants, so a
 * path is never restyled for a new object (react-leaflet sets the style
 * again whenever pathOptions is one), and not a target: a tap is the
 * map's own click, given to the nearest line (AirspaceLayer). A Class D's dash is a little longer
 * and its line whole and as heavy as a B's: at 2 px and .85 it was lost
 * in the chart's own dashed ring under it (the owner, 2026-10-29).
 */
export const AIRSPACE_LINE: Record<Class, LineLook> = {
  // ForeFlight's inks (above), a little heavier than the chart's own: in
  // the chart's blue the line sank into the printed ring under it
  // ("airspace blue is hard to see", the owner, 2026-10-30).
  B: { color: AIRSPACE_BLUE, weight: 3, opacity: 0.95, interactive: false },
  C: { color: AIRSPACE_MAGENTA, weight: 3, opacity: 0.95, interactive: false },
  D: { color: AIRSPACE_BLUE, weight: 3, opacity: 0.95, dashArray: "10 5", lineCap: "butt", interactive: false },
};
