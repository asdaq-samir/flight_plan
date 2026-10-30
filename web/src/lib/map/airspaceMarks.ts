import L from "leaflet";
import type { AirspaceVolume } from "../api/types";
import { BLUE } from "../useAirspace";
import type { AirspaceLabel } from "./airspaceLabel";
import { text } from "./airportMark";
import type { TagSide } from "./declutter";
import { made } from "./icons";

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
 * again whenever pathOptions is one), and not a target: the wider
 * AIRSPACE_TAP over it takes the tap. A Class D's dash is a little longer
 * and its line whole and as heavy as a B's: at 2 px and .85 it was lost
 * in the chart's own dashed ring under it (the owner, 2026-10-29).
 */
export const AIRSPACE_LINE: Record<Class, L.PathOptions> = {
  // ForeFlight's inks (above), a little heavier than the chart's own: in
  // the chart's blue the line sank into the printed ring under it
  // ("airspace blue is hard to see", the owner, 2026-10-30).
  B: { color: AIRSPACE_BLUE, weight: 3, opacity: 0.95, interactive: false },
  C: { color: AIRSPACE_MAGENTA, weight: 3, opacity: 0.95, interactive: false },
  D: { color: AIRSPACE_BLUE, weight: 3, opacity: 0.95, dashArray: "10 5", lineCap: "butt", interactive: false },
};

/** A volume's line as a finger meets it: unseen, 20 px wide over the line
 *  drawn, so a finger's 44 points across it (Apple's HIG) take in the
 *  line wherever they land on it, and a tap well off the line is still
 *  the chart's. Its class named, for the browser tests to find it. */
const tap = (airspaceClass: Class): L.PathOptions =>
  ({ color: "#000", weight: 20, opacity: 0, interactive: true, className: `airspace-tap-${airspaceClass}` });
export const AIRSPACE_TAP: Record<Class, L.PathOptions> = { B: tap("B"), C: tap("C"), D: tap("D") };

/** The labels' words, the line's colour a shade darker on the white
 *  plate by day and lighter on the dark one at night (index.css), to read
 *  4.5:1 or more either way (WCAG's for small type). */
const INK: Record<Class, string> = { B: "var(--airspace-blue-ink)", C: "var(--airspace-magenta-ink)", D: "var(--airspace-blue-ink)" };

/** The plate under a label, a little of the chart through it: white by
 *  day, the sheet's dark at night, where a white one was the brightest
 *  thing over the dimmed chart (the owner's screenshot, 2026-10-29). */
const PLATE = "var(--airspace-plate)";

/**
 * A volume's altitudes on the chart (lib/map/airspaceLabel), centred on
 * its point: a Class B or C shelf's top over its floor with a rule
 * between, a Class D's ceiling in a dashed box, each on a white plate in
 * bold. Not a target.
 */
export const airspaceLabelIcon = made(function airspaceLabelIcon(label: AirspaceLabel, airspaceClass: Class) {
  const ink = INK[airspaceClass];
  const at = "pointer-events-none absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2 text-[11px] font-bold tabular-nums";
  const html = label.kind === "shelf"
    ? `<span data-airspace-label="${airspaceClass}" class="${at} inline-flex flex-col items-center rounded-[4px] px-1 py-px leading-[12px]"` +
      ` style="color:${ink};background:${PLATE}">` +
      `<span>${text(label.top)}</span><span class="my-px h-px self-stretch" style="background:${ink}"></span><span>${text(label.floor)}</span></span>`
    : `<span data-airspace-label="${airspaceClass}" class="${at} whitespace-nowrap rounded-[3px] border-[1.5px] border-dashed px-1 leading-[14px]"` +
      ` style="color:${ink};border-color:${BLUE};background:${PLATE}">${text(label.ceiling)}</span>`;
  return L.divIcon({ className: "", iconSize: [0, 0], iconAnchor: [0, 0], html });
});

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
