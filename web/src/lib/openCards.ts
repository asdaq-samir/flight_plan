/**
 * The cards open in the map's panel (CardHead's), and the lists in full
 * (ListPageHead's), the last opened on top: a device's own Back --
 * Android's, a TV remote's (lib/back) -- closes the top one, as its close
 * or its Back does, before the panel is lowered. A card over a list (an
 * airport's over Nearest's) is closed first, then the list.
 */
import { create } from "zustand";

const open: { close: () => void; inBar?: boolean }[] = [];

/** How many cards are open whose way back is the minimized tab bar's Back
 *  (TabBar): a list's is its own head's, so it is not counted. */
export const useOpenCards = create<{ count: number }>(() => ({ count: 0 }));

const counted = () => open.filter(entry => entry.inBar !== false).length;

/** A card's close -- or a list's Back, `inBar` false, its way back drawn
 *  in its own head -- kept while it is open; answers its removal. */
export function holdOpenCard(entry: { close: () => void; inBar?: boolean }): () => void {
  open.push(entry);
  useOpenCards.setState({ count: counted() });
  return () => {
    const at = open.indexOf(entry);
    if (at >= 0) open.splice(at, 1);
    useOpenCards.setState({ count: counted() });
  };
}

/** The top card closed; whether there was one. */
export function closeTopCard(): boolean {
  const top = open[open.length - 1];
  if (!top) return false;
  top.close();
  return true;
}
