import type { Aircraft, AircraftChoice, AircraftProfileSummary } from "./api/types";
import { DEFAULT_AIRCRAFT } from "./preferences";

/** One value per choice: a pilot's own by id, a stock profile by name.
 *  The nav log's picker keys its options on it, and the Aircraft tab
 *  ticks the one it matches. */
export function aircraftKey(a: AircraftChoice): string {
  return a.aircraftId != null ? `mine:${a.aircraftId}` : `profile:${a.profile}`;
}

/** A pilot's own aeroplane rides on the stock profile whose name
 *  matches its type designator (a C172 on c172) for the service ceiling
 *  the altitude selection needs; anything else rides on the default. */
function baseProfile(typeDesignator: string, profiles: AircraftProfileSummary[]): string {
  const wanted = typeDesignator.toLowerCase().replace(/[^a-z0-9]/g, "");
  return profiles.find(p => p.name === wanted)?.name ?? DEFAULT_AIRCRAFT.profile;
}

/** A pilot's own aeroplane as the nav log flies it: its figures, on the
 *  stock profile of its type. One place for the picker under the route
 *  and the Aircraft tab, which both choose it. */
export function choiceOf(a: Aircraft, profiles: AircraftProfileSummary[]): AircraftChoice {
  return {
    profile: baseProfile(a.typeDesignator, profiles), label: `${a.tailNumber} · ${a.typeDesignator}`,
    cruiseTasKt: a.cruiseTasKt, fuelBurnGph: a.fuelBurnGph, usableFuelGal: a.usableFuelGal ?? undefined,
    cruisePowerPct: a.cruisePowerPct ?? undefined,
    climbTasKt: a.climbTasKt ?? undefined, climbFuelBurnGph: a.climbFuelBurnGph ?? undefined,
    aircraftId: a.id,
  };
}

/** An aeroplane's short name: what comes before the " · " in its label
 *  ("C172 · Cessna 172", "N12345 · C172"). */
export function shortName(label: string): string {
  return label.split(" · ")[0] ?? label;
}
