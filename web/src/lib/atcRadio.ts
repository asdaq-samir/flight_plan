/**
 * The radio as the phone hears it, while the pilot leaves it listening
 * (lib/listen): the transmissions in order, the one being said growing
 * as it is, each marked where it was said to us (lib/heardCall), for the
 * captions over the map, a call to us with its actions (RadioCall), and
 * the clearance card's log. Kept while the page is; nothing is sent
 * anywhere or saved. The listening itself is lib/atcListening's, loaded
 * with the card that starts it, and the input it hears through lib/
 * audioInput's, which this store names and meters.
 */
import { create } from "zustand";
import { takesTrack } from "./listen";
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
  /** The input the phone hears through while lib/audioInput holds one
   *  (the Radio card's Listen through, or a listening session after one
   *  was chosen), for the pill, the captions and the card to name; null
   *  while none is held, as in every browser that cannot pick one. */
  input: HeardInput | null;
  /** Stops the ATIS being heard (lib/atis's hearAtis), while it is: the
   *  radio or the microphone started meanwhile stops it first, so one
   *  recognizer listens at a time. */
  atisStop: (() => void) | null;
}

/** The input heard through, as lib/audioInput last read it off its track. */
export interface HeardInput {
  /** By the name the browser gives it ("GMA 350c", "iPhone Microphone");
   *  once lost, the one that was chosen. */
  label: string;
  /** Not the phone's or the computer's own microphone: an audio panel or
   *  headset over Bluetooth, or a cable. */
  outside: boolean;
  /** The outside input chosen is no longer heard. */
  lost: boolean;
  /** Why, as far as the page can tell: gone from the browser's list of
   *  inputs ("disconnected"); its capture ended while still listed
   *  ("ended"); the phone's route moved to another input while it is still
   *  listed ("moved"), as starting Safari's recognizer may do (WebKit's
   *  shared capture unit clears the preferred input); or not to be had
   *  when listening began ("missing"). Null while it is heard. */
  why: "disconnected" | "ended" | "moved" | "missing" | null;
  /** Once lost, what is heard in its place, where the browser names it. */
  instead: string | null;
  /** The capture paused by the browser or the phone (the track muted, as
   *  iOS does for a call or Siri): no sound reaches the page until it goes
   *  on, whatever the input sends, so the bars are still. */
  paused: boolean;
}

export const useAtcRadio = create<AtcRadio>(() => ({
  listening: false, error: null, heard: [], seen: null, cardOpen: false, cardText: null, tail: null, near: "", mode: null, pill: null, input: null,
  atisStop: null,
}));

/**
 * A lost input in a pilot's words, the same line in the pill, the captions
 * and the card, worded by what is known rather than a guessed cause: "GMA
 * 350c disconnected" only once it has left the browser's list of inputs.
 */
export function lostWords(input: HeardInput): string {
  const own = input.instead?.match(/^(.*\S)\s+Microphone$/i);
  const instead = own ? `the ${own[1]} microphone` : input.instead || "the default microphone";
  if (input.why === "moved") return `Not hearing ${input.label}, ${instead} took over; choose it again in Listen through`;
  if (input.why === "missing") return `${input.label} not found; hearing ${instead}`;
  if (input.why === "ended") return `${input.label} is no longer heard; hearing ${instead}`;
  return `${input.label} disconnected; hearing ${instead}`;
}

/**
 * The outside input the recognizer is known to hear, by its name: only
 * where it is handed the held track (lib/listen's takesTrack: Chrome and
 * Edge, Firefox 160, on the desktop). Safari's recognizer records the
 * route's input in a process of its own, and that it follows the input
 * held here is read from WebKit's code, not yet seen on a phone (the
 * Bluetooth research's claims 22 and 26, to be proved by the owner's
 * ground test): there the pill, the captions and the field say the input
 * is chosen, and keep the phone at the speaker as the way that is sure.
 */
export function heardThrough(input: HeardInput | null): string | null {
  return input && input.outside && !input.lost && !input.paused && takesTrack() ? input.label : null;
}

/** The outside input chosen and held, by its name, whether or not the
 *  recognizer is known to hear it (heardThrough). */
export function chosenOutside(input: HeardInput | null): string | null {
  return input && input.outside && !input.lost ? input.label : null;
}

type LevelListener = (level: number | null) => void;
const levelListeners = new Set<LevelListener>();
let lastLevel: number | null = null;

/**
 * The held input's sound level, 0 to 1, ten times a second while lib/
 * audioInput meters it, and null once it lets the input go: a plain
 * emitter beside the store rather than its state, so the Waveform's bars
 * are written through refs and ten updates a second re-render nothing on
 * the map page.
 */
export const inputLevel = {
  /** Called with each level, and at once with the last one while one is
   *  flowing; returns its unsubscribe. */
  listen(fn: LevelListener): () => void {
    levelListeners.add(fn);
    if (lastLevel !== null) fn(lastLevel);
    return () => { levelListeners.delete(fn); };
  },
  emit(level: number | null) {
    lastLevel = level;
    for (const fn of levelListeners) fn(level);
  },
};

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
