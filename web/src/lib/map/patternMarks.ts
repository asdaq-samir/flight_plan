import { divIcon } from "./icons";

/**
 * The traffic patterns the pilot picked (the route's Procedures), on the
 * chart round their runways: each leg in teal over a white casing, as a
 * procedure is drawn apart from the route's magenta (ForeFlight draws its
 * in a cyan, at the pilot's showing), an arrow along each leg the way it
 * is flown, the downwind named with its altitude, and the 45° entry dashed
 * into it. At the field left from, the runway and its upwind, and the way
 * out of the pattern dashed from its end (departurePattern). Not
 * tappable: a picture of the pattern, the chart under it.
 */
export const TEAL = "#0e8f8a";
/** A name's ground, darker: white words on the line's teal were 3.95:1,
 *  under the 4.5:1 small words need (WCAG 1.4.3; the iOS audit). This is
 *  5.2:1. */
const LABEL_TEAL = "#0b7a75";

/** From this zoom in, the legs' arrows and names: further out the pattern
 *  is a few pixels round its field, and its words would cover the field's
 *  mark. */
export const PATTERN_WORDS_FROM_ZOOM = 11;

/** An arrowhead the way a leg is flown, at its middle. */
export function arrowIcon(bearing: number) {
  return divIcon({
    className: "", iconSize: [16, 16], iconAnchor: [8, 8],
    html: `<svg viewBox="-8 -8 16 16" width="16" height="16" style="transform:rotate(${Math.round(bearing)}deg)" aria-hidden="true">` +
      `<path d="M0 -6 L5 4 L0 1.5 L-5 4 Z" fill="${TEAL}" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>`,
  });
}

/** A name's width on the chart, px: 11 px bold, a letter a little wide. */
const labelWidth = (words: string) => Math.ceil(words.length * 6.6) + 12;

/** A leg's name on the chart, white words on teal. */
export function labelIcon(words: string) {
  const width = labelWidth(words);
  return divIcon({
    className: "", iconSize: [width, 18], iconAnchor: [width / 2, 9],
    html: `<span class="absolute inset-0 grid place-items-center whitespace-nowrap rounded-md text-[11px] leading-none font-bold text-white shadow-sm" style="background:${LABEL_TEAL}">${words.replace(/[<>&]/g, "")}</span>`,
  });
}

