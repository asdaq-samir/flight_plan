/**
 * An ATC clearance as the phone heard it, read into its items: the words
 * a speech recognizer wrote (lib/listen) or the pilot typed, as AIM 4-4-3
 * lists what a clearance holds -- its limit, its departure procedure, the
 * route, the altitudes, the frequency and the beacon code. The places it
 * names are found by the planner (/api/clearance/places, vfr.spoken),
 * and the route is put in only from the card, the pilot having read it
 * (ClearanceCard): nothing heard goes into the plan on its own.
 *
 * The reading itself is the shared engine's (native/engine/src/clearance.rs,
 * asked through lib/engine as read_clearance and cleared_route): one
 * reader for the web app, the planner and the phones, held to
 * fixtures/clearances.json as this module's tests are. What stays here
 * is the tokenizer and the place words, which the pilot's own commands
 * (lib/pilotCommand) and the readback check (lib/readback) read with.
 */
import { callEngine } from "./engine/engine";
import type { TypedProcedure } from "./procedures";

/** A part of the route, in the order it was said. */
export type ClearedItem =
  | { kind: "vectors" }
  | { kind: "heading"; degrees: number }
  | { kind: "airway"; ident: string }
  | { kind: "departure" | "arrival"; name: string; number: string; transition: string | null }
  /** Words naming one place or more, for the planner to find. */
  | { kind: "places"; said: string };

export interface Clearance {
  /** The clearance limit as said ("Duluth airport"), none where none was. */
  limit: string | null;
  route: ClearedItem[];
  /** "...then as filed", or "as filed" (AIM 5-2-6): the filed route after
   *  what was said, which leaves out the filed altitude. */
  asFiled: boolean;
  maintainFt: number | null;
  /** "at or below" or "at or above" said before it; a Class B's "maintain
   *  VFR at or below 4,500" too. */
  maintainLimit: "at or below" | "at or above" | null;
  vfr: boolean;
  expectFt: number | null;
  /** Minutes after departure the expected altitude comes. */
  expectMin: number | null;
  /** "125.35", in the band ATC's VHF voice frequencies are. */
  frequency: string | null;
  /** Whose frequency: "departure", "center", "approach". */
  facility: string | null;
  squawk: string | null;
  /** "Cleared into the Class Bravo airspace" (14 CFR 91.131(a)(1)). */
  classB: boolean;
}

/** A word, or a number made of the figures said in a row. */
export interface Token { word: string; num?: string }

/** The words, with each run of figures one number: "one two five point
 *  three five" is 125.35, "five thousand" 5000, "flight level two one
 *  zero" the words and 210 (AIM 4-2-8, 4-2-9), as the shared engine's
 *  tokenizer reads them (clearance.rs tokens, the rule `tokens`): the
 *  clearance reader's own words, which the pilot's commands
 *  (lib/pilotCommand) are read with too. */
export function tokens(text: string): Token[] {
  return callEngine<Token[]>("tokens", { text });
}

/** Words for a place as the planner looks them up: a run of the ICAO
 *  alphabet's words is the letters it spells ("kilo delta lima hotel" is
 *  KDLH), other words as said, lower case (the engine's place_words). */
export function placeWords(toks: Token[]): string {
  return callEngine<string>("place_words", { tokens: toks });
}

/** The clearance in what was heard: everything after "cleared" (the
 *  call sign before it left out), its altitudes, frequency and code
 *  wherever they were said -- a squawk alone, as flight following's, is
 *  one too. Read by the shared engine (native/engine/src/clearance.rs,
 *  the rule read_clearance), the one reader the planner and the phones
 *  have, held to fixtures/clearances.json as this module's tests are. */
export function readClearance(text: string): Clearance {
  return callEngine<Clearance>("read_clearance", { text });
}

/** Whether anything of a clearance was heard at all. */
export const heardAny = (c: Clearance) =>
  !!(c.limit || c.route.length || c.asFiled || c.maintainFt || c.expectFt || c.frequency || c.squawk || c.classB);

/** The planner's places for the clearance's (ClearancePlaces). */
export interface FoundPlace { said: string; ident?: string | null; name?: string | null; kind?: string | null; sure?: boolean }
export interface Found {
  limit?: FoundPlace | null;
  route?: FoundPlace[][];
  departure?: { id: string; transition?: string | null } | null;
  arrival?: { id: string; transition?: string | null } | null;
}

/** What the planner is asked to find: the limit, each run of words for
 *  places, the SID and STAR said. */
export function placesAsked(c: Clearance) {
  const named = (kind: "departure" | "arrival") => {
    const p = c.route.find(item => item.kind === kind);
    return p && p.kind === kind ? { name: p.name, number: p.number, transition: p.transition } : null;
  };
  return {
    limit: c.limit,
    route: c.route.flatMap(item => (item.kind === "places" ? [item.said] : [])),
    departure: named("departure"),
    arrival: named("arrival"),
  };
}

/**
 * The route a clearance gives, from the route planned (`planned`): its
 * destination the limit where that is an airport; its stops the places
 * and airways said, in order, the SID's transition fix after the
 * departure and the STAR's before the destination; and with "then as
 * filed" the filed stops after the last one said that is among them, or
 * all of them where none is (AIM 5-2-6). The SID and STAR to pick, as the
 * route box's typed ones are (TypedProcedure).
 */
export function clearedRoute(text: string, found: Found, planned: { dep: string; stops: string[]; dest: string }): { route: { dep: string; stops: string[]; dest: string }; typed: TypedProcedure[] } {
  // From the words heard, which the engine reads again (0.4 ms), rather
  // than the Clearance read from them: one shape in, the fixtures' own.
  return callEngine("cleared_route", { text, found, planned });
}
