import { faaWords } from "./advisories";
import type { Frequency } from "./api/types";

/** A frequency as pilots write it: 120.7, 122.95, 124.475. */
export const mhzText = (value: number) => value.toFixed(3).replace(/0{1,2}$/, "");

/** What a frequency is for, by OurAirports' type: the kinds a card draws
 *  each with its own glyph and colour (FrequencyRow). */
export type FrequencyKind = "tower" | "ground" | "weather" | "approach" | "traffic" | "other";

const KINDS: Record<string, FrequencyKind> = {
  TWR: "tower",
  GND: "ground", CLD: "ground", CLNC: "ground", CD: "ground", GCCD: "ground", "GND/CD": "ground",
  ATIS: "weather", AWOS: "weather", ASOS: "weather",
  APP: "approach", APCH: "approach", DEP: "approach", "A/D": "approach", "APP/DEP": "approach",
  CTAF: "traffic", UNIC: "traffic", UNICOM: "traffic", MULT: "traffic", MULTICOM: "traffic",
};

/** Its name in words, where the type is a code a pilot reads as one. */
const NAMES: Record<string, string> = {
  TWR: "Tower", GND: "Ground", CLD: "Clearance delivery", CLNC: "Clearance delivery", CD: "Clearance delivery",
  GCCD: "Ground and clearance", "GND/CD": "Ground and clearance",
  ATIS: "ATIS", AWOS: "AWOS", ASOS: "ASOS",
  APP: "Approach", APCH: "Approach", DEP: "Departure", "A/D": "Approach and departure", "APP/DEP": "Approach and departure",
  CTAF: "CTAF", UNIC: "UNICOM", UNICOM: "UNICOM", MULT: "MULTICOM", MULTICOM: "MULTICOM",
  RDO: "Radio", FSS: "Flight service", RCO: "Remote outlet",
  PTD: "Pilot to dispatch", OPS: "Operations", EMR: "Emergency", AFIS: "Flight information",
};

/** A field's frequency of the first of these types it lists one for. */
export function frequencyOf(frequencies: Frequency[], ...types: string[]): Frequency | null {
  for (const type of types) {
    const f = frequencies.find(x => (x.type ?? "").toUpperCase() === type && x.frequency_mhz != null);
    if (f) return f;
  }
  return null;
}

/** The CTAF: the one so called, else a UNICOM that is also the CTAF,
 *  else MULTICOM's 122.9 (AC 90-66C 9.6). The radio calls and the
 *  kneeboard both name it from here: with no frequency listed, the one
 *  said to use 122.9 and the other "No published radio". */
export function ctafOf(frequencies: Frequency[]): Frequency {
  return frequencyOf(frequencies, "CTAF")
    ?? frequencies.find(f => (f.type ?? "").toUpperCase().startsWith("UNIC") && /CTAF/i.test(f.description ?? "") && f.frequency_mhz != null)
    ?? frequencyOf(frequencies, "UNIC", "UNICOM")
    ?? { type: "MULTICOM", description: "MULTICOM", frequency_mhz: 122.9 };
}

/** The kneeboard's short names for a field's radio, in its order: the
 *  tower's before the CTAF's (a towered field's CTAF is for when it is
 *  closed). */
const RADIO: [string[], string][] = [
  [["ATIS"], "ATIS"], [["AWOS", "ASOS"], "AWOS"], [["CLD"], "CLR"], [["GND"], "GND"], [["TWR"], "TWR"],
  [["CTAF"], "CTAF"], [["UNIC", "UNICOM"], "UNICOM"], [["APP", "A/D", "DEP"], "APP"],
];

/** A field's radio as the kneeboard lists it (Kneeboard): each by its
 *  short name, with its frequency. */
export function kneeboardRadio(frequencies: Frequency[]): [string, number][] {
  const out: [string, number][] = [];
  for (const [types, name] of RADIO) {
    const f = frequencies.find(x => types.includes((x.type ?? "").toUpperCase()) && x.frequency_mhz != null);
    if (!f) continue;
    // UNICOM where there is no tower and it is not the CTAF already: a
    // towered field's is the FBO's, not the air's. A UNICOM the table
    // calls the CTAF too ("CTAF/UNICOM") is the CTAF.
    if (name === "UNICOM" && out.some(([n, mhz]) => n === "TWR" || mhz === f.frequency_mhz)) continue;
    out.push([name === "UNICOM" && /CTAF/i.test(f.description ?? "") && !out.some(([n]) => n === "CTAF") ? "CTAF" : name, f.frequency_mhz!]);
  }
  // No tower and nothing to self-announce on: MULTICOM's 122.9, as the
  // radio calls say (ctafOf), where this said "No published radio".
  const ctaf = ctafOf(frequencies);
  if (ctaf.type === "MULTICOM" && !out.some(([n]) => n === "TWR")) out.push(["MULTICOM", ctaf.frequency_mhz!]);
  return out;
}

const said = (text: string) => text.replace(/[^A-Z0-9]/gi, "").toUpperCase();

/**
 * A field's frequency as its card lists it: its name in words (TWR is
 * "Tower"), its kind for the row's glyph, and what OurAirports says of it
 * in sentence case (lib/advisories faaWords) where that adds to the name
 * -- "Minneapolis APP/DEP", not a second "TWR" under "Tower". A type with
 * no name of its own is named by its description.
 */
export function frequencyLine(type: string | null | undefined, description: string | null | undefined): {
  name: string; kind: FrequencyKind; detail: string | null;
} {
  const code = (type ?? "").trim().toUpperCase();
  const words = description ? faaWords(description.trim()) : "";
  const named = NAMES[code];
  const name = named ?? (words || code || "Frequency");
  const adds = !!words && named !== undefined && said(words) !== said(code) && said(words) !== said(named);
  return { name, kind: KINDS[code] ?? "other", detail: adds ? words : null };
}
