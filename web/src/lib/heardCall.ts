/**
 * What the radio said, heard a transmission at a time (lib/radioStore),
 * and whether it was said to us: our call sign at its start, as a
 * controller addresses an airplane, in any of the forms AIM 4-2-4 lets
 * it take -- the whole registration with its N ("November One Two Three
 * Alpha Bravo"), the type in its place ("Cessna One Two Three Alpha
 * Bravo"), or, once talking, the prefix and its last three ("Cessna Three
 * Alpha Bravo", "November Three Alpha Bravo"). A call sign of more
 * figures that ends the same ("Cessna Six Three Alpha Bravo") is someone
 * else's: AIM 4-2-4 a.1 warns of exactly that. What it asks of us is read
 * as a clearance is (lib/clearance), and a "direct" to a place besides.
 *
 * The hearing is the shared engine's (native/crates/radio/src/clearance.rs,
 * asked through lib/engine as our_call, direct_of and call_pattern), held
 * to fixtures/heardCalls.json as this module's tests are.
 */
import { readClearance, type Clearance } from "./clearance";
import { callEngine } from "./engine/engine";

/** Whether the transmission is said to the airplane `tail` ("N123AB"):
 *  the engine's our_call, the runs of letters and figures heard against
 *  the registration's forms within the first words. */
export function ourCall(text: string, tail: string): boolean {
  return callEngine("our_call", { text, tail });
}

/** The place a "direct" sends us to, as words for the planner to find
 *  ("gopher", "KDLH"), or null where none was said: the engine's
 *  direct_of. */
export function directOf(text: string): string | null {
  return callEngine("direct_of", { text });
}

/** A transmission heard, and what it asks of us. */
export interface Call {
  forUs: boolean;
  direct: string | null;
  clearance: Clearance;
}

export function callOf(text: string, tail: string | null): Call {
  return { forUs: !!tail && ourCall(text, tail), direct: directOf(text), clearance: readClearance(text) };
}

/** Our call sign as a pattern over a recognizer's words, for the iOS
 *  app to tell a call to us while it is locked (SpeechPlugin.swift), as
 *  ourCall does: the registration with its N, or a type's name in its
 *  place, or the prefix and its last three, within the first words. Null
 *  where `tail` is no registration. The engine's call_pattern, so the
 *  phone can ask for it through wt_call too. */
export function callPattern(tail: string): string | null {
  return callEngine("call_pattern", { tail });
}
