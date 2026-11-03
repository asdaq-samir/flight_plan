/**
 * The pilot's readback of a clearance checked against it (AIM 4-4-7 b:
 * pilots read back "those parts of ATC clearances and instructions
 * containing altitude assignments, vectors, or runway assignments", and
 * 4-4-7 b.3 the altimeter, frequencies and codes): the limit, the places
 * of the route, the altitude to maintain and the one to expect, the
 * frequency and the squawk, each as the clearance reader finds it in the
 * readback (lib/clearance) or, said bare as a readback often is ("five
 * thousand, one two five point three five, four five one two"), as its
 * figures among the readback's. What was missed or said differently is
 * shown as a warning line in the microphone's pill (RadioLayer); it never
 * stops anything.
 */
import { placeWords, readClearance, tokens, type Clearance } from "./clearance";

export interface ReadbackItem {
  item: "limit" | "route" | "altitude" | "expect" | "frequency" | "squawk";
  cleared: string;
  /** What the readback had for it; null where it was not read back. */
  said: string | null;
}

/** An altitude as ATC says it (AIM 4-2-9): feet below 18,000, a flight
 *  level from there up. */
export const altitudeWords = (ft: number) => (ft >= 18000 ? `FL${Math.round(ft / 100)}` : `${ft.toLocaleString("en-US")} ft`);

/** A place's words as they are compared: lower case, "the" and
 *  "airport" left out. */
const placeKey = (said: string) => said.toLowerCase().split(/\s+/).filter(w => w && w !== "the" && w !== "airport").join(" ");

/** The items of `cleared` the readback `said` missed or had differently;
 *  none where it matches. */
export function readbackCheck(cleared: Clearance, said: string): ReadbackItem[] {
  const back = readClearance(said);
  const toks = tokens(said);
  const figures = new Set(toks.flatMap(t => (t.num ? [t.num] : [])));
  const words = ` ${placeKey(placeWords(toks))} `;
  const out: ReadbackItem[] = [];
  // A figure read bare counts as read back (a flight level as its own
  // figure, "flight level two one zero"); one the reader found counts as
  // what was said. Figures said one after another with no word between
  // are one figure to the tokens, as they are to a recognizer.
  const bare = (value: number | string) => figures.has(String(value)) || (typeof value === "number" && value >= 18000 && figures.has(String(value / 100)));
  const figure = (item: ReadbackItem["item"], clearedValue: number | string | null, saidValue: number | string | null, say: (v: number | string) => string) => {
    if (clearedValue === null) return;
    const heard = saidValue ?? (bare(clearedValue) ? clearedValue : null);
    if (heard !== clearedValue) out.push({ item, cleared: say(clearedValue), said: heard === null ? null : say(heard) });
  };
  if (cleared.limit) {
    const key = placeKey(cleared.limit);
    const heard = back.limit ? placeKey(back.limit) : words.includes(` ${key} `) ? key : null;
    if (heard !== key) out.push({ item: "limit", cleared: cleared.limit, said: heard === null ? null : back.limit });
  }
  for (const item of cleared.route) {
    if (item.kind === "places") {
      for (const place of placeKey(item.said).split(" ")) {
        if (!words.includes(` ${place} `)) out.push({ item: "route", cleared: place.toUpperCase() === place ? place : item.said, said: null });
      }
    } else if (item.kind === "airway" && !words.includes(` ${item.ident.toLowerCase()} `)) {
      out.push({ item: "route", cleared: item.ident, said: null });
    } else if (item.kind === "heading" && !figures.has(String(item.degrees))) {
      out.push({ item: "route", cleared: `heading ${item.degrees}`, said: null });
    }
  }
  figure("altitude", cleared.maintainFt, back.maintainFt, v => altitudeWords(Number(v)));
  figure("expect", cleared.expectFt, back.expectFt, v => altitudeWords(Number(v)));
  figure("frequency", cleared.frequency, back.frequency, v => String(v));
  figure("squawk", cleared.squawk, back.squawk, v => String(v));
  return out;
}

const ITEM_WORDS: Record<ReadbackItem["item"], string> = {
  limit: "cleared to", route: "route", altitude: "altitude", expect: "expect", frequency: "frequency", squawk: "squawk",
};

/** The warning line: "Readback: altitude 5,000 ft said, 4,000 ft cleared;
 *  squawk not read back". */
export function readbackWords(items: ReadbackItem[]): string {
  if (!items.length) return "Readback complete.";
  const parts = items.map(i => (i.said === null ? `${ITEM_WORDS[i.item]} ${i.cleared} not read back` : `${ITEM_WORDS[i.item]} ${i.said} said, ${i.cleared} cleared`));
  return `Readback: ${parts.join("; ")}.`;
}
