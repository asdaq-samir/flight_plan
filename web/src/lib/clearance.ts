/**
 * An ATC clearance as the phone heard it, read into its items: the words
 * a speech recognizer wrote (lib/listen) or the pilot typed, as AIM 4-4-3
 * lists what a clearance holds -- its limit, its departure procedure, the
 * route, the altitudes, the frequency and the beacon code. The places it
 * names are found by the planner (/api/clearance/places, vfr.spoken),
 * and the route is put in only from the card, the pilot having read it
 * (ClearanceCard): nothing heard goes into the plan on its own.
 *
 * The native app's Swift copy is `Clearance` (ios/Wingtip/Clearance.swift),
 * both checked against fixtures/clearances.json.
 */
import { MAX_STOPS, isAirwayToken } from "./identSchema";
import { sameField, type TypedProcedure } from "./procedures";

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

/** The ICAO alphabet (AIM 4-2-7, TBL 4-2-7), as a recognizer writes it. */
export const LETTERS: Record<string, string> = {
  alpha: "A", alfa: "A", bravo: "B", charlie: "C", delta: "D", echo: "E", foxtrot: "F", golf: "G", hotel: "H",
  india: "I", juliet: "J", juliett: "J", kilo: "K", lima: "L", mike: "M", november: "N", oscar: "O", papa: "P",
  quebec: "Q", romeo: "R", sierra: "S", tango: "T", uniform: "U", victor: "V", whiskey: "W", whisky: "W",
  xray: "X", yankee: "Y", zulu: "Z",
};

/** Figures said one by one (AIM 4-2-7: "tree", "fife", "niner"). */
export const DIGITS: Record<string, string> = {
  zero: "0", one: "1", two: "2", three: "3", tree: "3", four: "4", fower: "4", five: "5", fife: "5",
  six: "6", seven: "7", eight: "8", ait: "8", nine: "9", niner: "9",
};
/** An airway's number said whole (AIM 4-2-8: "Victor Twelve", "J Five
 *  Thirty-Three"), and minutes. */
const TEENS: Record<string, string> = {
  ten: "10", eleven: "11", twelve: "12", thirteen: "13", fourteen: "14", fifteen: "15", sixteen: "16",
  seventeen: "17", eighteen: "18", nineteen: "19",
};
const TENS: Record<string, string> = {
  twenty: "2", thirty: "3", forty: "4", fifty: "5", sixty: "6", seventy: "7", eighty: "8", ninety: "9",
};

/** The letter each kind of airway is filed by, as said. */
const AIRWAY_WORDS: Record<string, string> = {
  victor: "V", v: "V", tango: "T", t: "T", j: "J", jay: "J", juliet: "J", juliett: "J", q: "Q", quebec: "Q",
};

/** A word, or a number made of the figures said in a row. */
export interface Token { word: string; num?: string }

const isDigit = (word: string) => word in DIGITS || /^\d$/.test(word);
const digitOf = (word: string) => DIGITS[word] ?? word;

/** The words, with each run of figures one number: "one two five point
 *  three five" is 125.35, "three thousand five hundred" 3500, "one zero
 *  thousand" 10000 (AIM 4-2-8, 4-2-9). After "thousand" only a "five
 *  hundred" goes on: "seven thousand one zero minutes" is 7000 and 10. */
export function tokens(text: string): Token[] {
  const words = text.toLowerCase().replace(/x[- ]ray/g, "xray").replace(/(\d),(?=\d{3})/g, "$1")
    .match(/\d+(?:\.\d+)?|[a-z]+(?:'[a-z]+)?/g) ?? [];
  const out: Token[] = [];
  let i = 0;
  const isNumberWord = (w: string | undefined) => w !== undefined && (isDigit(w) || w in TEENS || w in TENS || /^\d+(\.\d+)?$/.test(w));
  while (i < words.length) {
    const w = words[i]!;
    if (!isNumberWord(w)) {
      out.push({ word: w });
      i++;
      continue;
    }
    let s = "", thousands = 0;
    const start = i;
    // A number written whole by the recognizer ("3000", "125.35") stands
    // alone, but for a thousand or a hundred after it.
    if (/^\d+(\.\d+)?$/.test(w) && !/^\d$/.test(w)) {
      s = w;
      i++;
    } else {
      while (i < words.length) {
        const x = words[i]!;
        if (isDigit(x) || (x === "oh" && s)) s += x === "oh" ? "0" : digitOf(x);
        else if (x in TEENS) s += TEENS[x];
        else if (x in TENS) {
          const next = words[i + 1];
          if (next && isDigit(next) && digitOf(next) !== "0") { s += TENS[x]! + digitOf(next); i++; }
          else s += `${TENS[x]}0`;
        } else break;
        i++;
      }
    }
    if (words[i] === "thousand") {
      thousands = Number(s || "1") * 1000;
      s = "";
      i++;
      // "four thousand five hundred": the hundreds go on, nothing else.
      if (words[i] && isDigit(words[i]!) && words[i + 1] === "hundred") {
        thousands += Number(digitOf(words[i]!)) * 100;
        i += 2;
      } else if (words[i] && /^\d00$/.test(words[i]!)) {
        thousands += Number(words[i]);
        i++;
      }
    } else if (words[i] === "hundred" && s) {
      thousands = Number(s) * 100;
      s = "";
      i++;
    }
    if ((words[i] === "point" || words[i] === "decimal") && words[i + 1] && isDigit(words[i + 1]!) && !thousands) {
      i++;
      let fraction = "";
      while (i < words.length && isDigit(words[i]!)) fraction += digitOf(words[i++]!);
      s = `${s}.${fraction}`;
    }
    out.push({ word: words.slice(start, i).join(" "), num: thousands ? String(thousands + Number(s || 0)) : s });
  }
  return out;
}

/** Aviation's VHF voice band, 118.000 to 136.975 MHz (47 CFR 87.173(b)'s
 *  table): a frequency out of it was misheard. A recognizer's "12535" is
 *  125.35. */
function frequencyOf(num: string): string | null {
  const value = num.includes(".") ? Number(num) : /^1[123]\d{2,4}$/.test(num) ? Number(`${num.slice(0, 3)}.${num.slice(3)}`) : NaN;
  return value >= 118 && value <= 136.975 ? value.toFixed(num.includes(".") ? Math.max(1, num.split(".")[1]!.length) : Math.max(1, num.length - 3)) : null;
}

/** A beacon code: "one of the 4096 discrete codes, a four-digit code
 *  designation" (AIM 4-1-20) -- 8 to the fourth, so each figure 0 to 7. */
const SQUAWK = /^[0-7]{4}$/;

/** Words that end the clearance limit or the route: the altitudes, the
 *  frequency and the code come after them (AIM 4-4-3's order). */
const ALTITUDE_WORDS = new Set(["climb", "maintain", "descend", "cruise", "expect"]);
const AFTER_ROUTE = new Set([...ALTITUDE_WORDS, "squawk", "contact", "transponder"]);
const LIMIT_ENDS = new Set([...AFTER_ROUTE, "via", "as", "then", "radar", "vectors", "direct", "fly", "heading"]);
/** Words between places, not places: "then direct", "to". */
const BETWEEN = new Set(["then", "direct", "to", "and", "thence", "via", "the"]);

/** "Cleared ILS approach", "cleared visual": an approach, not a route. */
const APPROACH_WORDS = ["ils", "rnp", "rnav", "gps", "loc", "visual", "approach", "vor", "ndb"];

/** Whose a frequency is, said before it. */
const FACILITIES = ["departure", "center", "approach", "tower", "ground", "clearance", "information", "apron", "radio", "unicom", "director"];

/** "departure" as the frequency's, not a SID's: "departure frequency
 *  125.35", "departure control", "departure will be on 125.35". */
function isFacility(toks: Token[], i: number): boolean {
  const next = toks[i + 1];
  return !!next && (!!next.num || ["control", "frequency", "freq", "will", "is", "on"].includes(next.word));
}

/** An altitude at `i`: "flight level one niner zero" (AIM 4-2-9), or
 *  feet. With how many tokens it took. */
function altitudeAt(toks: Token[], i: number): { ft: number; used: number } | null {
  if (toks[i]?.word === "flight" && toks[i + 1]?.word === "level" && toks[i + 2]?.num) {
    return { ft: Number(toks[i + 2]!.num) * 100, used: 3 };
  }
  if (toks[i]?.word === "fl" && toks[i + 1]?.num) return { ft: Number(toks[i + 1]!.num) * 100, used: 2 };
  const n = toks[i]?.num;
  return n && !n.includes(".") && Number(n) >= 500 && Number(n) < 60000 ? { ft: Number(n), used: 1 } : null;
}

/** Words for a place as the planner looks them up: a run of the ICAO
 *  alphabet's words (with figures after them) is the letters it spells,
 *  "kilo delta lima hotel" KDLH, "charlie eight one" C81. */
export function placeWords(toks: Token[]): string {
  const out: string[] = [];
  for (let i = 0; i < toks.length;) {
    let j = i, spelled = "";
    while (j < toks.length && (toks[j]!.word in LETTERS || (spelled && toks[j]!.num && !toks[j]!.num!.includes(".")))) {
      spelled += toks[j]!.num ?? LETTERS[toks[j]!.word];
      j++;
    }
    if (j - i >= 2) {
      out.push(spelled);
      i = j;
    } else {
      out.push(toks[i]!.num ?? toks[i]!.word);
      i++;
    }
  }
  return out.join(" ");
}

/** The route's words, from after the limit to the altitudes, into its
 *  parts: radar vectors, airways, SIDs and STARs with their transitions,
 *  headings, and the places between. */
function routeOf(toks: Token[]): { route: ClearedItem[]; asFiled: boolean } {
  const route: ClearedItem[] = [];
  let asFiled = false, words: Token[] = [];
  const flush = () => {
    const said = placeWords(words).trim();
    if (said) route.push({ kind: "places", said });
    words = [];
  };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    if (t.word === "as" && toks[i + 1]?.word === "filed") {
      flush();
      asFiled = true;
      i++;
    } else if (t.word === "radar" && toks[i + 1]?.word === "vectors") {
      flush();
      route.push({ kind: "vectors" });
      i++;
    } else if (t.word === "vectors") {
      flush();
      route.push({ kind: "vectors" });
    } else if (t.word in AIRWAY_WORDS && toks[i + 1]?.num && /^\d{1,4}$/.test(toks[i + 1]!.num!) && !words.some(w => w.word in LETTERS)) {
      flush();
      route.push({ kind: "airway", ident: `${AIRWAY_WORDS[t.word]}${toks[i + 1]!.num}` });
      i++;
    } else if (t.word === "heading" && toks[i + 1]?.num) {
      flush();
      route.push({ kind: "heading", degrees: Number(toks[i + 1]!.num) });
      i++;
    } else if ((t.word === "departure" || t.word === "arrival") && words.length >= 2 && words.at(-1)!.num) {
      // "Bunyan One departure": the name, then its number.
      const number = words.at(-1)!.num!;
      const name = placeWords(words.slice(0, -1));
      words = [];
      let transition: string | null = null;
      const end = toks.findIndex((x, k) => k > i && x.word === "transition");
      if (end > i && end - i <= 4) {
        transition = placeWords(toks.slice(i + 1, end).filter(x => !BETWEEN.has(x.word))) || null;
        i = end;
      }
      route.push({ kind: t.word, name, number, transition });
    } else if (BETWEEN.has(t.word) || t.word === "fly" || t.word === "after") {
      flush();
    } else {
      words.push(t);
    }
  }
  flush();
  return { route, asFiled };
}

/** The clearance in what was heard: everything after "cleared" (the
 *  call sign before it left out), its altitudes, frequency and code
 *  wherever they were said -- a squawk alone, as flight following's, is
 *  one too. */
export function readClearance(text: string): Clearance {
  const toks = tokens(text);
  const out: Clearance = {
    limit: null, route: [], asFiled: false, maintainFt: null, maintainLimit: null, vfr: false,
    expectFt: null, expectMin: null, frequency: null, facility: null, squawk: null, classB: false,
  };
  const cleared = toks.findIndex(t => t.word === "cleared" || t.word === "clear");
  // Where the limit and the route were read, which the rest is not
  // looked for in: the altitudes, frequency and code are said before
  // "cleared" too ("climb flight level seven zero and cleared to...").
  let from = toks.length, rest = 0;
  if (cleared >= 0) {
    from = cleared;
    let i = cleared + 1;
    if (["into", "through"].includes(toks[i]?.word ?? "")) {
      // A Class B's: "cleared into the Class Bravo airspace".
      out.classB = toks.slice(i, i + 5).some(t => t.word === "bravo" || t.word === "b");
      i = toks.findIndex((t, k) => k > i && t.word === "airspace") + 1 || i + 4;
    } else if (["for", "on", ...APPROACH_WORDS].includes(toks[i]?.word ?? "") || (toks[i]?.word === "to" && toks[i + 1]?.word === "land")) {
      // "Cleared for takeoff", "cleared to land", "cleared ILS approach":
      // no route in it, the altitudes after it still read.
    } else {
      if (toks[i]?.word === "to" || toks[i]?.num === "2") i++;
      const start = i;
      while (i < toks.length && !LIMIT_ENDS.has(toks[i]!.word) && !(toks[i]!.word === "departure" && isFacility(toks, i))) {
        i++;
        if (toks[i - 1]!.word === "airport") break;
      }
      out.limit = placeWords(toks.slice(start, i).filter(t => t.word !== "the")) || null;
      const end = toks.findIndex((t, k) => k >= i && (AFTER_ROUTE.has(t.word) || (t.word === "departure" && isFacility(toks, k))));
      const { route, asFiled } = routeOf(toks.slice(i, end < 0 ? toks.length : end));
      out.route = route;
      out.asFiled = asFiled;
      i = end < 0 ? toks.length : end;
    }
    rest = i;
  }
  for (let i = 0; i < toks.length; i++) {
    if (i >= from && i < rest) i = rest;
    const t = toks[i];
    if (!t) break;
    if (["maintain", "cruise", "climb", "descend"].includes(t.word) && out.maintainFt === null) {
      // "Climb and maintain" is read at its "maintain"; "climb to five
      // thousand", "descend flight level seven zero" at the verb.
      let k = i + 1;
      while ((t.word === "climb" || t.word === "descend") && ["to", "initially", "altitude"].includes(toks[k]?.word ?? "")) k++;
      if (toks[k]?.word === "vfr") { out.vfr = true; k++; }
      if (toks[k]?.word === "at" && toks[k + 1]?.word === "or" && (toks[k + 2]?.word === "below" || toks[k + 2]?.word === "above")) {
        out.maintainLimit = `at or ${toks[k + 2]!.word as "below" | "above"}`;
        k += 3;
      }
      const alt = altitudeAt(toks, k);
      if (alt) { out.maintainFt = alt.ft; i = k + alt.used - 1; }
    } else if (t.word === "expect" && out.expectFt === null) {
      const alt = altitudeAt(toks, i + 1);
      if (!alt) continue;
      out.expectFt = alt.ft;
      i += alt.used;
      // "...one zero minutes after departure".
      const minutes = toks.slice(i + 1, i + 4).findIndex(x => x.word === "minutes" || x.word === "minute" || x.word === "min");
      if (minutes > 0 && toks[i + minutes]?.num) out.expectMin = Number(toks[i + minutes]!.num);
    } else if (t.word === "squawk" || t.word === "transponder" || t.word === "code") {
      const code = toks.slice(i + 1, i + 3).find(x => x.num)?.num;
      if (code && SQUAWK.test(code) && out.squawk === null) out.squawk = code;
    } else if (t.num && out.frequency === null) {
      const frequency = frequencyOf(t.num);
      const said = toks.slice(Math.max(0, i - 4), i).map(x => x.word);
      const facility = said.reverse().find(w => FACILITIES.includes(w));
      if (frequency && (facility || said.includes("contact") || said.includes("monitor") || said.includes("frequency"))) {
        out.frequency = frequency;
        out.facility = facility ?? null;
      }
    }
  }
  return out;
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
export function clearedRoute(c: Clearance, found: Found, planned: { dep: string; stops: string[]; dest: string }) {
  const dest = found.limit?.kind === "airport" && found.limit.ident ? found.limit.ident : planned.dest;
  const said: string[] = [];
  const typed: TypedProcedure[] = [];
  let placeRun = 0;
  for (const item of c.route) {
    if (item.kind === "places") {
      for (const p of found.route?.[placeRun] ?? []) if (p.ident) said.push(p.ident);
      placeRun++;
    } else if (item.kind === "airway") {
      said.push(item.ident);
    } else if (item.kind === "departure" && found.departure) {
      typed.push({ name: found.departure.id, before: planned.dep || null, after: found.departure.transition ?? null });
      if (found.departure.transition) said.push(found.departure.transition);
    } else if (item.kind === "arrival" && found.arrival) {
      if (found.arrival.transition) said.push(found.arrival.transition);
      typed.push({ name: found.arrival.id, before: found.arrival.transition ?? null, after: dest || null });
    }
  }
  let stops = said;
  if (c.asFiled) {
    const last = [...said].reverse().find(s => !isAirwayToken(s) && planned.stops.some(p => sameField(p, s)));
    const from = last ? planned.stops.findIndex(p => sameField(p, last)) + 1 : 0;
    stops = [...said, ...planned.stops.slice(from)];
  }
  // Not the ends again, nor one point twice in a row.
  stops = stops.filter((s, i) => !(i === 0 && sameField(s, planned.dep)) && !(i === stops.length - 1 && sameField(s, dest)))
    .filter((s, i, all) => i === 0 || !sameField(s, all[i - 1]!)).slice(0, MAX_STOPS);
  return { route: { dep: planned.dep, stops, dest }, typed };
}
