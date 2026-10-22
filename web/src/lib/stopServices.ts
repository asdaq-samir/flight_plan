import type { AirportServices, NearbyPlace } from "./api/types";

/** NASR's fuel codes as the pump is labelled: its jet fuels by name, the
 *  rest (100LL, UL94, MOGAS) as the codes they are. */
const FUEL_NAMES: Record<string, string> = { A: "Jet A", "A+": "Jet A+", A1: "Jet A-1", "A1+": "Jet A-1+" };
export const fuelNames = (types: string[]) => types.map(t => FUEL_NAMES[t] ?? t).join(", ");

/** How far a place is from the field, as a pilot on foot or in a car reads
 *  it: the minutes' walk where it is a walk, else statute miles. */
export function awayWords(place: NearbyPlace): string {
  return place.walk_min != null ? `${place.walk_min} min walk` : `${(place.distance_m / 1609.344).toFixed(1)} mi`;
}

/** The few words a suggested stop's row says of the field on the ground
 *  (StopGlance): the nearest food, a courtesy car or a car to hire, the
 *  nearest bed -- what the canvas's A showed under each stop, at the
 *  owner's pick ("Ok do it", 2026-10-22). */
export function glanceOf(s: AirportServices): { key: "food" | "car" | "bed"; words: string }[] {
  const out: { key: "food" | "car" | "bed"; words: string }[] = [];
  if (s.food?.[0]) out.push({ key: "food", words: `Food ${awayWords(s.food[0])}` });
  if (s.courtesy_car) out.push({ key: "car", words: "Courtesy car" });
  else if (s.cars?.[0]) out.push({ key: "car", words: `Car rental ${awayWords(s.cars[0])}` });
  if (s.lodging?.[0]) out.push({ key: "bed", words: `Hotel ${awayWords(s.lodging[0])}` });
  return out;
}
