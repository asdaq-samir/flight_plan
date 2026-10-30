import L from "leaflet";
import type { AirspaceVolume } from "../api/types";
import { BLUE, MAGENTA } from "../useAirspace";
import { text } from "./airportMark";
import type { TagSide } from "./declutter";
import { made } from "./icons";

type Class = AirspaceVolume["airspace_class"];

/**
 * The airspace's lines as the sectional draws them (FAA Aeronautical
 * Chart User's Guide, VFR Terms and Symbols, Airspace): Class B a solid
 * blue line, Class C solid magenta, Class D dashed blue. Constants, so a
 * path is never restyled for a new object (react-leaflet sets the style
 * again whenever pathOptions is one), and not a target: the wider
 * AIRSPACE_TAP over it takes the tap. A Class D's dash is a little longer
 * and its line whole and as heavy as a B's: at 2 px and .85 it was lost
 * in the chart's own dashed ring under it (the owner, 2026-10-29).
 */
export const AIRSPACE_LINE: Record<Class, L.PathOptions> = {
  B: { color: BLUE, weight: 2.5, opacity: 0.85, interactive: false },
  C: { color: MAGENTA, weight: 2.5, opacity: 0.85, interactive: false },
  D: { color: BLUE, weight: 2.75, opacity: 1, dashArray: "10 5", lineCap: "butt", interactive: false },
};

/** A volume's line as a finger meets it: unseen, 20 px wide over the line
 *  drawn, so a finger's 44 points across it (Apple's HIG) take in the
 *  line wherever they land on it, and a tap well off the line is still
 *  the chart's. Its class named, for the browser tests to find it. */
const tap = (airspaceClass: Class): L.PathOptions =>
  ({ color: "#000", weight: 20, opacity: 0, interactive: true, className: `airspace-tap-${airspaceClass}` });
export const AIRSPACE_TAP: Record<Class, L.PathOptions> = { B: tap("B"), C: tap("C"), D: tap("D") };

/** Where a VOR's tag sits beside its hexagon (declutter's vorTagSide). */
const TAG_SIDE: Record<TagSide, string> = { right: "left-[11px]", left: "right-[11px]", none: "hidden" };

/**
 * A VOR, VOR/DME or VORTAC: the chart's hexagon in blue on white, a dot
 * at its middle where the station is, and its ident on a blue tag beside
 * it -- to its right, as the chart's, or its left where an airport's mark
 * or own ship is on the right (`side`). Not a target.
 */
export const vorIcon = made(function vorIcon(ident: string, side: TagSide = "right") {
  return L.divIcon({
    className: "", iconSize: [0, 0], iconAnchor: [0, 0],
    html:
      `<span data-vor="${text(ident)}" class="pointer-events-none absolute left-0 top-0">` +
      `<svg class="absolute -left-2 -top-2" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">` +
      `<polygon points="15,8 11.5,14.06 4.5,14.06 1,8 4.5,1.94 11.5,1.94" fill="#fff" stroke="${BLUE}" stroke-width="2"/>` +
      `<circle cx="8" cy="8" r="1.6" fill="${BLUE}"/></svg>` +
      `<span data-vor-tag="${side}" class="absolute ${TAG_SIDE[side]} top-0 -translate-y-1/2 whitespace-nowrap rounded-[3px] px-1 text-[11px] font-bold leading-[14px] text-white"` +
      ` style="background:${BLUE}">${text(ident)}</span></span>`,
  });
});

/**
 * A fix of the low enroute chart: a small white triangle edged dark, as
 * the IFR charts draw an intersection, and its ident beside it with a
 * white halo to read over the chart. Not a target.
 */
export const enrouteFixIcon = made(function enrouteFixIcon(ident: string) {
  return L.divIcon({
    className: "", iconSize: [0, 0], iconAnchor: [0, 0],
    html:
      `<span data-fix="${text(ident)}" class="pointer-events-none absolute left-0 top-0">` +
      `<svg class="absolute -left-[5px] -top-[5px]" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">` +
      `<polygon points="5,1 9.4,8.8 0.6,8.8" fill="#fff" stroke="#1c1a17" stroke-width="1.2" stroke-linejoin="round"/></svg>` +
      `<span class="absolute left-[7px] top-0 -translate-y-1/2 whitespace-nowrap text-[11px] font-bold leading-[13px] text-[#1c1a17]` +
      ` [text-shadow:0_0_2px_#fff,0_0_2px_#fff,0_0_3px_#fff]">${text(ident)}</span></span>`,
  });
});
