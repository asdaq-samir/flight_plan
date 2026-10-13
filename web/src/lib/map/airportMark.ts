import type { AirspaceClass } from "../preferences";
import { BLUE, MAGENTA } from "../useAirspace";

// Apart from icons.ts, which holds Leaflet: Nearest's rows draw the
// mark too, and so would have kept Leaflet in the page's first script.

/** Anything interpolated into the markup here or in icons.ts is a chart colour or an
 *  airport ident, but it comes from the planner rather than from here,
 *  so it is escaped like any other untrusted text. */
export function text(value: string | number): string {
  return String(value).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** An airport mark's symbol across (airportMarkIcon). */
export const AIRPORT_MARK = 26;

/** The sectional's ink for a mark whose class is not known yet. */
const UNKNOWN_GREY = "#6b7280";

/** The mark itself, as an SVG's markup (airportMarkIcon's, without the
 *  ident beside it): the same symbol off the map, as Nearest's rows lead
 *  with it. */
export function airportMarkSvg(space: AirspaceClass | null, weather: string, use: "military" | "private" | null, className: string): string {
  const blue = space === "B" || space === "D";
  const ink = space ? (blue ? BLUE : MAGENTA) : UNKNOWN_GREY;
  const casing = `stroke="#fff" stroke-linecap="round"`;
  const symbol = use
    ? `<circle r="10" fill="${use === "military" ? BLUE : MAGENTA}" ${casing} stroke-width="2"/>` +
      `<text y="4" text-anchor="middle" font-size="11" font-weight="800" fill="#fff">${use === "military" ? "M" : "R"}</text>` +
      `<circle data-weather="" cx="7.5" cy="7.5" r="4.6" fill="${text(weather)}" ${casing} stroke-width="1.4"/>`
    : (() => {
      // The four ticks, and the white casing round ticks and ring, each one
      // path: drawn as eight lines and a circle they were eleven elements a
      // mark, and the opening map's 131 marks were 1,800 of the page's
      // 2,000 elements, each restyled at every change of the page's styles
      // (measured 2026-10-11). The same shapes, strokes and caps.
      const ticks = "M0 -9V-12.2M9 0H12.2M0 9V12.2M-9 0H-12.2";
      const ring = "M-8.5 0a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0 -17 0";
      const dashed = space === "D" || space === "E";
      // At the owner's asks ("Airport symbols should have rings around
      // them so it's easier to tell the airspace"; "just the metar dot is
      // not easy to see"; of a sheet of designs, "option E"): a thin ring
      // that is the airspace, in the sectional's own code -- Class B and D
      // blue, C and E magenta, D and E dashed as their boundaries are
      // drawn (FAA Aeronautical Chart User's Guide, Airspace), B's ring
      // the thickest and C's next, as the sectional's solid Class B and C
      // lines are the heaviest of its airspace lines (the owner's asks,
      // "Can class B ring for symbol be thicker?", "Also make class C ring
      // thicker"), G the same magenta as C but thin and faded, at the
      // owner's ask ("C and G should have the same magenta color. The only
      // difference is that G is faded vs C is solid and bold") -- with its
      // ticks, white inside it, and a large disc in the field's weather
      // colour in the middle, readable at a glance.
      const thin = space === "G" || !space;
      const width = space === "B" ? 3.2 : space === "C" ? 2.8 : thin ? 1.6 : 2.2;
      const faded = space === "G" ? ` stroke-opacity="0.45"` : "";
      return `<path d="${ticks}${ring}" fill="#fff" ${casing} stroke-width="5.5"/>` +
        `<path d="${ticks}" fill="none" stroke="${ink}"${faded} stroke-width="2.5" stroke-linecap="round"/>` +
        `<circle r="8.5" fill="#fff" stroke="${ink}"${faded} stroke-width="${width}"${dashed ? ` stroke-dasharray="3.4 2.1"` : ""}/>` +
        `<circle data-weather="" r="6" fill="${text(weather)}"/>`;
    })();
  const half = AIRPORT_MARK / 2;
  return `<svg data-airport-mark="" data-airspace="${space ?? ""}"${use ? ` data-use="${use}"` : ""} aria-hidden="true" class="${className}"` +
    ` width="${AIRPORT_MARK}" height="${AIRPORT_MARK}" viewBox="${-half} ${-half} ${AIRPORT_MARK} ${AIRPORT_MARK}">${symbol}</svg>`;
}
