import { SETTLE_LEAST, SETTLE_MOST, SETTLE_POINTS, SHEET_SECONDS, type PanelState } from "../mapChrome";

/**
 * The rules of the map's sheet, with no element in them (MapPanel moves
 * the sheet, useSheetDrag reads the finger): where a drag may rest, where
 * a release goes, how long a settle takes, and whether a finger on the
 * body is the sheet's or the content's. Each is a function of numbers, so
 * each is tested as one (engine.test.ts).
 */

/** The sheet's three heights, in px from the screen's edge. */
export type Detents = Record<PanelState, number>;

/** How far a finger moves before a press is a drag rather than a tap on
 *  what it pressed: iOS's own ten points. At six, a tap on a button in the
 *  head -- the route box's plus -- that rolled a little under the finger
 *  dragged the sheet instead, and its click was swallowed. */
export const DRAG_SLOP = 10;

/** How much more than its own height a box must hold before it counts as
 *  one to scroll, in px: past a hit area's reach, short of a line. The
 *  route box of two lines ran 2 px past its own height at the owner's
 *  larger text, which took it for a box with lines to scroll first, and
 *  the drag scrolled those 2 px in place of the sheet (2026-10-21). */
export const SCROLL_SLOP_PX = 8;

/** How far back a release looks for the finger's speed, in milliseconds,
 *  as UIKit's pan reads its velocity over the last moments of the drag:
 *  a finger that has held still that long lets the sheet go where it is.
 *  Read from the last move alone, the speed stayed what it was before the
 *  finger stopped -- a touch screen sends no move while it holds still --
 *  and a sheet set down past half way and held there was thrown on. */
export const SPEED_WINDOW = 100;

/** How far on a throw is read, in ms: the detent nearest where the finger
 *  would be a fifth of a second on is where it lands. */
const THROW_MS = 200;

/** The height a drag may put the sheet at: between its lowest and its
 *  highest detent. */
export function clampHeight(detents: Detents, h: number): number {
  const heights = Object.values(detents);
  return Math.min(Math.max(...heights), Math.max(Math.min(...heights), h));
}

/**
 * Where a drag let go at `to`, at `speed` points a millisecond toward
 * opening, comes to rest: the detent nearest where it would be a fifth of
 * a second on -- where it was thrown, not only where it stopped -- but no
 * further than the next detent past where the finger let go, as a UIKit
 * sheet's throw goes one size: a flick up from the pill came to rest all
 * the way up, past half, and one down from all the way up on the pill, at
 * the owner's notice ("The pill should not go straight to full"). Taken
 * past half by the finger itself, the sheet still goes on up.
 */
export function restingAt(detents: Detents, to: number, speed: number): PanelState {
  const aim = to + speed * THROW_MS;
  const names = Object.keys(detents) as PanelState[];
  const nearest = (among: PanelState[], at: number) =>
    among.reduce((best, s) => (Math.abs(detents[s] - at) < Math.abs(detents[best] - at) ? s : best));
  const under = names.filter(s => detents[s] < to);
  const over = names.filter(s => detents[s] > to);
  const reach = [
    ...(under.length ? [nearest(under, to)] : []),
    ...names.filter(s => detents[s] === to),
    ...(over.length ? [nearest(over, to)] : []),
  ];
  return nearest(reach, aim);
}

/** How long a settle over `distance` px takes, in seconds: the pill to
 *  half's time over its distance (SHEET_SECONDS over SETTLE_POINTS), the
 *  speed the owner likes, clamped so a long move is not slow and a short
 *  one not a snap. */
export function settleSeconds(distance: number): number {
  const seconds = (SHEET_SECONDS * Math.abs(distance)) / SETTLE_POINTS;
  return Math.round(Math.min(SETTLE_MOST, Math.max(SETTLE_LEAST, seconds)) * 100) / 100;
}

/** Where the finger was and when, oldest first: the last SPEED_WINDOW of
 *  it and the one before, for its speed at the release. */
export type Track = { y: number; t: number }[];

export function follow(track: Track, y: number, t: number) {
  track.push({ y, t });
  while (track.length > 2 && t - track[1]!.t > SPEED_WINDOW) track.shift();
}

/** The finger's speed at `now`, in points a millisecond down the screen:
 *  from its place a little before the window to its last, or nothing if
 *  its last move was longer ago than the window. */
export function speedAt(track: Track, now: number): number {
  const last = track[track.length - 1];
  if (!last || track.length < 2 || now - last.t > SPEED_WINDOW) return 0;
  const first = track[0]!;
  return (last.y - first.y) / Math.max(last.t - first.t, 1);
}

/** What the drag's rule needs to know of each box from the finger's
 *  target up to the sheet's body (the body last, `isBody`). */
export interface Box {
  /** A box that keeps every finger: a text area, a slider, anything with
   *  gestures of its own (touch-action none: the map, Favorites' handles). */
  keeps?: boolean;
  /** Marked to scroll first (data-scroll-first): FPL's route box, which
   *  scrolls while it can the way the finger goes, and only then hands
   *  the drag to the sheet. */
  scrollFirst?: boolean;
  /** A scroller by its overflow (auto or scroll). */
  scroller?: boolean;
  /** Holds more than SCROLL_SLOP_PX past its own height. */
  scrolls?: boolean;
  /** Scrolled to its start (the top); to its end (the bottom). */
  atStart?: boolean;
  atEnd?: boolean;
  isBody?: boolean;
}

/**
 * Whether the sheet takes a finger on its body that moved `dy` down the
 * screen, as an iOS sheet's scrolling content hands its drag to the
 * sheet: toward opening, the sheet comes out until it is all the way out
 * (`canOpen`), and only then does the content scroll; toward closing, the
 * content scrolls back to its start first (its end, on a sheet from the
 * top) and from there the sheet goes -- where a drag at the top of the
 * nav log pulled the page's rubber band and the sheet stayed. A box with
 * gestures of its own keeps the finger; a box marked to scroll first
 * scrolls while it can either way.
 */
export function sheetTakes(path: Box[], dy: number, fromBottom: boolean, canOpen: boolean): boolean {
  for (const box of path) {
    if (box.isBody) break;
    if (box.keeps) return false;
    if (box.scrollFirst && box.scrolls && (dy < 0 ? !box.atEnd : !box.atStart)) return false;
  }
  if (fromBottom ? dy < 0 : dy > 0) return canOpen;
  for (const box of path) {
    if (box.scroller && box.scrolls && (fromBottom ? !box.atStart : !box.atEnd)) return false;
  }
  return true;
}
