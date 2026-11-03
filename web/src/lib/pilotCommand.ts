/**
 * What the pilot asked of the app by voice, from the map's microphone
 * (RadioLayer's pill), beside the ATC clearance the pill reads
 * (lib/clearance, lib/heardCall): in flight the phone's microphone hears
 * the pilot and not ATC through a headset, so the pilot's own words are
 * the one sure input (the owner, 2026-11-03). Nothing is done of a
 * command until its chip is tapped. The words are the clearance reader's
 * tokens, so figures and the ICAO alphabet read as they do there: "one
 * nine right" is runway 19R, "kilo mike kilo echo" KMKE.
 */
import { placeWords, tokens, type Token } from "./clearance";
import { directOf } from "./heardCall";

/** The approaches as said, each the start of the FAA's name for it in
 *  the planner's procedures (CIFP: "ILS RWY 19R", "RNAV (GPS) RWY 13",
 *  "RNAV (RNP) Y RWY 07R", "VOR RWY 31"). */
export const APPROACHES: Record<string, string> = {
  ils: "ILS", localizer: "LOC", loc: "LOC", rnav: "RNAV", gps: "RNAV (GPS)", rnp: "RNAV (RNP)", vor: "VOR", ndb: "NDB", visual: "VISUAL",
};

export type PilotCommand =
  | { kind: "direct"; place: string }
  | { kind: "nearest" }
  | { kind: "altitude"; ft: number }
  /** An approach to show in the procedures sheet: its kind as the FAA
   *  names it, its runway ("19R") where one was said, and the field's
   *  words where one was ("at Milwaukee"); none, the destination's. */
  | { kind: "procedure"; approach: string; runway: string | null; field: string | null }
  /** The weather at a field, said and shown; none, the destination's. */
  | { kind: "weather"; field: string | null }
  | { kind: "timer"; start: boolean }
  /** "Plan a trip to Las Vegas", "fly to Duluth", "take me to kilo lima
   *  alpha sierra": a route to the place, from the route's departure or
   *  from where the airplane is (PlanWorkspace's planTo). */
  | { kind: "destination"; place: string };

const SIDES: Record<string, string> = { left: "L", right: "R", center: "C", centre: "C", l: "L", r: "R", c: "C" };
const WEATHER_WORDS = new Set(["weather", "metar", "wx", "conditions"]);
const FIELD_AFTER = new Set(["at", "for", "into", "to"]);
/** Words that end a field's name. */
const FIELD_ENDS = new Set([
  "and", "then", "please", "now", "approach", "weather", "metar", "nearest", "direct", "timer", "altitude", "climb", "descend",
  "show", "me", "the", "give", "what", "is",
]);
/** The most words a field's name is taken to have ("general mitchell international"). */
const FIELD_WORDS = 4;

/** The field named after "at" (or "for", "into", "to") from `from` on, as
 *  words for the planner to find; null where none is. */
function fieldAfter(toks: Token[], from: number): string | null {
  const at = toks.findIndex((t, i) => i >= from && FIELD_AFTER.has(t.word));
  if (at < 0) return null;
  const words: Token[] = [];
  for (let i = at + 1; i < toks.length && words.length < FIELD_WORDS; i++) {
    const t = toks[i]!;
    if (t.word === "the" && !words.length) continue;
    if (FIELD_ENDS.has(t.word) || t.word === "airport") break;
    words.push(t);
  }
  return placeWords(words) || null;
}

/** A runway said after `from`: "one nine right" 19R, "runway three six"
 *  36, "zero four" 04; null where none is within the next few words. */
function runwayAfter(toks: Token[], from: number): { runway: string; end: number } | null {
  for (let i = from; i < Math.min(toks.length, from + 3); i++) {
    const t = toks[i]!;
    if (t.word === "runway" || t.word === "approach") continue;
    const n = t.num;
    if (!n || n.includes(".") || Number(n) < 1 || Number(n) > 36) return null;
    const side = toks[i + 1] && SIDES[toks[i + 1]!.word];
    return { runway: String(Number(n)).padStart(2, "0") + (side ?? ""), end: i + (side ? 2 : 1) };
  }
  return null;
}

/** An altitude said as "altitude five thousand" or "altitude flight
 *  level two one zero": a clearance's "climb and maintain" is the
 *  clearance reader's own (readClearance). */
function altitudeOf(toks: Token[]): number | null {
  const at = toks.findIndex(t => t.word === "altitude");
  if (at < 0) return null;
  const next = toks[at + 1];
  if (next?.word === "flight" && toks[at + 2]?.word === "level" && toks[at + 3]?.num) return Number(toks[at + 3]!.num) * 100;
  const n = next?.num;
  return n && !n.includes(".") && Number(n) >= 500 && Number(n) < 60000 ? Number(n) : null;
}

/** The commands in what the pilot said, each kind once, in the order
 *  they came. */
export function commandsOf(text: string): PilotCommand[] {
  const toks = tokens(text);
  const out: PilotCommand[] = [];
  const direct = directOf(text);
  if (direct) out.push({ kind: "direct", place: direct });
  if (toks.some(t => t.word === "nearest")) out.push({ kind: "nearest" });
  const ft = altitudeOf(toks);
  if (ft !== null) out.push({ kind: "altitude", ft });
  // An approach: its word with a runway or "approach" by it ("the ILS one
  // nine right", "RNAV approach at Duluth"), so a clearance's "direct the
  // VOR" is not one.
  const approachAt = toks.findIndex((t, i) => t.word in APPROACHES && (runwayAfter(toks, i + 1) !== null || toks.slice(i + 1, i + 4).some(x => x.word === "approach")));
  if (approachAt >= 0) {
    const runway = runwayAfter(toks, approachAt + 1);
    out.push({ kind: "procedure", approach: APPROACHES[toks[approachAt]!.word]!, runway: runway?.runway ?? null, field: fieldAfter(toks, runway?.end ?? approachAt + 1) });
  }
  const weatherAt = toks.findIndex(t => WEATHER_WORDS.has(t.word));
  if (weatherAt >= 0) out.push({ kind: "weather", field: fieldAfter(toks, weatherAt + 1) });
  if (toks.some(t => t.word === "timer" || t.word === "stopwatch")) {
    out.push({ kind: "timer", start: !toks.some(t => t.word === "stop" || t.word === "reset" || t.word === "cancel") });
  }
  const place = destinationOf(toks);
  if (place && !direct) out.push({ kind: "destination", place });
  return out;
}

/** The words that ask for a route somewhere: "plan a trip to", "fly to",
 *  "take me to", "go to", "route to", "flight to". */
const TRIP_WORDS = new Set(["trip", "fly", "flight", "route", "go", "plan"]);

/** The place a trip is asked to ("plan a trip to Las Vegas", "fly to
 *  Duluth", "take me to kilo lima alpha sierra"), as words; null where
 *  none is asked. The clearance's "cleared to" is the clearance reader's. */
function destinationOf(toks: Token[]): string | null {
  const to = toks.findIndex((t, i) => t.word === "to" && i > 0 && (TRIP_WORDS.has(toks[i - 1]!.word) || (toks[i - 1]!.word === "me" && toks[i - 2]?.word === "take")));
  if (to < 0) return null;
  const words: Token[] = [];
  for (let i = to + 1; i < toks.length && words.length < FIELD_WORDS; i++) {
    const t = toks[i]!;
    if (t.word === "the" && !words.length) continue;
    if (FIELD_ENDS.has(t.word) || t.word === "airport") break;
    words.push(t);
  }
  return placeWords(words) || null;
}
