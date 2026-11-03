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
import type { TypedProcedure } from "./procedures";

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
  /** Where the route is, its ends' "lat,lon;lat,lon", for the places the
   *  radio names to be looked for near (/api/clearance). */
  near: string;
  /** How it listens: once, from the map's microphone, as Siri does (the
   *  owner's pick A, 2026-11-02), or on and on from the Radio card, with
   *  the captions over the map. */
  mode: "once" | "radio" | null;
  /** The microphone's pill over the map: listening, then what was heard
   *  with what it offers, until put away. A readback is listened for with
   *  the clearance it reads back (`readbackOf`, lib/readback); a timer the
   *  pilot started by voice counts from `timerFrom`. */
  pill: { listening: boolean; text: string; error: string | null; readbackOf?: string | null; timerFrom?: number | null } | null;
}

export const useAtcRadio = create<AtcRadio>(() => ({
  listening: false, error: null, heard: [], seen: null, cardOpen: false, cardText: null, tail: null, near: "", mode: null, pill: null,
}));

/** The newest call to us not yet put away, settled. */
export function callToUs(s: Pick<AtcRadio, "heard" | "seen">): Transmission | null {
  const last = [...s.heard].reverse().find(t => t.forUs && t.final);
  return last && last.id !== s.seen ? last : null;
}

/** A route as the plan has it: either end may be missing. */
export interface PlannedRoute { dep: string; stops: string[]; dest: string }

/** What the radio can be acted on with, from the plan (PlanWorkspace): a
 *  direct to a place as said, which answers why not where it cannot; an
 *  altitude to fly; a clearance's route entered over the route planned,
 *  with its SID and STAR and the altitude it gives; and of the pilot's
 *  own commands (lib/pilotCommand), the Nearest list and an approach's
 *  page in the procedures sheet, which answers why not where it cannot. */
export const useRadioActions = create<{
  directTo: ((said: string) => Promise<string | null>) | null;
  fly: ((ft: number) => void) | null;
  route: PlannedRoute;
  enter: ((route: PlannedRoute, typed: TypedProcedure[], altitudeFt: number | null) => void) | null;
  nearest: (() => void) | null;
  showProcedure: ((ident: string, approach: string, runway: string | null) => Promise<string | null>) | null;
  /** A route planned to the place said ("plan a trip to Las Vegas"), from
   *  the route's departure or from where the airplane is; answers why it
   *  could not be. */
  planTo: ((place: string) => Promise<string | null>) | null;
}>(() => ({ directTo: null, fly: null, route: { dep: "", stops: [], dest: "" }, enter: null, nearest: null, showProcedure: null, planTo: null }));
