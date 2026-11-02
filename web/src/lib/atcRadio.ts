/**
 * The radio as the phone hears it, while the pilot leaves it listening
 * (lib/listen): the transmissions in order, the one being said growing
 * as it is, each marked where it was said to us (lib/heardCall), for the
 * captions over the map, a call to us with its actions (RadioCall), and
 * the clearance card's log. Kept while the page is; nothing is sent
 * anywhere or saved. The listening itself is lib/atcListening's, loaded
 * with the card that starts it.
 */
import { create } from "zustand";

export interface Transmission {
  id: number;
  /** When it began, ms. */
  at: number;
  text: string;
  final: boolean;
  forUs: boolean;
}

interface AtcRadio {
  listening: boolean;
  error: string | null;
  heard: Transmission[];
  /** The last call to us the pilot put away, by id. */
  seen: number | null;
  /** The clearance card, opened from the captions or a call's Enter
   *  Route, and the transmission it was opened with. */
  cardOpen: boolean;
  cardText: string | null;
  /** The airplane whose calls are ours (its registration), from the plan. */
  tail: string | null;
}

export const useAtcRadio = create<AtcRadio>(() => ({
  listening: false, error: null, heard: [], seen: null, cardOpen: false, cardText: null, tail: null,
}));

/** The newest call to us not yet put away, settled. */
export function callToUs(s: Pick<AtcRadio, "heard" | "seen">): Transmission | null {
  const last = [...s.heard].reverse().find(t => t.forUs && t.final);
  return last && last.id !== s.seen ? last : null;
}

/** What a call to us can be acted on with, from the plan (PlanWorkspace):
 *  a direct to a place as said, which answers why not where it cannot,
 *  and an altitude to fly. */
export const useRadioActions = create<{
  directTo: ((said: string) => Promise<string | null>) | null;
  fly: ((ft: number) => void) | null;
}>(() => ({ directTo: null, fly: null }));
