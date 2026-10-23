import { create } from "zustand";

/** What the map's Stops shows: fields with fuel, with food near, or with
 *  somewhere to rest (a bed, a courtesy car or a car to hire). */
export type StopsKind = "fuel" | "food" | "rest";

/**
 * The map's Stops, at the owner's pick of the stops canvas ("Try C",
 * 2026-10-23): a button among the map's own (StopsAlongButton) while the
 * planner has a route to look along (`available`), which opens the Stops
 * card over FPL (StopsCard), its pins on the chart for the kind picked.
 */
export const useStopsAlong = create<{
  available: boolean;
  open: boolean;
  kind: StopsKind;
  /** The planner's own opening of the card -- FPL in sight, the other
   *  cards put away -- for the map's button (PlanWorkspace's openStops). */
  opener: (() => void) | null;
  setOpener: (opener: (() => void) | null) => void;
  setAvailable: (available: boolean) => void;
  setOpen: (open: boolean) => void;
  setKind: (kind: StopsKind) => void;
}>(set => ({
  available: false,
  open: false,
  kind: "food",
  opener: null,
  setOpener: opener => set({ opener }),
  setAvailable: available => set(available ? { available } : { available, open: false }),
  setOpen: open => set({ open }),
  setKind: kind => set({ kind }),
}));

type FlightFigures = {
  distance_nm: number; ete_min?: number | null; fuel_gal?: number | null; usable_fuel_gal?: number | null;
  taxi_gal?: number | null; reserve_gal?: number | null;
};
type PlanTotals = FlightFigures & { hops?: { totals: FlightFigures }[] | null };

/**
 * When a field along the route is reached and the fuel the airplane lands
 * there with, from its flight's own figures per mile (a route with stops,
 * each flight's: the tanks filled at each stop): `minutes` from that
 * flight's departure, `landsWithGal` the usable fuel less the start, taxi
 * and takeoff allowance and the miles flown, and `underReserve` where
 * that is less than the reserve the flight is held to (14 CFR 91.151(a)).
 * None of them where the plan has no figures yet.
 */
export function stopFigures(field: { flight: number; from_nm: number }, totals: PlanTotals | null | undefined):
  { minutes: number | null; landsWithGal: number | null; underReserve: boolean } {
  const t = totals?.hops?.length ? totals.hops[field.flight]?.totals : totals;
  if (!t || !t.distance_nm) return { minutes: null, landsWithGal: null, underReserve: false };
  const minutes = t.ete_min != null ? field.from_nm * (t.ete_min / t.distance_nm) : null;
  const landsWithGal = t.usable_fuel_gal != null && t.fuel_gal != null
    ? t.usable_fuel_gal - (t.taxi_gal ?? 0) - field.from_nm * (t.fuel_gal / t.distance_nm) : null;
  return { minutes, landsWithGal, underReserve: landsWithGal != null && t.reserve_gal != null && landsWithGal < t.reserve_gal };
}

type Along = {
  fuel_types?: string[] | null; courtesy_car?: boolean | null; nearby_known?: boolean | null;
  food?: unknown; lodging?: unknown; car?: unknown;
};

/** The fields of a kind: those that sell 100LL, the avgas every profile
 *  here burns (vfr.fuelstops.FUEL); those with food near; those with a
 *  bed near, a courtesy car or a car to hire. */
export function stopsOfKind<T extends Along>(fields: T[], kind: StopsKind): T[] {
  return fields.filter(f => kind === "fuel" ? (f.fuel_types ?? []).includes("100LL")
    : kind === "food" ? !!f.food : !!f.lodging || !!f.courtesy_car || !!f.car);
}
