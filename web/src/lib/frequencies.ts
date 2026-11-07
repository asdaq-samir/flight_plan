import type { Frequency } from "./api/types";
import { callEngine } from "./engine/engine";

/** A frequency as pilots write it: 120.7, 122.95, 124.475. */
export const mhzText = (value: number) => value.toFixed(3).replace(/0{1,2}$/, "");

/** What a frequency is for, by OurAirports' type: the kinds a card draws
 *  each with its own glyph and colour (FrequencyRow). */
export type FrequencyKind = "tower" | "ground" | "weather" | "approach" | "traffic" | "other";

/*
 * What each frequency is called and what it is for, which is the CTAF and
 * the kneeboard's list are the shared engine's
 * (native/crates/wording/src/wording/radio.rs, through lib/engine), the iPhone's
 * same rules; only the frequency's figures are written here (mhzText).
 */

/** The fields the engine reads of a frequency. */
const sent = (frequencies: readonly Frequency[]) =>
  frequencies.map(f => ({ type: f.type ?? null, description: f.description ?? null, frequency_mhz: f.frequency_mhz ?? null }));

/** A field's frequency of the first of these types it lists one for. */
export function frequencyOf(frequencies: Frequency[], ...types: string[]): Frequency | null {
  if (!frequencies.length) return null;
  const at = callEngine<number | null>("frequency_of", { frequencies: sent(frequencies), types });
  return at == null ? null : frequencies[at]!;
}

/** The CTAF: the one so called, else a UNICOM that is also the CTAF,
 *  else MULTICOM's 122.9 (AC 90-66C 9.6), as the engine answers it: an
 *  index into `frequencies`, or MULTICOM's own. The radio calls and the
 *  kneeboard both name it from here: with no frequency listed, the one
 *  said to use 122.9 and the other "No published radio". */
export function ctafOf(frequencies: Frequency[]): Frequency {
  const ctaf = callEngine<number | Frequency>("ctaf_of", { frequencies: sent(frequencies) });
  return typeof ctaf === "number" ? frequencies[ctaf]! : ctaf;
}

/** A field's radio as the kneeboard lists it (Kneeboard): each by its
 *  short name, with its frequency, the tower's before the CTAF's. */
export function kneeboardRadio(frequencies: Frequency[]): [string, number][] {
  return callEngine<[string, number][]>("kneeboard_radio", { frequencies: sent(frequencies) });
}

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
  return callEngine("frequency_line", { type: type ?? null, description: description ?? null });
}
