import L from "leaflet";
import { inkOn } from "../scoreScale";

/**
 * Leaflet's div icons take HTML, so these are HTML -- the same Tailwind
 * classes as the rest of the page, in template strings.
 *
 * Written as JSX and rendered with `renderToStaticMarkup` until it was
 * measured: that one import put the whole of `react-dom/server` (about
 * 200 kB, a second copy of the renderer) into the chunk every page
 * loads, to produce four spans. `className: ""` on each suppresses
 * Leaflet's default `.leaflet-div-icon` box (white fill, grey border),
 * since each draws its own.
 */

/** Anything interpolated into the markup above is a chart colour or an
 *  airport ident, but it comes from the planner rather than from here,
 *  so it is escaped like any other untrusted text. */
function text(value: string | number): string {
  return String(value).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/**
 * A marker with three edges: a white casing to separate it from dark
 * linework, a dark hairline outside that so it still separates from pale
 * paper, and a shadow to lift it off both. One edge is never enough on a
 * chart this busy.
 */
export function dotIcon(fill: string, label?: string | number) {
  const withLabel = label !== undefined;
  // The tap target (iconSize) is bigger than the visual dot on purpose --
  // a 20px dot is well under a comfortable touch target, but making the
  // dot itself that big would make dense stretches of route hard to read.
  // Centering it in a larger invisible box needs `position: absolute` +
  // a transform, not a flex wrapper: Leaflet's own stylesheet sets
  // `.leaflet-marker-icon { display: block }`, which wins the cascade
  // over a `flex` utility class of the same specificity.
  const tapSize = withLabel ? 36 : 32;
  // leading-none and text-[11px]: a circle has less usable width near
  // its edges than a square of the same size, so bold digits (a
  // route's checkpoint count runs to three) need real headroom to stay
  // inside the curve, and a browser's own line-height slack would sit
  // the number off-centre. 11px is Apple's floor for text meant to be
  // read; these were 8, and they are the numbers a pilot matches to
  // the nav log.
  const size = withLabel
    ? "grid h-[24px] w-[24px] place-items-center text-[11px] font-bold leading-none tracking-tight"
    : "h-4 w-4";
  return L.divIcon({
    className: "",
    iconSize: [tapSize, tapSize],
    iconAnchor: [tapSize / 2, tapSize / 2],
    html:
      `<div class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-[2.5px] border-background shadow-[0_1px_4px_rgba(0,0,0,.45)] outline outline-1 outline-[rgba(10,20,28,.55)] ${size}"` +
      ` style="background-color:${text(fill)};color:${text(inkOn(fill))}">${withLabel ? text(label) : ""}</div>`,
  });
}

/** Own ship: an arrow the size of a checkpoint dot, blue with a white
 *  casing so it holds over any chart colour, turned to the GPS heading
 *  -- a plain dot while stationary, when there is none. */
export function ownShipIcon(headingDeg: number | null, off = false) {
  // Grey where own ship is off: the last position, no longer watched, as
  // Maps greys its dot when it stops knowing where you are.
  const fill = off ? "#9ca3af" : "#2563eb";
  return L.divIcon({
    className: "",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    html: headingDeg === null || off
      ? `<div data-own-ship="${off ? "off" : "on"}" class="absolute left-1/2 top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-[2.5px] border-white shadow-[0_1px_4px_rgba(0,0,0,.45)]" style="background:${fill}"></div>`
      : `<svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true" data-own-ship="on"` +
        ` class="absolute left-0 top-0 drop-shadow-[0_1px_3px_rgba(0,0,0,.5)]"` +
        ` style="transform:rotate(${Number(headingDeg)}deg)">` +
        `<path d="M14 3 L23 24 L14 19 L5 24 Z" fill="${fill}" stroke="#ffffff" stroke-width="2.5" stroke-linejoin="round"/></svg>`,
  });
}

/**
 * An airport: the ident on a chip coloured by what is known of its
 * weather (see `AirportCard`) -- grey where nothing is reported yet.
 *
 * A chip rather than a dot because an airport is always worth naming
 * outright -- a pilot deciding whether to route around Chicago wants
 * to see "ORD", not a coloured spot they have to hover to identify.
 * The white casing is the same reasoning as the checkpoint dots': a
 * coloured shape alone disappears into chart of the same hue.
 *
 * `classB` draws the pill a Class B field has had since the layer was
 * added; every other airport gets squarer corners, so the route's own
 * C81 no longer looks like O'Hare. `unchecked` is a field nobody asked
 * about at all -- a training corridor's endpoint -- in white rather than
 * the grey that means "asked, and no report".
 *
 * The box is sized from the ident, with the chip centred in it: a fixed
 * 56 px box left-aligned a short ident off the airport's position and
 * cut a seven-character one (US-1234) off its own tap target.
 */
/** The sectional's magenta, a VFR waypoint's colour on the chart. */
const WAYPOINT_MAGENTA = "#b02e7c";

/** A VFR waypoint on the chart (VPBNG): a magenta diamond and no words,
 *  as small as the chart's own flag, in a finger's 44 points of target. */
export function diamondIcon() {
  return L.divIcon({
    className: "",
    iconSize: [44, 44], iconAnchor: [22, 22],
    html:
      `<span class="absolute left-1/2 top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] border-2 border-white shadow-sm"` +
      ` style="background-color:${WAYPOINT_MAGENTA}"></span>`,
  });
}

/** A waypoint the route flies through (a VFR or GPS waypoint): a chip in
 *  white with magenta words and the diamond the chart's waypoints wear,
 *  where an airport's chip wears its weather. */
export function waypointIcon(ident: string) {
  const width = Math.max(40, Math.ceil(ident.length * 7.5) + 30);
  return L.divIcon({
    className: "",
    iconSize: [width, 24], iconAnchor: [width / 2, 12],
    html:
      `<span class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border-2 border-[#b02e7c] bg-white px-1.5 py-0.5 text-[11px] font-bold text-[#8a1f5f] shadow-sm"` +
      `>&#9670;&#8202;${text(ident)}</span>`,
  });
}

/** A top of climb or descent on the course line: "TOC" or "TOD" in a
 *  small white tag edged in the line's orange, under the checkpoints'
 *  dots (it is a point the plan works out, not one to look for). */
export function legPointIcon(label: "TOC" | "TOD") {
  return L.divIcon({
    className: "",
    iconSize: [38, 20], iconAnchor: [19, 10],
    html:
      `<span class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-sm border-[1.5px] border-[#ff3b00] bg-white px-1 text-[11px] leading-[13px] font-bold text-[#1c1a17] shadow-sm"` +
      `>${text(label)}</span>`,
  });
}

export function airportIcon(colour: string, ident: string, { classB = false, unchecked = false } = {}) {
  const width = Math.max(40, Math.ceil(ident.length * 7.5) + 22);
  // A Class B field's pill is round-ended and coloured by its flight
  // category (the category in words was tried above the ident and
  // read as clutter; the colour, with the card a tap opens, is
  // enough); the route's own airports are squarer.
  const shape = classB ? "rounded-full" : "rounded-md";
  // The ident in whichever ink the fill reads at 4.5:1 with (inkOn), as
  // the checkpoint dots' numbers are: white on the grey of a field with no
  // report was 2.6:1.
  const fill = unchecked
    ? "background-color:#ffffff;color:#1c1a17"
    : `background-color:${text(colour)};color:${text(inkOn(colour))}`;
  return L.divIcon({
    className: "",
    iconSize: [width, 24], iconAnchor: [width / 2, 12],
    html:
      `<span class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap ${shape} border-2 border-white px-1.5 py-0.5 text-[11px] font-bold shadow-sm outline outline-1 outline-[rgba(10,20,28,.45)]"` +
      ` style="${fill}">${text(ident)}</span>`,
  });
}
