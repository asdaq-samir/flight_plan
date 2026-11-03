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
 * The hearing is the shared engine's (native/engine/src/clearance.rs,
 * asked through lib/engine as our_call and direct_of), held to
 * fixtures/heardCalls.json as this module's tests are; the call sign's
 * pattern for the iOS app's locked-screen listener is still written here.
 */
import { DIGITS, LETTERS, readClearance, type Clearance } from "./clearance";
import { callEngine } from "./engine/engine";

/** Words a pilot or controller puts before the registration in place of
 *  its N (AIM 4-2-4 b: "the aircraft type, model or manufacturer's
 *  name"), the common ones; "Tango" for an air taxi. */
const TYPE_WORDS = new Set([
  "cessna", "skyhawk", "skylane", "skylark", "centurion", "cardinal", "caravan", "citation", "piper", "cherokee", "warrior",
  "archer", "arrow", "dakota", "lance", "saratoga", "seneca", "seminole", "aztec", "navajo", "malibu", "cub", "cirrus",
  "mooney", "bonanza", "baron", "beech", "beechcraft", "king", "diamond", "katana", "grumman", "tiger", "cheetah", "yankee",
  "experimental", "lancair", "glasair", "vans", "rv", "sport", "helicopter", "robinson", "tango", "november",
]);

/** How far into a transmission our call sign may begin and still be the
 *  one it is said to: a controller says it first; a pilot's readback ends
 *  with it. */
const CALL_WITHIN = 3;

/** Whether the transmission is said to the airplane `tail` ("N123AB"):
 *  the engine's our_call (clearance.rs), the runs of letters and figures
 *  heard against the registration's forms within the first words. */
export function ourCall(text: string, tail: string): boolean {
  return callEngine<boolean>("our_call", { text, tail });
}

/** The place a "direct" sends us to, as words for the planner to find
 *  ("gopher", "KDLH"), or null where none was said: the engine's
 *  direct_of. */
export function directOf(text: string): string | null {
  return callEngine<string | null>("direct_of", { text });
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
 *  ourCall does here: the registration with its N, or a type's name in
 *  its place, or the prefix and its last three, within the first words.
 *  Null where `tail` is no registration. */
export function callPattern(tail: string): string | null {
  const full = tail.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,7}$/.test(full)) return null;
  const said: Record<string, string[]> = {};
  for (const [word, ch] of Object.entries({ ...LETTERS, ...DIGITS })) (said[ch] ??= []).push(word);
  const sayChars = (chars: string) => [...chars].map(ch => `(?:${[ch.toLowerCase(), ...(said[ch] ?? [])].join("|")})`).join("[\\s,-]*");
  const body = full.startsWith("N") ? full.slice(1) : full;
  const n = sayChars("N"), types = [...TYPE_WORDS].join("|");
  return `^\\W*(?:[a-z']+\\W+){0,${CALL_WITHIN}}?(?:(?:${n}[\\s,-]*)?${sayChars(body)}|${n}[\\s,-]*${sayChars(body.slice(-3))}|(?:${types})\\W+${sayChars(body.slice(-3))})\\b`;
}
