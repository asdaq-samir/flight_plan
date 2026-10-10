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
      `<circle data-weather="" cx="8" cy="8" r="3.4" fill="${text(weather)}" ${casing} stroke-width="1.4"/>`
    : (() => {
      const ticks = [[0, -8.5, 0, -12], [8.5, 0, 12, 0], [0, 8.5, 0, 12], [-8.5, 0, -12, 0]]
        .map(([x1, y1, x2, y2]) => `x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"`);
      const filled = space === "B" || space === "C";
      const dashed = space === "D" || space === "E";
      return ticks.map(t => `<line ${t} ${casing} stroke-width="5"/>`).join("") +
        `<circle r="8" fill="#fff" ${casing} stroke-width="5"/>` +
        ticks.map(t => `<line ${t} stroke="${ink}" stroke-width="2.5" stroke-linecap="round"/>`).join("") +
        `<circle r="8" fill="${filled ? ink : "#fff"}" stroke="${ink}" stroke-width="${space === "G" ? 1.6 : 2.5}"${dashed ? ` stroke-dasharray="3.1 2"` : ""}/>` +
        `<circle data-weather="" r="3.6" fill="${text(weather)}" ${casing} stroke-width="1.4"/>`;
    })();
  const half = AIRPORT_MARK / 2;
  return `<svg data-airport-mark="" data-airspace="${space ?? ""}"${use ? ` data-use="${use}"` : ""} aria-hidden="true" class="${className}"` +
    ` width="${AIRPORT_MARK}" height="${AIRPORT_MARK}" viewBox="${-half} ${-half} ${AIRPORT_MARK} ${AIRPORT_MARK}">${symbol}</svg>`;
}
