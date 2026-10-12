/**
 * The cards open in the map's panel (CardHead's), the last opened on top:
 * a device's own Back -- Android's, a TV remote's (lib/back) -- closes the
 * top one, as its close button does, before the panel is lowered. A card
 * under another (an airport's over Nearest's list) is closed after it.
 */
import { create } from "zustand";

const open: { close: () => void }[] = [];

/** How many cards are open, for what shows a way back while one is: the
 *  minimized tab bar's Back (TabBar). */
export const useOpenCards = create<{ count: number }>(() => ({ count: 0 }));

/** A card's close, kept while it is open; answers its removal. */
export function holdOpenCard(entry: { close: () => void }): () => void {
  open.push(entry);
  useOpenCards.setState({ count: open.length });
  return () => {
    const at = open.indexOf(entry);
    if (at >= 0) open.splice(at, 1);
    useOpenCards.setState({ count: open.length });
  };
}

/** The top card closed; whether there was one. */
export function closeTopCard(): boolean {
  const top = open[open.length - 1];
  if (!top) return false;
  top.close();
  return true;
}
