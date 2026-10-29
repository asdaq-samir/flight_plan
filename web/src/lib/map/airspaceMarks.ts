import L from "leaflet";
import type { AirspaceVolume } from "../api/types";
import { BLUE, MAGENTA } from "../useAirspace";
import type { AirspaceLabel } from "./airspaceLabel";
import { text } from "./airportMark";
import { made } from "./icons";

type Class = AirspaceVolume["airspace_class"];

/**
 * The airspace's lines as the sectional draws them (FAA Aeronautical
 * Chart User's Guide, VFR Terms and Symbols, Airspace): Class B a solid
 * blue line, Class C solid magenta, Class D dashed blue. Constants, so a
 * path is never restyled for a new object (react-leaflet sets the style
 * again whenever pathOptions is one), and not a target: a tap on a line
 * is the chart's under it.
 */
export const AIRSPACE_LINE: Record<Class, L.PathOptions> = {
  B: { color: BLUE, weight: 2.5, opacity: 0.85, interactive: false },
  C: { color: MAGENTA, weight: 2.5, opacity: 0.85, interactive: false },
  D: { color: BLUE, weight: 2, opacity: 0.85, dashArray: "7 5", lineCap: "butt", interactive: false },
};

/** The labels' words, the line's colour a shade darker, to read 4.5:1 or
 *  more on their white plate (WCAG's for small type). */
const INK: Record<Class, string> = { B: "#1b4f94", C: "#9a1f7e", D: "#1b4f94" };

/** The white plate under a label, a little of the chart through it. */
const PLATE = "rgba(255,255,255,.92)";

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

/**
 * A VOR, VOR/DME or VORTAC: the chart's hexagon in blue on white, a dot
 * at its middle where the station is, and its ident on a blue tag beside
 * it. Not a target.
 */
export const vorIcon = made(function vorIcon(ident: string) {
  return L.divIcon({
    className: "", iconSize: [0, 0], iconAnchor: [0, 0],
    html:
      `<span data-vor="${text(ident)}" class="pointer-events-none absolute left-0 top-0">` +
      `<svg class="absolute -left-2 -top-2" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">` +
      `<polygon points="15,8 11.5,14.06 4.5,14.06 1,8 4.5,1.94 11.5,1.94" fill="#fff" stroke="${BLUE}" stroke-width="2"/>` +
      `<circle cx="8" cy="8" r="1.6" fill="${BLUE}"/></svg>` +
      `<span class="absolute left-[11px] top-0 -translate-y-1/2 whitespace-nowrap rounded-[3px] px-1 text-[10px] font-bold leading-[14px] text-white"` +
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
      `<span class="absolute left-[7px] top-0 -translate-y-1/2 whitespace-nowrap text-[10px] font-bold leading-none text-[#1c1a17]` +
      ` [text-shadow:0_0_2px_#fff,0_0_2px_#fff,0_0_3px_#fff]">${text(ident)}</span></span>`,
  });
});
