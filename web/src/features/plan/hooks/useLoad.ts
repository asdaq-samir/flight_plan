import type { AircraftProfile } from "../../../lib/api/types";
import { usePreferences } from "../../../lib/preferences";
import { balance, defaultLoad, type Balance, type Load } from "../../../lib/weightBalance";

/** The aeroplane's load as the pilot last set it, kept per aeroplane in
 *  this browser; the POH's sample aeroplane and a pilot until then. */
export function useLoad(aircraft: AircraftProfile | null | undefined, tripFuelGal: number | null) {
  const key = aircraft?.name ?? "";
  const saved = usePreferences(s => s.loads[key]);
  const setLoad = usePreferences(s => s.setLoad);
  const loading = aircraft?.loading ?? null;
  const load: Load | null = loading ? saved ?? defaultLoad(loading, aircraft?.usable_fuel_gal ?? loading.fuel_max_gal) : null;
  const result: Balance | null = loading && load ? balance(loading, load, tripFuelGal) : null;
  return { loading, load, result, setLoad: (next: Load) => setLoad(key, next) };
}
