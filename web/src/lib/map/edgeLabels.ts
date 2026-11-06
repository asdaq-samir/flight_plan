import type { Box, Point } from "./declutter";

/**
 * Where a volume's altitudes are written along its own line, as
 * ForeFlight writes them on its Chicago map (the owner's ask,
 * 2026-10-30): "100/30" in small bold type following the ring, just
 * inside the shelf, a few times round it. Everything here is in the
 * map's own pixels at one zoom (map.project), y pointing down.
 *
 * The planner sends each line with its volume on the line's left in
 * lon/lat (wingtip.airspace_map orients every polygon first), which is the
 * line's right on the screen, where y points down: so the words go a
 * few pixels to the right of the way the line runs, and two shelves that
 * share a line each have theirs on their own side of it.
 */

/** A label's middle on the screen and the angle its words run at,
 *  degrees clockwise from the screen's x, from -90 (up the screen) to
 *  under 90, so they read upright. */
export interface EdgeSpot { x: number; y: number; angle: number }

/** About this far apart along a long line, px: a few round a Class B's
 *  outer ring on a phone's screen, as ForeFlight's are. */
export const EVERY_PX = 300;
/** A line shorter than this on the screen has none: a short stub at the
 *  box's edge or a small notch says nothing the next piece doesn't. */
export const MIN_PIECE_PX = 120;
/** How far the words' middle sits off the line toward the volume, px:
 *  half the 3 px line, a 1.5 px halo, a clear 1.5 px and half the 11 px
 *  type's height. */
export const INSIDE_PX = 10;
/** A label is left out where its words would cut a corner this much
 *  shorter than they are: they would stand off the line across it. */
const CORNER = 0.85;

/** How far along the line each point is, px, the first 0. */
function along(line: Point[]): number[] {
  const at = [0];
  for (let i = 1; i < line.length; i++) at.push(at[i - 1]! + Math.hypot(line[i]!.x - line[i - 1]!.x, line[i]!.y - line[i - 1]!.y));
  return at;
}

/** The point `s` px along the line (`at` its along()). */
function pointAt(line: Point[], at: number[], s: number): Point {
  let i = 1;
  while (i < at.length - 1 && at[i]! < s) i++;
  const from = line[i - 1]!, to = line[i]!, start = at[i - 1]!;
  const span = at[i]! - start;
  const t = span > 0 ? Math.min(1, Math.max(0, (s - start) / span)) : 0;
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

/** The label `s` along the line: the point on the line, the words'
 *  middle INSIDE_PX off it on the volume's side (dx, dy, screen px
 *  whatever the line's scale), and their upright angle; none across a
 *  corner. `textPx` is the words' width at the line's scale. */
function spotAt(line: Point[], at: number[], s: number, textPx: number): Omit<EdgeAnchor, "from"> | null {
  const a = pointAt(line, at, s - textPx / 2);
  const b = pointAt(line, at, s + textPx / 2);
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  if (chord === 0 || chord < CORNER * textPx) return null;
  const ux = (b.x - a.x) / chord, uy = (b.y - a.y) / chord;
  const on = pointAt(line, at, s);
  let angle = (Math.atan2(uy, ux) * 180) / Math.PI;
  // Straight down reads bottom to top, as a chart's words up a line do.
  if (angle >= 90) angle -= 180;
  else if (angle < -90) angle += 180;
  // The right of the way the line runs, with y down: (-uy, ux).
  return { x: on.x, y: on.y, dx: -uy * INSIDE_PX, dy: ux * INSIDE_PX, angle };
}

/** A label held to its place on the line at every zoom: the point on the
 *  line (x, y, in the pixels of the zoom the line was given at), the
 *  words' offset from it and their angle (the same at every zoom, the
 *  map being conformal), and the zoom it is written from. */
export interface EdgeAnchor { x: number; y: number; dx: number; dy: number; angle: number; from: number }

/** The zoom the fewest labels are for, the airspace's first (AirspaceLayer's
 *  FROM_ZOOM). */
const FIRST_ZOOM = 8;

/**
 * A line's labels that stay put as the map zooms, at the owner's ask
 * (2026-11-02: the overlay "very dynamic while zooming in ... needs a bit
 * of stability by design"), where edgeSpots' were worked out afresh at
 * each zoom and so came back somewhere else, and in other numbers, after
 * every step. Each lies at the same place on the line at every zoom; going
 * in, more come in between the ones there -- three for each, two zooms
 * on, so those already there keep their places (the thirds of a third
 * are among the ninths) -- the spacing EVERY_PX or so at the zoom each
 * set comes in. None before the line is MIN_PIECE_PX and its words long.
 * `line` in the map's pixels at `zoom`, as fine as the labels will be
 * placed; `textPx` the words' width on the screen.
 */
export function edgeAnchors(line: Point[], textPx: number, zoom: number): EdgeAnchor[] {
  if (line.length < 2) return [];
  const at = along(line);
  const length = at[at.length - 1]!;
  const scaleFrom = (z: number) => 2 ** (zoom - z);
  // The first zoom it is long enough on the screen to be written along.
  const shortest = Math.max(MIN_PIECE_PX, textPx);
  const first = Math.max(FIRST_ZOOM, Math.ceil(zoom - Math.log2(length / shortest) - 1e-9));
  const count = Math.max(1, Math.round(length / scaleFrom(first) / EVERY_PX));
  const out: EdgeAnchor[] = [];
  // Each set two zooms on from the last, three times as many: the sets
  // up to the zoom the line was given at.
  for (let level = 0, n = count, from = first; from <= zoom; level++, n *= 3, from += 2) {
    for (let i = 0; i < n; i++) {
      // Those of the sets before are every third of this one's.
      if (level > 0 && i % 3 === 1) continue;
      const spot = spotAt(line, at, (length * (i + 0.5)) / n, textPx * scaleFrom(from));
      if (spot) out.push({ ...spot, from });
    }
  }
  return out;
}

/** The screen box a label's words take, turned: `textPx` wide and
 *  `heightPx` tall about its middle. */
export function spotBox(spot: EdgeSpot, textPx: number, heightPx: number): Box {
  const r = (spot.angle * Math.PI) / 180;
  const c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r));
  const hw = (c * textPx + s * heightPx) / 2, hh = (s * textPx + c * heightPx) / 2;
  return { x0: spot.x - hw, y0: spot.y - hh, x1: spot.x + hw, y1: spot.y + hh };
}
