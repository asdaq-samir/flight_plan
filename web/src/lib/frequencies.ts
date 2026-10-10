import { faaWords } from "./advisories";

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
