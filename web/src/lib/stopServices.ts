import type { NearbyPlace } from "./api/types";

/** NASR's fuel codes as the pump is labelled: its jet fuels by name, the
 *  rest (100LL, UL94, MOGAS) as the codes they are. */
const FUEL_NAMES: Record<string, string> = { A: "Jet A", "A+": "Jet A+", A1: "Jet A-1", "A1+": "Jet A-1+" };
export const fuelNames = (types: string[]) => types.map(t => FUEL_NAMES[t] ?? t).join(", ");

/** How far a place is from the field, as a pilot on foot or in a car reads
 *  it: the minutes' walk where it is a walk, else statute miles. */
export function awayWords(place: Pick<NearbyPlace, "distance_m" | "walk_min">): string {
  return place.walk_min != null ? `${place.walk_min} min walk` : `${(place.distance_m / 1609.344).toFixed(1)} mi`;
}

type Near = Pick<NearbyPlace, "distance_m" | "walk_min">;
/** The nearest of a kind: the services' list is nearest first, a field
 *  along the route (vfr.nearby) sends its nearest alone. */
type Nearest = Near | Near[] | null | undefined;

/** What a field has on the ground, as either the airport's services
 *  (AirportServices, a list of each) or a field along the route (its
 *  nearest of each) answers it. */
export type Glanceable = {
  fuel_types?: string[] | null; courtesy_car?: boolean | null;
  food?: Nearest; lodging?: Nearest; car?: Nearest; cars?: Nearest;
};

export type GlanceItem = { key: "fuel" | "food" | "bed" | "car"; words: string };

const nearest = (n: Nearest) => (Array.isArray(n) ? n[0] : n) ?? undefined;

/**
 * The few words a stop's row says of the field on the ground, one helper
 * for a field's glance and a suggested stop's row
 * (StopGlance), where each said it its own way: the avgas every profile
 * here burns where it is sold (vfr.fuelstops.FUEL), the nearest food, the
 * nearest bed, and a courtesy car or a car to hire -- what the canvas's A
 * showed under each stop, at the owner's pick ("Ok do it", 2026-10-22).
 * The rest is in the field's card's Info (StopServices).
 */
export function glanceOf(f: Glanceable): GlanceItem[] {
  const out: GlanceItem[] = [];
  const food = nearest(f.food), bed = nearest(f.lodging), car = nearest(f.car) ?? nearest(f.cars);
  if ((f.fuel_types ?? []).includes("100LL")) out.push({ key: "fuel", words: "100LL" });
  if (food) out.push({ key: "food", words: `Food ${awayWords(food)}` });
  if (bed) out.push({ key: "bed", words: `Hotel ${awayWords(bed)}` });
  if (f.courtesy_car) out.push({ key: "car", words: "Courtesy car" });
  else if (car) out.push({ key: "car", words: `Car rental ${awayWords(car)}` });
  return out;
}
