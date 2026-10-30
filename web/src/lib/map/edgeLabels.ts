import type { Box, Point } from "./declutter";

/**
 * Where a volume's altitudes are written along its own line, as
 * ForeFlight writes them on its Chicago map (the owner's ask,
 * 2026-10-30): "100/30" in small bold type following the ring, just
 * inside the shelf, a few times round it. Everything here is in the
 * map's own pixels at one zoom (map.project), y pointing down.
 *
 * The planner sends each line with its volume on the line's left in
 * lon/lat (vfr.airspace_map orients every polygon first), which is the
 * line's right on the screen, where y points down: so the words go a
 * few pixels to the right of the way the line runs, and two shelves that
 * share a line each have theirs on their own side of it.
 */

/** A label's middle and the angle its words run at, degrees clockwise
 *  from the screen's x, from -90 (up the screen) to under 90, so they read upright. */
export interface EdgeSpot { x: number; y: number; angle: number }

/** About this far apart along a long line, px: a few round a Class B's
 *  outer ring on a phone's screen, as ForeFlight's are. */
export const EVERY_PX = 300;
/** A line shorter than this on the screen has none: a short stub at the
 *  box's edge or a small notch says nothing the next piece doesn't. */
export const MIN_PIECE_PX = 120;
/** How far the words' middle sits off the line toward the volume, px:
 *  half the 2.5 px line, a 1.5 px halo, a clear 2 px and half the 11 px
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

/**
 * Where one line's labels go: one at the middle of a line from
 * MIN_PIECE_PX (and the words' own width) long, more along a longer one
 * about EVERY_PX apart, each turned to the line's run over the words'
 * width -- the chord, so a jagged or curved line gives the words one
 * steady slant -- and set INSIDE_PX to its right, the volume's side.
 * Turned half round where they would read upside down, still on that
 * side, since the offset is taken before the turn.
 */
export function edgeSpots(line: Point[], textPx: number): EdgeSpot[] {
  if (line.length < 2) return [];
  const at = along(line);
  const length = at[at.length - 1]!;
  if (length < Math.max(MIN_PIECE_PX, textPx)) return [];
  const count = Math.max(1, Math.round(length / EVERY_PX));
  const spots: EdgeSpot[] = [];
  for (let i = 0; i < count; i++) {
    const s = (length * (i + 0.5)) / count;
    const a = pointAt(line, at, s - textPx / 2);
    const b = pointAt(line, at, s + textPx / 2);
    const chord = Math.hypot(b.x - a.x, b.y - a.y);
    if (chord === 0 || chord < CORNER * textPx) continue;
    const ux = (b.x - a.x) / chord, uy = (b.y - a.y) / chord;
    const on = pointAt(line, at, s);
    // The right of the way the line runs, with y down: (-uy, ux).
    const x = on.x - uy * INSIDE_PX, y = on.y + ux * INSIDE_PX;
    let angle = (Math.atan2(uy, ux) * 180) / Math.PI;
    // Straight down reads bottom to top, as a chart's words up a line do.
    if (angle >= 90) angle -= 180;
    else if (angle < -90) angle += 180;
    spots.push({ x, y, angle });
  }
  return spots;
}

/** The screen box a label's words take, turned: `textPx` wide and
 *  `heightPx` tall about its middle. */
export function spotBox(spot: EdgeSpot, textPx: number, heightPx: number): Box {
  const r = (spot.angle * Math.PI) / 180;
  const c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r));
  const hw = (c * textPx + s * heightPx) / 2, hh = (s * textPx + c * heightPx) / 2;
  return { x0: spot.x - hw, y0: spot.y - hh, x1: spot.x + hw, y1: spot.y + hh };
}
