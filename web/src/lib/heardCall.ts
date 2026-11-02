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
 * The native app's Swift copy is `HeardCall` (ios/Wingtip/HeardCall.swift),
 * both checked against fixtures/heardCalls.json.
 */
import { DIGITS, LETTERS, placeWords, readClearance, tokens, type Clearance, type Token } from "./clearance";

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

/** The runs of letters and figures in what was heard, each where it
 *  starts and the word before it: "Cessna three alpha bravo" is "3AB"
 *  after "cessna". A word a recognizer wrote whole ("N123AB") is its own. */
function runs(text: string): { run: string; at: number; before: string | null }[] {
  const words = text.toLowerCase().replace(/x[- ]ray/g, "xray").match(/[a-z0-9]+/g) ?? [];
  const mark = (w: string) => LETTERS[w] ?? DIGITS[w] ?? (/^\d+$/.test(w) || (/\d/.test(w) && /^[a-z0-9]+$/.test(w)) ? w.toUpperCase() : null);
  const out: { run: string; at: number; before: string | null }[] = [];
  for (let i = 0; i < words.length;) {
    if (mark(words[i]!) === null) { i++; continue; }
    let run = "", j = i;
    while (j < words.length && mark(words[j]!) !== null) run += mark(words[j++]!);
    out.push({ run, at: i, before: i > 0 ? words[i - 1]! : null });
    i = j;
  }
  return out;
}

/** Whether the transmission is said to the airplane `tail` ("N123AB"). */
export function ourCall(text: string, tail: string): boolean {
  const full = tail.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,7}$/.test(full)) return false;
  const body = full.startsWith("N") ? full.slice(1) : full;
  const last = body.slice(-3);
  return runs(text).some(({ run, at, before }) => at <= CALL_WITHIN && (
    run === full || run === `N${body}` || run === body || run === `N${last}`
    // The last three alone only after a type's name.
    || (run === last && before !== null && TYPE_WORDS.has(before))
  ));
}

/** Words that end the place after "direct". */
const AFTER_DIRECT = new Set([
  "then", "climb", "maintain", "descend", "contact", "squawk", "expect", "cross", "at", "and", "when", "resume", "report",
  "cleared", "fly", "heading", "intercept", "join", "hold", "for", "via", "own", "navigation", "after",
]);

/** The place a "direct" sends us to, as words for the planner to find
 *  ("gopher", "KDLH"), or null where none was said. */
export function directOf(text: string): string | null {
  const toks = tokens(text);
  const at = toks.findIndex(t => t.word === "direct");
  if (at < 0) return null;
  const place: Token[] = [];
  for (let i = at + 1; i < toks.length && place.length < 6; i++) {
    const t = toks[i]!;
    if (t.word === "to" || t.word === "the") { if (!place.length) continue; break; }
    if (AFTER_DIRECT.has(t.word) || (t.num && !place.some(p => p.word in LETTERS))) break;
    place.push(t);
  }
  return placeWords(place) || null;
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
