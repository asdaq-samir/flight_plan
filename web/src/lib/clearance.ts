/**
 * An ATC clearance as the phone heard it, read into its items: the words
 * a speech recognizer wrote (lib/listen) or the pilot typed, as AIM 4-4-3
 * lists what a clearance holds -- its limit, its departure procedure, the
 * route, the altitudes, the frequency and the beacon code. The places it
 * names are found by the planner (/api/clearance/places, wingtip.spoken),
 * and the route is put in only from the card, the pilot having read it
 * (ClearanceCard): nothing heard goes into the plan on its own.
 *
 * The reading itself is the shared engine's (native/crates/radio/src/clearance.rs,
 * asked through lib/engine as read_clearance and cleared_route): one
 * reader for the web app, the planner and the phones, held to
 * fixtures/clearances.json as this module's tests are. What stays here
 * is the tokenizer and the place words, which the pilot's own commands
 * (lib/pilotCommand) and the readback check (lib/readback) read with.
 */
import type { ClearanceFound, ClearanceFoundProcedure, ClearanceItem, ClearanceRoute, HeardToken } from "./engine/contract";
import { callEngine, type EngineAnswer } from "./engine/engine";
import type { TypedProcedure } from "./procedures";

/** A clearance read into its items, and a part of its route in the
 *  order it was said: the engine's contract's shapes (read_clearance). The
 *  maintain limit is "at or below" or "at or above" said before the
 *  altitude; the facility whose frequency it is ("departure", "center");
 *  classB "cleared into the Class Bravo airspace" (14 CFR 91.131(a)(1)). */
export type Clearance = EngineAnswer<"read_clearance">;
export type ClearedItem = ClearanceItem;

/** A word, or a number made of the figures said in a row. */
export type Token = HeardToken;

/** The words, with each run of figures one number: "one two five point
 *  three five" is 125.35, "five thousand" 5000, "flight level two one
 *  zero" the words and 210 (AIM 4-2-8, 4-2-9), as the shared engine's
 *  tokenizer reads them (clearance.rs tokens, the rule `tokens`): the
 *  clearance reader's own words, which the pilot's commands
 *  (lib/pilotCommand) are read with too. */
export function tokens(text: string): Token[] {
  return callEngine("tokens", { text });
}

/** Words for a place as the planner looks them up: a run of the ICAO
 *  alphabet's words is the letters it spells ("kilo delta lima hotel" is
 *  KDLH), other words as said, lower case (the engine's place_words). */
export function placeWords(toks: Token[]): string {
  return callEngine("place_words", { tokens: toks });
}

/** The clearance in what was heard: everything after "cleared" (the
 *  call sign before it left out), its altitudes, frequency and code
 *  wherever they were said -- a squawk alone, as flight following's, is
 *  one too. Read by the shared engine (native/crates/radio/src/clearance.rs,
 *  the rule read_clearance), the one reader the planner and the phones
 *  have, held to fixtures/clearances.json as this module's tests are. */
export function readClearance(text: string): Clearance {
  return callEngine("read_clearance", { text });
}

/** Whether anything of a clearance was heard at all. */
export const heardAny = (c: Clearance) =>
  !!(c.limit || c.route.length || c.asFiled || c.maintainFt || c.expectFt || c.frequency || c.squawk || c.classB);

/** The planner's places for the clearance's (ClearancePlaces). */
export type FoundPlace = ClearanceFound & { said: string };
export interface Found {
  limit?: FoundPlace | null;
  route?: FoundPlace[][];
  departure?: ClearanceFoundProcedure | null;
  arrival?: ClearanceFoundProcedure | null;
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
export function clearedRoute(text: string, found: Found, planned: ClearanceRoute): EngineAnswer<"cleared_route"> {
  // From the words heard, which the engine reads again (0.4 ms), rather
  // than the Clearance read from them: one shape in, the fixtures' own.
  return callEngine("cleared_route", { text, found, planned });
}

/** The route cleared held against the one filed. */
export interface RouteDifference {
  same: boolean;
  /** Each way it differs ("to KHIB instead of KDLH", "adds GEP"), none
   *  where it is the same. */
  parts: string[];
  /** What differs, for after "Differs from what you filed:", or the line
   *  that nothing does. */
  words: string;
}

/**
 * The route cleared against the one filed, as the iPhone's
 * ClearanceCompare describes it: only the points that differ, since the
 * cleared points are idents with no positions until they are planned, so
 * the extra miles and minutes would want the planner, and the step is
 * read before the route goes in.
 */
export function routeDifference(
  planned: { stops: string[]; dest: string }, cleared: { stops: string[]; dest: string }, typed: TypedProcedure[] = [],
): RouteDifference {
  const parts: string[] = [];
  if (cleared.dest !== planned.dest && cleared.dest) {
    parts.push(planned.dest ? `to ${cleared.dest} instead of ${planned.dest}` : `to ${cleared.dest}`);
  }
  const added = cleared.stops.filter(s => !planned.stops.includes(s));
  const dropped = planned.stops.filter(s => !cleared.stops.includes(s));
  if (added.length && dropped.length) parts.push(`${added.join(" ")} instead of ${dropped.join(" ")}`);
  else if (added.length) parts.push(`adds ${added.join(" ")}`);
  else if (dropped.length) parts.push(`leaves out ${dropped.join(" ")}`);
  else if (parts.length === 0 && cleared.stops.join(" ") !== planned.stops.join(" ")) parts.push("the same points in another order");
  if (typed.length) parts.push(`with the ${typed.map(t => t.name).join(" and ")}`);
  if (parts.length === 0) return { same: true, parts, words: "The same route as you filed." };
  return { same: false, parts, words: `${parts.join("; ")}.` };
}
