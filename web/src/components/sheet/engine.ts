import { SETTLE_LEAST, SETTLE_MOST, SETTLE_POINTS, SHEET_SECONDS, type PanelState } from "../mapChrome";

/**
 * The map's sheet's numbers, with no element in them. The drag, where a
 * release comes to rest, and what a finger on a list does are the stock
 * sheet's (Base UI's Drawer, MapPanel); what is left here is the sheet's
 * three heights and how long it takes to go between them.
 */

/** The sheet's three heights, in px from the screen's edge. */
export type Detents = Record<PanelState, number>;

/** How long a settle over `distance` px takes, in seconds: the pill to
 *  half's time over its distance (SHEET_SECONDS over SETTLE_POINTS), the
 *  speed the owner likes, clamped so a long move is not slow and a short
 *  one not a snap. */
export function settleSeconds(distance: number): number {
  const seconds = (SHEET_SECONDS * Math.abs(distance)) / SETTLE_POINTS;
  return Math.round(Math.min(SETTLE_MOST, Math.max(SETTLE_LEAST, seconds)) * 100) / 100;
}
