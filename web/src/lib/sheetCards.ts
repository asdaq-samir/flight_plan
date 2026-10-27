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
 *  on top. */
export const useSheetCards = create<{ host: HTMLElement | null; stack: Entry[] }>(() => ({ host: null, stack: [] }));

/** How far the panel is asked up for the cards open: null with none. */
export const raisedFor = (stack: Entry[]): "half" | "full" | null =>
  stack.length === 0 ? null : stack.some(entry => entry.raise === "full") ? "full" : "half";

/** Every card put away, the top first: another tab picked (TabBar), whose
 *  page is not what they were opened over. */
export function closeSheetCards() {
  for (const entry of [...useSheetCards.getState().stack].reverse()) entry.close();
}

/** The head's place for a card whose content draws its own name there --
 *  a map card's (MapCard), its mark beside its name -- and the id that
 *  name takes, which names the card. */
export const SheetCardHead = createContext<{ slot: HTMLElement | null; headingId: string } | null>(null);

