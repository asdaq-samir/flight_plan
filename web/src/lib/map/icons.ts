import L from "leaflet";
import type { AirspaceClass } from "../preferences";
import { inkOn } from "../scoreScale";
import { textWidth } from "../textWidth";
import { BLUE, MAGENTA } from "../useAirspace";

/** An icon made once for the same arguments and handed out again after:
 *  react-leaflet sets a marker's icon again whenever the icon is a new
 *  object, rebuilding its element, and every redraw of the planner made
 *  every marker's anew -- a narrative arriving, a tab opening redrew the
 *  route's chips (leaflet's createIcon, measured on the Brief tab's first
 *  opening). Plain data in, so the arguments are the key; a few thousand
 *  kept at most. */
function made<A extends unknown[]>(make: (...args: A) => L.DivIcon): (...args: A) => L.DivIcon {
  const kept = new Map<string, L.DivIcon>();
  return (...args: A) => {
    const key = JSON.stringify(args);
    let icon = kept.get(key);
    if (!icon) {
      if (kept.size > 4000) kept.clear();
      icon = make(...args);
      kept.set(key, icon);
    }
    return icon;
  };
}

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

/** A target a finger's 44 points across (Apple's Human Interface
 *  Guidelines), for the marks drawn small: a waypoint's diamond. A chip's
 *  target is the chip, where its neighbours' are close: grown to 44 every
 *  chip's box lay over the next one's, and a tap on a chip in sight went
 *  to the one beside it (KORD's, under a neighbour's, 2026-10-07). A tap a
 *  little off a field's chip is its own all the same (AirportsLayer's
 *  near miss). */
const TAP = 44;

/**
 * A marker with three edges: a white casing to separate it from dark
 * linework, a dark hairline outside that so it still separates from pale
 * paper, and a shadow to lift it off both. One edge is never enough on a
 * chart this busy.
 */
export const dotIcon = made(function dotIcon(fill: string, label?: string | number) {
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
});

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

/** How far a checkpoint's name sits from its point: clear of its numbered
 *  dot (dotIcon's 24, and a margin). */
export const CHECKPOINT_LABEL_GAP = 16;
/** Its height, for the labels to be kept from one another (RouteMap). */
export const CHECKPOINT_LABEL_HEIGHT = 20;
/** A checkpoint label's width as drawn (checkpointLabelIcon): its name in
 *  the page's own bold 12, the tracking's 0.3 a letter, 6 either side --
 *  for the labels to be kept from one another and the screen's edge
 *  (RouteMap). A width per letter guessed short: FOREST VIEW, its bold
 *  capitals wider than the guess, ran off a phone's screen. */
export function checkpointLabelWidth(name: string): number {
  const width = typeof document === "undefined" ? null : textWidth(name, `700 12px ${getComputedStyle(document.body).fontFamily}`);
  return width == null ? name.length * 9 + 12 : Math.ceil(width + name.length * 0.3 + 12);
}

/** An airport chip's width (airportIcon). */
const airportChipWidth = (ident: string) => Math.max(40, Math.ceil(ident.length * 7.5) + 22);

/** An airport mark's symbol across (airportMarkIcon), and how far its
 *  ident runs right of the field: for a label to keep off both. */
export const AIRPORT_MARK = 26;
export const airportMarkReach = (ident: string) => AIRPORT_MARK / 2 + 2 + Math.ceil(ident.length * 7.5);

/**
 * A checkpoint's name beside its dot, as ForeFlight labels a flight
 * plan's waypoints: the name the route's ForeFlight pack gives it (ROUND
 * LAKE BEACH, ROAD WATERTOWN), so the map here and ForeFlight's read
 * alike, on a dark label that holds on the chart's paper and its
 * linework both, after the dot -- or before it where there is no room
 * after (the screen's edge, another name). Not a target: a tap there is
 * the dot's or the chart's.
 */
export const checkpointLabelIcon = made(function checkpointLabelIcon(name: string, side: "right" | "left" = "right") {
  return L.divIcon({
    className: "",
    iconSize: [0, 0],
    iconAnchor: [side === "right" ? -CHECKPOINT_LABEL_GAP : CHECKPOINT_LABEL_GAP, CHECKPOINT_LABEL_HEIGHT / 2],
    html: `<span data-checkpoint-label="" class="pointer-events-none absolute ${side === "right" ? "left-0" : "right-0"} top-0 whitespace-nowrap rounded-md bg-[#1f2933]/85 px-1.5 text-[12px] font-bold uppercase leading-[20px] tracking-wide text-white shadow-[0_1px_3px_rgba(0,0,0,.4)]">${text(name)}</span>`,
  });
});

/**
 * The ring round the airport whose card is open: the selected
 * checkpoint's halo (Halo) -- red-orange, cased in white and then a dark
 * line on both sides -- so one look marks what is picked on the map, and
 * it holds over the sectional's yellow cities, its paper and its
 * linework alike. It was the brand's taxiway yellow, which the pilot
 * found hard to see; of red-orange, blue and magenta tried over KBUR's
 * Los Angeles and KMSN's Madison, red-orange stood out most, where blue
 * is Class B's and D's and magenta the chart's own airspace. Round, 40
 * across, clear of the field's mark (airportMarkIcon) by 7 on every side,
 * or round the chart's own symbol where the field wears none. It is not
 * a target: a tap there still goes to the mark under it.
 */
export const selectionIcon = made(function selectionIcon() {
  const ring = "pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 border-[3px] border-[#ff3b00]" +
    " shadow-[0_0_0_1.5px_#fff,0_0_0_2.5px_rgba(10,20,28,.6),inset_0_0_0_1.5px_#fff,inset_0_0_0_2.5px_rgba(10,20,28,.6)]";
  return L.divIcon({
    className: "",
    iconSize: [0, 0], iconAnchor: [0, 0],
    html: `<span data-selected-airport="" class="${ring} size-10 rounded-full"></span>`,
  });
});

/** The sectional's magenta, a VFR waypoint's colour on the chart. */
const WAYPOINT_MAGENTA = "#b02e7c";

/** A VFR waypoint on the chart (VPBNG): a magenta diamond and no words,
 *  as small as the chart's own flag, in a finger's 44 points of target. */
export const diamondIcon = made(function diamondIcon() {
  return L.divIcon({
    className: "",
    iconSize: [TAP, TAP], iconAnchor: [TAP / 2, TAP / 2],
    html:
      `<span class="absolute left-1/2 top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] border-2 border-white shadow-sm"` +
      ` style="background-color:${WAYPOINT_MAGENTA}"></span>`,
  });
});

/** A waypoint the route flies through (a VFR or GPS waypoint): a chip in
 *  white with magenta words and the diamond the chart's waypoints wear,
 *  where an airport's chip wears its weather. */
export const waypointIcon = made(function waypointIcon(ident: string) {
  const width = Math.max(40, Math.ceil(ident.length * 7.5) + 30);
  return L.divIcon({
    className: "",
    iconSize: [width, 24], iconAnchor: [width / 2, 12],
    html:
      `<span class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border-2 border-[#b02e7c] bg-white px-1.5 py-0.5 text-[11px] font-bold text-[#8a1f5f] shadow-sm"` +
      `>&#9670;&#8202;${text(ident)}</span>`,
  });
});

/** A top of climb or descent on the course line: "TOC" or "TOD" in a
 *  small white tag edged in the line's orange, under the checkpoints'
 *  dots (it is a point the plan works out, not one to look for). */
export const legPointIcon = made(function legPointIcon(label: "TOC" | "TOD") {
  return L.divIcon({
    className: "",
    iconSize: [38, 20], iconAnchor: [19, 10],
    html:
      `<span class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-sm border-[1.5px] border-[#ff3b00] bg-white px-1 text-[11px] leading-[13px] font-bold text-[#1c1a17] shadow-sm"` +
      `>${text(label)}</span>`,
  });
});

/**
 * A field nobody asked about -- a training corridor's endpoint: its ident
 * on a white chip, the white casing and the dark hairline round it so it
 * holds on the chart's paper and its linework alike. The box is sized
 * from the ident, with the chip centred in it.
 */
export const airportIcon = made(function airportIcon(ident: string) {
  const width = airportChipWidth(ident);
  return L.divIcon({
    className: "",
    iconSize: [width, 24], iconAnchor: [width / 2, 12],
    html:
      `<span class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-md border-2 border-white px-1.5 py-0.5 text-[11px] font-bold shadow-sm outline outline-1 outline-[rgba(10,20,28,.45)]"` +
      ` style="background-color:#ffffff;color:#1c1a17">${text(ident)}</span>`,
  });
});

/** The sectional's ink for a mark whose class is not known yet. */
const UNKNOWN_GREY = "#6b7280";

/**
 * An airport on the map, at the pilot's ask, as ForeFlight marks them
 * from the sectional's own symbols: a ring with four ticks (the chart's
 * sign of a field with services) in the look its airspace has
 * everywhere in the planner (lib/useAirspace) -- Class B a solid blue
 * disc, C a solid magenta one, D a dashed blue ring, an E surface area a
 * dashed magenta ring, G a thin magenta ring, and grey until the class is
 * known -- and a field the armed services keep, an M on a disc of its
 * airspace's colour. In its middle (at its edge on the M) a dot in the
 * colour of the field's weather, its METAR's flight category, grey with
 * no report, kept from the chips the map had, at the pilot's ask. Its
 * ident beside it, dark on a white halo, as the chart letters a field.
 * White casing round each line, as on every mark here: a coloured line
 * alone is lost on chart of the same hue.
 */
export const airportMarkIcon = made(function airportMarkIcon(
  ident: string, space: AirspaceClass | null, weather: string, military = false,
) {
  const blue = space === "B" || space === "D";
  const ink = space ? (blue ? BLUE : MAGENTA) : UNKNOWN_GREY;
  const casing = `stroke="#fff" stroke-linecap="round"`;
  const symbol = military
    ? `<circle r="10" fill="${ink}" ${casing} stroke-width="2"/>` +
      `<text y="4" text-anchor="middle" font-size="11" font-weight="800" fill="#fff" font-family="system-ui,sans-serif">M</text>` +
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
  return L.divIcon({
    className: "",
    iconSize: [AIRPORT_MARK, AIRPORT_MARK], iconAnchor: [half, half],
    html:
      `<svg data-airport-mark="" data-airspace="${space ?? ""}"${military ? ` data-military=""` : ""} aria-hidden="true" class="absolute inset-0 overflow-visible drop-shadow-[0_1px_1px_rgba(0,0,0,.35)]"` +
      ` width="${AIRPORT_MARK}" height="${AIRPORT_MARK}" viewBox="${-half} ${-half} ${AIRPORT_MARK} ${AIRPORT_MARK}">${symbol}</svg>` +
      `<span class="absolute top-1/2 left-[calc(100%+1px)] -translate-y-1/2 whitespace-nowrap text-[11px] leading-none font-bold text-[#1c1a17] [text-shadow:0_0_2px_#fff,0_0_2px_#fff,0_0_3px_#fff,0_0_4px_#fff]">${text(ident)}</span>`,
  });
});
