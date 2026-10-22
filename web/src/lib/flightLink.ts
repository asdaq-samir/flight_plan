import type { FlightSummary } from "./api/types";

/** The address's keys for what the pilot picked for a flight beyond its
 *  route: the altitude flown (a pilot's own, the wheel's, or a plan), the
 *  runways (and which were picked into the wind, `auto`, to follow it
 *  still), procedures and crossing altitudes, the times on the ground,
 *  the holds, the Class B avoided and its detour, the IFR alternate and a
 *  local flight's time aloft. A saved flight (springboot's
 *  SaveFlightRequest.PICK, the same keys) and a recent route keep them, so
 *  one opened again is planned as it was: they kept the route alone, and
 *  its totals differed from the ones filed (the 20 Oct audit). */
export const PICK_KEYS = [
  "altitude_ft", "altitude_nearest", "altitude_choice", "pattern", "takeoff", "auto", "procs", "cross", "ground", "holds",
  "class_b", "class_b_via", "alternate", "local_min",
] as const;

/** The picks of an address, as it writes them ("pattern=KMSN%3A18&…"), or
 *  "" with none; `also` the keys a caller keeps besides (a recent route
 *  its points' altitudes, which a saved flight files apart). */
export function picksOf(params: URLSearchParams, also: readonly string[] = []): string {
  const keys = [...PICK_KEYS, ...also];
  return new URLSearchParams([...params].filter(([key]) => keys.includes(key))).toString();
}

/** A saved flight back on the planner: its route, through its stops, at
 *  its altitude and the ones the pilot set at its points, with the picks
 *  it was filed with, and for its own departure time while that is still
 *  ahead -- from its own pilot's Flights, or their instructor's review of
 *  it. One filed before its picks were kept flies its altitude, as before. */
export function planHrefOf(
  f: Pick<FlightSummary, "departureIdent" | "destinationIdent" | "stops" | "cruiseAltitudeFt" | "altitudes">
    & Partial<Pick<FlightSummary, "picks" | "plannedFor">>,
  now = Date.now(),
): string {
  const picks = new URLSearchParams(f.picks ?? "");
  const planned = f.plannedFor ? Date.parse(f.plannedFor) : NaN;
  const params = new URLSearchParams({
    dep: f.departureIdent, dest: f.destinationIdent,
    ...(f.stops.length ? { stops: f.stops.join(",") } : {}),
    ...(!f.picks && f.cruiseAltitudeFt != null ? { altitude_ft: String(f.cruiseAltitudeFt) } : {}),
    ...(f.altitudes ? { altitudes: f.altitudes } : {}),
    ...(Number.isFinite(planned) && planned > now ? { depart: f.plannedFor! } : {}),
  });
  for (const [key, value] of picks) if ((PICK_KEYS as readonly string[]).includes(key)) params.set(key, value);
  return `/plan?${params}`;
}
