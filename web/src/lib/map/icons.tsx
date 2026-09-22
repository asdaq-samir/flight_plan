import L from "leaflet";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Leaflet's div icons take HTML; these are written as JSX and rendered
 * to static markup, the same Tailwind classes as the rest of the page.
 * `className: ""` on each suppresses Leaflet's default `.leaflet-div-icon`
 * box (white fill, grey border), since each draws its own.
 */

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
  return L.divIcon({
    className: "",
    iconSize: [tapSize, tapSize],
    iconAnchor: [tapSize / 2, tapSize / 2],
    html: renderToStaticMarkup(
      <div
        className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-[2.5px] border-background shadow-[0_1px_4px_rgba(0,0,0,.45)] outline outline-1 outline-[rgba(10,20,28,.55)] ${
          withLabel
            // leading-none and text-[8px]: a circle has less usable
            // width near its edges than a square of the same size, so
            // bold digits (a route's checkpoint count runs to three)
            // need real headroom to stay inside the curve, and a
            // browser's own line-height slack would sit the number
            // off-centre.
            ? "grid h-[22px] w-[22px] place-items-center text-[8px] font-bold leading-none text-white"
            : "h-4 w-4"
        }`}
        style={{ backgroundColor: fill }}
      >
        {label ?? ""}
      </div>,
    ),
  });
}

/** The airport pill: sized to its ident, centred in a wider icon box. */
export function endLabelIcon(ident: string) {
  return L.divIcon({
    className: "",
    iconSize: [90, 20], iconAnchor: [45, 10],
    html: renderToStaticMarkup(
      <span className="rounded border border-border bg-background px-1.5 py-0.5 text-xs font-semibold shadow-sm">
        {ident}
      </span>,
    ),
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
    html: renderToStaticMarkup(
      headingDeg === null ? (
        <div className="absolute left-1/2 top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-[2.5px] border-white bg-blue-600 shadow-[0_1px_4px_rgba(0,0,0,.45)]" />
      ) : (
        <svg
          viewBox="0 0 28 28" width={28} height={28}
          className="absolute left-0 top-0 drop-shadow-[0_1px_3px_rgba(0,0,0,.5)]"
          style={{ transform: `rotate(${headingDeg}deg)` }}
          aria-hidden
        >
          <path d="M14 3 L23 24 L14 19 L5 24 Z" fill="#2563eb" stroke="#ffffff" strokeWidth={2.5} strokeLinejoin="round" />
        </svg>
      ),
    ),
  });
}

/**
 * A Class B airport: the ident on a coloured chip, in the flight
 * category's own colour (see ClassBLayer).
 *
 * A chip rather than a dot because there are only thirty of them and
 * each one is worth naming -- a pilot deciding whether to route around
 * Chicago wants to see "ORD", not a coloured spot they have to hover to
 * identify. The white casing is the same reasoning as the checkpoint
 * dots': a coloured shape alone disappears into chart of the same hue.
 */
export function classBIcon(colour: string, ident: string) {
  return L.divIcon({
    className: "",
    iconSize: [56, 22], iconAnchor: [28, 11],
    html: renderToStaticMarkup(
      <span
        className="rounded-full border-2 border-white px-1.5 py-0.5 text-[11px] font-bold text-white shadow-sm"
        style={{ backgroundColor: colour }}
      >
        {ident}
      </span>,
    ),
  });
}
