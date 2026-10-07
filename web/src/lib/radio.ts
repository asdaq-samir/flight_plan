/**
 * The radio calls for a route, worded as the AIM and AC 90-66C word them
 * (the roadmap's radio scripts, ACS PA.III.A): at each field the
 * weather broadcast to listen to first, then the tower's or the CTAF's
 * calls by what the field has; flight following on the way; and the
 * arrival -- the approach control first into Class B or C, the tower
 * into Class D, the CTAF's self-announcing elsewhere, the field's name
 * at both ends of each (AC 90-66C 9.8.1). Figures as they are spoken
 * (AIM 4-2-8, 4-2-9): "three thousand five hundred", "runway two
 * seven", "Cessna Three Four Five Sierra Papa".
 *
 * Words in [brackets] are the pilot's to fill in: the ATIS letter, where
 * they are on the field. A script to practise from and to have on the
 * kneeboard -- a controller may ask for something else, and the pilot
 * says what they ask.
 */
import type { Briefing, Frequency, Leg } from "./api/types";
import { compassWord, exitFor, runwayInUse, runwayNumber, type RunwayEnd } from "./pattern";

type Facilities = Briefing["airports"][string];

const DIGITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "niner"];
const LETTERS: Record<string, string> = {
  A: "Alfa", B: "Bravo", C: "Charlie", D: "Delta", E: "Echo", F: "Foxtrot", G: "Golf", H: "Hotel", I: "India",
  J: "Juliett", K: "Kilo", L: "Lima", M: "Mike", N: "November", O: "Oscar", P: "Papa", Q: "Quebec", R: "Romeo",
  S: "Sierra", T: "Tango", U: "Uniform", V: "Victor", W: "Whiskey", X: "X-ray", Y: "Yankee", Z: "Zulu",
};
const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/** A registration as it is spoken after the airplane's make, the N
 *  dropped (AIM 4-2-4): "N345SP" is "Three Four Five Sierra Papa". */
export function spokenTail(tail: string): string {
  return [...tail.trim().toUpperCase().replace(/^N(?=\d)/, "")]
    .map(c => (/\d/.test(c) ? capital(DIGITS[Number(c)]!) : LETTERS[c] ?? c))
    .join(" ");
}

/** The airplane's call sign: its make and its registration spoken, or
 *  its make and a blank where the planner has no registration for it. */
export function callSign(make: string, tail: string | null): string {
  return `${make} ${tail ? spokenTail(tail) : "[your registration]"}`;
}

/** An altitude below 18,000 ft as spoken (AIM 4-2-9): the thousands'
 *  digits, then the hundreds -- "one zero thousand five hundred". */
export function spokenAltitude(ft: number): string {
  const hundreds = Math.round(ft / 100);
  const thousands = Math.floor(hundreds / 10);
  const rest = hundreds % 10;
  const words = thousands > 0 ? [`${[...String(thousands)].map(d => DIGITS[Number(d)]).join(" ")} thousand`] : [];
  if (rest > 0) words.push(`${DIGITS[rest]} hundred`);
  return words.join(" ") || "zero";
}

/** A runway as spoken, digit by digit with its side: "two seven",
 *  "niner left", "six" for runway 06. */
export function spokenRunway(ident: string): string {
  const match = /^(\d+)([LCR]?)$/.exec(runwayNumber(ident).toUpperCase());
  if (!match) return ident;
  const side = { L: " left", C: " center", R: " right", "": "" }[match[2] as "L" | "C" | "R" | ""];
  return `${[...match[1]!].map(d => DIGITS[Number(d)]).join(" ")}${side}`;
}

/** What a pilot calls a field: its name without "Airport",
 *  "International" and the like -- "Waukegan" for Waukegan National
 *  Airport. */
export function placeName(name: string | null | undefined, ident: string): string {
  const cut = (name ?? "")
    .replace(/[-/(].*$/, "")
    .replace(/\b(international|national|regional|municipal|county|executive|memorial|airport|airfield|field|airpark)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return cut || ident;
}

/** A frequency's facility as it is called: its description's own name
 *  ("ROCKFORD TWR" is Rockford), else the field's. */
function facilityName(f: Frequency, field: string): string {
  const own = (f.description ?? "")
    .toUpperCase()
    .replace(/\b(TWR|TOWER|GND|GROUND|APP|DEP|APCH|APP\/DEP|A\/D|CLNC|DEL|CLD|CTAF|UNICOM|ATIS|AWOS|ASOS|RDO)\b/g, "")
    .replace(/[/\s]+/g, " ")
    .trim();
  return own ? own.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : field;
}

function find(frequencies: Frequency[], ...types: string[]): Frequency | null {
  for (const type of types) {
    const f = frequencies.find(x => (x.type ?? "").toUpperCase() === type && x.frequency_mhz != null);
    if (f) return f;
  }
  return null;
}

/** The CTAF: the one so called, else a UNICOM that is also the CTAF,
 *  else MULTICOM's 122.9 (AC 90-66C 9.6). */
function ctafOf(frequencies: Frequency[]): Frequency {
  return find(frequencies, "CTAF")
    ?? frequencies.find(f => (f.type ?? "").toUpperCase().startsWith("UNIC") && /CTAF/i.test(f.description ?? ""))
    ?? find(frequencies, "UNIC", "UNICOM")
    ?? { type: "MULTICOM", description: "MULTICOM", frequency_mhz: 122.9 };
}

export interface RadioCall {
  /** Who is called, or listened to: "Waukegan Tower", "ATIS". */
  to: string;
  mhz: number | null;
  /** What is said, or for a broadcast, what to listen for. */
  words: string;
  /** When, or why, where it is not plain. */
  note?: string;
  /** A broadcast listened to, not a station called. */
  listen?: boolean;
}

export interface RadioPhase {
  title: string;
  ident: string;
  kind: "departure" | "arrival";
  /** The runway in use, for the pattern card; null where none has a
   *  heading. */
  end: RunwayEnd | null;
  byWind: boolean;
  calls: RadioCall[];
}

export interface RadioInput {
  callSign: string;
  /** The airports landed at, in order, with the briefing's facilities. */
  airports: { ident: string; facilities: Facilities }[];
  legs: Leg[];
}

/** The legs from one airport to the next: the first leg out of `from`
 *  to the first leg into `to` after it. */
function hopLegs(legs: Leg[], from: string, to: string): Leg[] {
  const start = legs.findIndex(l => l.from === from);
  if (start < 0) return [];
  const end = legs.findIndex((l, i) => i >= start && l.to === to);
  return legs.slice(start, end < 0 ? undefined : end + 1);
}

/** At a part-time tower, what to do when it is closed: its CTAF. */
function whenClosed(frequencies: Frequency[]): string {
  const ctaf = find(frequencies, "CTAF");
  return ctaf ? ` When the tower is closed, self-announce on the CTAF, ${ctaf.frequency_mhz}.` : "";
}

function listenFirst(frequencies: Frequency[], field: string): RadioCall[] {
  const atis = find(frequencies, "ATIS");
  if (atis) return [{ to: `${field} ATIS`, mhz: atis.frequency_mhz ?? null, words: "The weather, the runway in use and the information letter.", listen: true }];
  const auto = find(frequencies, "AWOS", "ASOS");
  if (auto) return [{ to: `${field} ${(auto.type ?? "").toUpperCase()}`, mhz: auto.frequency_mhz ?? null, words: "The wind, the altimeter setting and the weather.", listen: true }];
  return [];
}

function departure(input: RadioInput, i: number): RadioPhase {
  const { ident, facilities } = input.airports[i]!;
  const next = input.airports[i + 1]!;
  const legs = hopLegs(input.legs, ident, next.ident);
  const first = legs[0] ?? null;
  const field = placeName(facilities.name, ident);
  const to = placeName(next.facilities.name, next.ident);
  const cs = input.callSign;
  const inUse = runwayInUse(facilities.runways);
  const runway = inUse ? `runway ${spokenRunway(inUse.end.ident)}` : "runway [in use]";
  const heading = first ? compassWord(first.true_course_deg) : "[direction]";
  const altitude = first ? spokenAltitude(first.altitude_ft) : "[altitude]";
  const f = facilities.frequencies;
  const calls = listenFirst(f, field);
  const tower = find(f, "TWR");
  if (tower) {
    const atis = find(f, "ATIS") ? ", with information [letter]" : "";
    const clearance = find(f, "CLD");
    if (clearance && (facilities.airspace_class === "B" || facilities.airspace_class === "C")) {
      calls.push({
        to: `${facilityName(clearance, field)} Clearance`, mhz: clearance.frequency_mhz ?? null,
        words: `${facilityName(clearance, field)} Clearance, ${cs}, VFR to ${to}, ${heading}bound, ${altitude}${atis}.`,
        note: `Class ${facilities.airspace_class}: where the Chart Supplement sends VFR departures to clearance delivery first.`,
      });
    }
    const ground = find(f, "GND");
    if (ground) {
      calls.push({
        to: `${facilityName(ground, field)} Ground`, mhz: ground.frequency_mhz ?? null,
        words: `${facilityName(ground, field)} Ground, ${cs}, at [where you are]${atis}, VFR to ${to}, ${heading}bound, ready to taxi.`,
      });
    }
    calls.push({
      to: `${facilityName(tower, field)} Tower`, mhz: tower.frequency_mhz ?? null,
      words: `${facilityName(tower, field)} Tower, ${cs}, holding short ${runway}, ready for departure, ${heading}bound.`,
      note: `The tower may give another runway and a way out: read back the runway and the clearance.${whenClosed(f)}`,
    });
  } else {
    const ctaf = ctafOf(f);
    calls.push(
      { to: `${field} traffic`, mhz: ctaf.frequency_mhz ?? null, words: `${field} traffic, ${cs}, taxiing to ${runway}, ${field}.` },
      {
        to: `${field} traffic`, mhz: ctaf.frequency_mhz ?? null,
        words: `${field} traffic, ${cs}, departing ${runway}, departing the pattern to the ${heading}, climbing to ${altitude}, ${field}.`,
        note: inUse ? exitFor(inUse.end) : undefined,
      },
    );
  }
  const radar = find(f, "DEP", "A/D", "APP");
  const facility = radar ? `${facilityName(radar, field)} ${(radar.type ?? "").toUpperCase() === "APP" ? "Approach" : "Departure"}` : "Approach or Center";
  calls.push(
    {
      to: facility, mhz: radar?.frequency_mhz ?? null,
      words: `${facility}, ${cs}, VFR request.`,
      note: radar ? "Flight following, once clear of the field." : "Flight following, once clear: the frequency is on the sectional or in the Chart Supplement.",
    },
    {
      to: facility, mhz: radar?.frequency_mhz ?? null,
      words: `${cs}, [distance] ${heading} of ${field}, ${altitude}, request flight following to ${to}.`,
      note: "When they answer. Then squawk the code they give and read it back.",
    },
  );
  return {
    title: `Leaving ${ident}`, ident, kind: "departure", end: inUse?.end ?? null, byWind: inUse?.byWind ?? false, calls,
  };
}

/** About where a 3:1 descent to pattern altitude has the airplane ten
 *  miles out, no higher than its cruise: as the nav log flies it. */
function tenMilesOutFt(cruiseFt: number, patternFt: number | null | undefined): number {
  if (patternFt == null) return cruiseFt;
  return Math.min(cruiseFt, Math.round((patternFt + 10 * 1000 / 3) / 100) * 100);
}

function arrival(input: RadioInput, i: number): RadioPhase {
  const { ident, facilities } = input.airports[i]!;
  const prev = input.airports[i - 1]!;
  const legs = hopLegs(input.legs, prev.ident, ident);
  const last = legs[legs.length - 1] ?? null;
  const field = placeName(facilities.name, ident);
  const cs = input.callSign;
  const inUse = runwayInUse(facilities.runways);
  const runway = inUse ? `runway ${spokenRunway(inUse.end.ident)}` : "runway [in use]";
  const from = last ? compassWord(last.true_course_deg + 180) : "[direction]";
  const tenMiles = last ? tenMilesOutFt(last.altitude_ft, facilities.pattern?.altitude_ft) : null;
  const altitude = tenMiles == null ? "[altitude]"
    : `${spokenAltitude(tenMiles)}${last && tenMiles < last.altitude_ft ? ", descending" : ""}`;
  const f = facilities.frequencies;
  const calls = listenFirst(f, field);
  if (calls.length) calls[0]!.note = "About 25 miles out, before the first call.";
  const tower = find(f, "TWR");
  const atis = find(f, "ATIS") ? ", with information [letter]" : "";
  if (tower) {
    const radar = find(f, "APP", "A/D");
    const busy = facilities.airspace_class === "B" || facilities.airspace_class === "C";
    if (busy && radar) {
      const approach = `${facilityName(radar, field)} Approach`;
      calls.push({
        to: approach, mhz: radar.frequency_mhz ?? null,
        words: `${approach}, ${cs}, [distance] ${from} of ${field}, ${spokenAltitude(last?.altitude_ft ?? 0)}${atis}, landing ${field}.`,
        note: facilities.airspace_class === "B"
          ? "Well outside the Class B: stay out until you hear \"cleared into the Class Bravo\" (91.131)."
          : "Before the Class C: two-way communication is the controller answering with your call sign (91.130).",
      });
    }
    calls.push({
      to: `${facilityName(tower, field)} Tower`, mhz: tower.frequency_mhz ?? null,
      words: busy && radar
        ? `${facilityName(tower, field)} Tower, ${cs}, [position], ${altitude}, landing.`
        : `${facilityName(tower, field)} Tower, ${cs}, ten miles ${from}, ${altitude}${atis}, landing.`,
      note: busy && radar
        ? "When approach hands you over."
        : `Well before the Class D, about 4 miles round the field: the tower answering with your call sign is two-way communication (91.129). Fly the entry it gives.${whenClosed(f)}`,
    });
    const ground = find(f, "GND");
    if (ground) {
      calls.push({
        to: `${facilityName(ground, field)} Ground`, mhz: ground.frequency_mhz ?? null,
        words: `${facilityName(ground, field)} Ground, ${cs}, clear of ${runway} at [taxiway], taxi to [where you are going].`,
        note: "Once clear of the runway, when the tower says to.",
      });
    }
  } else {
    const ctaf = ctafOf(f);
    const mhz = ctaf.frequency_mhz ?? null;
    const side = inUse?.end.traffic ?? "[left or right]";
    const say = (words: string, note?: string): RadioCall => ({ to: `${field} traffic`, mhz, words: `${field} traffic, ${cs}, ${words}, ${field}.`, note });
    calls.push(
      say(`ten miles ${from}, ${altitude}, inbound for landing`, "About ten miles out (AC 90-66C 9.5)."),
      say(`entering the forty-five for ${side} downwind ${runway}`),
      say(`${side} downwind ${runway}`),
      say(`${side} base ${runway}`),
      say(`final ${runway}, full stop`),
      say(`clear of ${runway}`),
    );
  }
  return {
    title: `Into ${ident}`, ident, kind: "arrival", end: inUse?.end ?? null, byWind: inUse?.byWind ?? false, calls,
  };
}

/** The route's calls, airport by airport: leaving the departure, into
 *  and out of each stop, and into the destination. */
export function radioScript(input: RadioInput): RadioPhase[] {
  const phases: RadioPhase[] = [];
  input.airports.forEach((_, i) => {
    if (i > 0) phases.push(arrival(input, i));
    if (i < input.airports.length - 1) phases.push(departure(input, i));
  });
  return phases;
}
