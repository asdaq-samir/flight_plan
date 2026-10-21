/**
 * The cards open in the map's panel (CardHead's), and the lists in full
 * (ListPageHead's), the last opened on top: a device's own Back --
 * Android's, a TV remote's (lib/back) -- closes the top one, as its close
 * or its Back does, before the panel is lowered. A card over a list (an
 * airport's over Nearest's) is closed first, then the list.
 */
import { create } from "zustand";

/** The cards of the route whose Share is a menu of the route's things,
 *  each its own (ShareMenu's `card`). */
export type RouteCard = "brief" | "navlog" | "profile";

/** A card's share: its own, or one of the route's cards, whose Share menu
 *  is the route's things that card has (the Brief's Print the briefing). */
export type CardShare = (() => void) | RouteCard;

type OpenCard = { close: () => void; inBar?: boolean; share?: CardShare };

const open: OpenCard[] = [];

/** How many cards are open whose way back is the minimized tab bar's Back
 *  (TabBar): a list's is its own head's, so it is not counted. The top
 *  one's share, where it has one (an airport's, an airplane's, the Brief's
 *  and the nav log's): the bar's Share in place of its Back, at the
 *  owner's ask. And whether the bar is minimized now, so drawing it: a
 *  card with a share of its own in its body (FlightCard's) leaves it to
 *  the bar there. */
export const useOpenCards = create<{ count: number; share: CardShare | null; barMinimized: boolean }>(() => ({ count: 0, share: null, barMinimized: false }));

function counted() {
  const inBar = open.filter(entry => entry.inBar !== false);
  return { count: inBar.length, share: inBar.at(-1)?.share ?? null };
}

/** A card's close -- or a list's Back, `inBar` false, its way back drawn
 *  in its own head -- and its share, kept while it is open; answers its
 *  removal. */
export function holdOpenCard(entry: OpenCard): () => void {
  open.push(entry);
  useOpenCards.setState(counted());
  return () => {
    const at = open.indexOf(entry);
    if (at >= 0) open.splice(at, 1);
    useOpenCards.setState(counted());
  };
}

/** The top card closed; whether there was one. */
export function closeTopCard(): boolean {
  const top = open[open.length - 1];
  if (!top) return false;
  top.close();
  return true;
}
