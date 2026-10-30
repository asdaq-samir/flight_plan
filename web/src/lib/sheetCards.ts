import type { PillHead } from "./openCards";
import { createContext } from "react";
import { create } from "zustand";

/**
 * The cards open in the map's panel from a control or the chart
 * (components/SheetCard): where they are put, and which are open, the last
 * on top -- for the panel to come up for them and keep what is under them
 * (MapPanel), and the tab bar to name the top one (TabBar).
 */

type Entry = {
  id: string;
  /** Its name, for the minimized tab bar over it (TabBar). */
  title?: string;
  /** How far up the panel comes for it: half for a card, all the way up
   *  for a search, as Maps' does. */
  raise: "half" | "full";
  close: () => void;
};

/** Where the cards are put (the panel's body), and those open, the last
 *  on top; and whether the panel's tab bar names the top one in the
 *  tabs' place (`barNamed`), its own head then leaving the name and the
 *  close to the bar. */
export const useSheetCards = create<{ host: HTMLElement | null; stack: Entry[]; barNamed: boolean; barHead: HTMLElement | null }>(
  () => ({ host: null, stack: [], barNamed: false, barHead: null }));

/** The bar's row, where the top card that names itself (a map card's,
 *  MapCard) draws its mark and name, beside the bar's close: in its own
 *  row under the bar they were a second head, the bar's row empty but for
 *  the close (the owner's screenshot of JOT's card, 2026-10-29). One
 *  function, so React does not drop the place and set it again at each
 *  of the bar's draws. */
export function barHeadRef(node: HTMLDivElement | null) {
  useSheetCards.setState({ barHead: node });
  return () => useSheetCards.setState(s => (s.barHead === node ? { barHead: null } : s));
}

/** How far the panel is asked up for the cards open: null with none. */
export const raisedFor = (stack: Entry[]): "half" | "full" | null =>
  stack.length === 0 ? null : stack.some(entry => entry.raise === "full") ? "full" : "half";

/** Every card put away, the top first: another tab picked (TabBar), whose
 *  page is not what they were opened over; a field tapped on the chart
 *  (AirportsLayer), whose tap goes no further for the cards to hear. */
export function closeSheetCards() {
  for (const entry of [...useSheetCards.getState().stack].reverse()) entry.close();
}

/** The head's place for a card whose content draws its own name there --
 *  a map card's (MapCard), its mark beside its name -- the id that name
 *  takes, which names the card, and what the pill shows of it there. */
export const SheetCardHead = createContext<{
  slot: HTMLElement | null; headingId: string; setPill: (pill: PillHead | undefined) => void;
  /** The slot is the bar's row (barHeadRef): the name at a row's size. */
  inBar?: boolean;
} | null>(null);

