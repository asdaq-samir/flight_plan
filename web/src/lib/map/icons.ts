import L from "leaflet";

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
  // leading-none and text-[8px]: a circle has less usable width near
  // its edges than a square of the same size, so bold digits (a
  // route's checkpoint count runs to three) need real headroom to stay
  // inside the curve, and a browser's own line-height slack would sit
  // the number off-centre.
  const size = withLabel
    ? "grid h-[22px] w-[22px] place-items-center text-[8px] font-bold leading-none text-white"
    : "h-4 w-4";
  return L.divIcon({
    className: "",
    iconSize: [tapSize, tapSize],
    iconAnchor: [tapSize / 2, tapSize / 2],
    html:
      `<div class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-[2.5px] border-background shadow-[0_1px_4px_rgba(0,0,0,.45)] outline outline-1 outline-[rgba(10,20,28,.55)] ${size}"` +
      ` style="background-color:${text(fill)}">${withLabel ? text(label) : ""}</div>`,
  });
}

/** Own ship: an arrow the size of a checkpoint dot, blue with a white
 *  casing so it holds over any chart colour, turned to the GPS heading
 *  -- a plain dot while stationary, when there is none. */
export function ownShipIcon(headingDeg: number | null) {
  return L.divIcon({
    className: "",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    html: headingDeg === null
      ? `<div class="absolute left-1/2 top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-[2.5px] border-white bg-blue-600 shadow-[0_1px_4px_rgba(0,0,0,.45)]"></div>`
      : `<svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true"` +
        ` class="absolute left-0 top-0 drop-shadow-[0_1px_3px_rgba(0,0,0,.5)]"` +
        ` style="transform:rotate(${Number(headingDeg)}deg)">` +
        `<path d="M14 3 L23 24 L14 19 L5 24 Z" fill="#2563eb" stroke="#ffffff" stroke-width="2.5" stroke-linejoin="round"/></svg>`,
  });
}

/**
 * An airport: the ident on a coloured chip, in its current flight
 * category's own colour where one applies (see `AirportCard`) -- grey
 * where it doesn't, a route's own departure/destination before their
 * METAR answers, or a training corridor's endpoint, which has none.
 *
 * A chip rather than a dot because an airport is always worth naming
 * outright -- a pilot deciding whether to route around Chicago wants
 * to see "ORD", not a coloured spot they have to hover to identify.
 * The white casing is the same reasoning as the checkpoint dots': a
 * coloured shape alone disappears into chart of the same hue.
 */
export function classBIcon(colour: string, ident: string) {
  return L.divIcon({
    className: "",
    iconSize: [56, 22], iconAnchor: [28, 11],
    html:
      `<span class="rounded-full border-2 border-white px-1.5 py-0.5 text-[11px] font-bold text-white shadow-sm"` +
      ` style="background-color:${text(colour)}">${text(ident)}</span>`,
  });
}
