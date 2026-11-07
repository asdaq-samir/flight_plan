import type { Aircraft, AircraftChoice, AircraftProfileSummary } from "./api/types";
import { DEFAULT_AIRCRAFT } from "./preferences";
import { callEngine } from "./engine/engine";

/** One value per choice: a pilot's own by id, a stock profile by name.
 *  The nav log's picker keys its options on it, and the Library's Aircraft
 *  ticks the one it matches. */
export function aircraftKey(a: AircraftChoice): string {
  return a.aircraftId != null ? `mine:${a.aircraftId}` : a.tail ? `tail:${a.tail}` : `profile:${a.profile}`;
}

/** An N-number as a pilot types one, as 14 CFR 47.15(b) shapes it: N,
 *  then up to five figures, four and a letter, or three and two letters,
 *  the first figure 1 to 9 and never the letters I or O. The shared
 *  engine's test (native/crates/pilot/src/aircraft), the iPhone's too, asked as
 *  a pattern's `test` was. */
export const N_NUMBER = {
  test: (text: string): boolean => callEngine("n_number", { text }),
};

/** The stock profile an airplane the FAA's registry names flies on, by its
 *  maker, model and year, each from its type's handbook (data/aircraft):
 *  any other none, its speed and burn the pilot's to give (Setup's
 *  Airplanes) rather than a guess. The shared engine's list
 *  (native/crates/pilot/src/aircraft/registry.rs), which the iPhone's
 *  Registered asks too. */
export function profileOfRegistered(registered: { manufacturer?: string | null; model?: string | null; year?: number | null }): string | null {
  return callEngine("registered_profile", {
    manufacturer: registered.manufacturer ?? null, model: registered.model ?? null, year: registered.year ?? null,
  });
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

/** The true airspeed an airplane cruises at: its own where the pilot set
 *  one, else its stock profile's; null while the profiles load and the
 *  pilot gave none. The planner's figures before its nav log comes, and
 *  the map's ruler, which times a line at it. */
export function cruiseTasOf(a: AircraftChoice, profiles: AircraftProfileSummary[] | undefined): number | null {
  return a.cruiseTasKt ?? profiles?.find(p => p.name === a.profile)?.cruise_tas_kt ?? null;
}
