/**
 * The cards open in the map's panel (CardHead's), and the lists in full
 * (ListPageHead's), the last opened on top: a device's own Back --
 * Android's, a TV remote's (lib/back) -- closes the top one, as its close
 * or its Back does, before the panel is lowered. A card over a list (an
 * airport's over Nearest's) is closed first, then the list.
 */
import { useEffect, useRef } from "react";
import { create } from "zustand";

/** The cards of the route whose Share is a menu of the route's things,
 *  each its own (ShareMenu's `card`). */
export type RouteCard = "brief" | "navlog" | "profile";

/** A card's share: its own, or one of the route's cards, whose Share menu
 *  is the route's things that card has (the Brief's Print the briefing). */
export type CardShare = (() => void) | RouteCard;

/** `picture`: the card draws its own head over a picture, its share and
 *  its close on it (an airport's, an airplane's), so out of the pill the
 *  panel leaves the minimized bar out over it (MapPanel). */
type OpenCard = { close: () => void; inBar?: boolean; share?: CardShare; picture?: boolean };

const open: OpenCard[] = [];

/** How many cards are open whose way back is the minimized tab bar's Back
 *  (TabBar): a list's is its own head's, so it is not counted. The top
 *  one's share, where it has one (an airport's, an airplane's, the Brief's
 *  and the nav log's): the bar's Share in place of its Back, at the
 *  owner's ask. And whether the top card draws its own head over a
 *  picture (`picture`). */
export const useOpenCards = create<{ count: number; total: number; share: CardShare | null; picture: boolean }>(
  () => ({ count: 0, total: 0, share: null, picture: false }));

/** And `total`: every one open, lists and Setup's pages too, for the bar's
 *  close to say it goes back. */
function counted() {
  const inBar = open.filter(entry => entry.inBar !== false);
  return { count: inBar.length, total: open.length, share: inBar.at(-1)?.share ?? null, picture: !!open.at(-1)?.picture };
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

/**
 * A card kept open while it is drawn: its close for a
 * device's Back and the bar's, and its share for the bar's Share. A card
 * whose head is a picture with its own share and close on it says so
 * (`picture`), and the panel leaves the minimized bar out over it out of
 * the pill (PhotoHead).
 */
export function useHeldCard(onClose: () => void, onShare?: CardShare, picture = false) {
  const close = useRef(onClose);
  const share = useRef(onShare);
  useEffect(() => { close.current = onClose; share.current = onShare; });
  const shares = typeof onShare === "string" ? onShare : !!onShare;
  useEffect(() => holdOpenCard({
    close: () => close.current(),
    share: typeof shares === "string" ? shares : shares ? () => { if (typeof share.current === "function") share.current(); } : undefined,
    picture,
  }), [shares, picture]);
}
