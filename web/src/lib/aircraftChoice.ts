import type { Aircraft, AircraftChoice, AircraftProfileSummary } from "./api/types";
import { DEFAULT_AIRCRAFT } from "./preferences";

/** One value per choice: a pilot's own by id, a stock profile by name.
 *  The nav log's picker keys its options on it, and the Library's Aircraft
 *  ticks the one it matches. */
export function aircraftKey(a: AircraftChoice): string {
  return a.aircraftId != null ? `mine:${a.aircraftId}` : a.tail ? `tail:${a.tail}` : `profile:${a.profile}`;
}

/** An N-number as a pilot types one: N, a figure 1 to 9, then up to four
 *  letters or figures (14 CFR 47.15). */
export const N_NUMBER = /^N[1-9][0-9A-Z]{0,4}$/;

/** The stock profile an airplane the FAA's registry names flies on, by its
 *  maker and model: a Cessna 172 of any letter on the C172's, a Piper
 *  PA-28-181 on the Archer's; any other none, its speed and burn the
 *  pilot's own to give (Setup's Airplanes) rather than a guess. */
export function profileOfRegistered(registered: { manufacturer?: string | null; model?: string | null }): string | null {
  const maker = (registered.manufacturer ?? "").toUpperCase(), model = (registered.model ?? "").toUpperCase().replace(/\s+/g, "");
  if (maker.includes("CESSNA") && /^172[A-Z]?$/.test(model)) return "c172";
  if (maker.includes("PIPER") && /^PA-?28-?181/.test(model)) return "pa28";
  return null;
}

/** A pilot's own airplane rides on the stock profile whose name
 *  matches its type designator (a C172 on c172) for the service ceiling
 *  the altitude selection needs; anything else rides on the default. */
function baseProfile(typeDesignator: string, profiles: AircraftProfileSummary[]): string {
  const wanted = typeDesignator.toLowerCase().replace(/[^a-z0-9]/g, "");
  return profiles.find(p => p.name === wanted)?.name ?? DEFAULT_AIRCRAFT.profile;
}

/** A pilot's own airplane as the nav log flies it: its figures, on the
 *  stock profile of its type. One place for the picker under the route
 *  and the Library's Aircraft, which both choose it. */
export function choiceOf(a: Aircraft, profiles: AircraftProfileSummary[]): AircraftChoice {
  return {
    profile: baseProfile(a.typeDesignator, profiles), label: `${a.tailNumber} · ${a.typeDesignator}`,
    cruiseTasKt: a.cruiseTasKt, fuelBurnGph: a.fuelBurnGph, usableFuelGal: a.usableFuelGal ?? undefined,
    cruisePowerPct: a.cruisePowerPct ?? undefined,
    climbTasKt: a.climbTasKt ?? undefined, climbFuelBurnGph: a.climbFuelBurnGph ?? undefined,
    aircraftId: a.id,
  };
}

/** An airplane's short name: what comes before the " · " in its label
 *  ("C172 · Cessna 172", "N12345 · C172"). */
export function shortName(label: string): string {
  return label.split(" · ")[0] ?? label;
}
