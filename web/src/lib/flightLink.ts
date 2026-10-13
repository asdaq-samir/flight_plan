import type { FlightSummary } from "./api/types";

/** A saved flight back on the planner: its route, through its stops, at
 *  its altitude and the ones the pilot set at its points -- from its own
 *  pilot's Flights, or their instructor's review of it. */
export function planHrefOf(f: Pick<FlightSummary, "departureIdent" | "destinationIdent" | "stops" | "cruiseAltitudeFt" | "altitudes">): string {
  return `/plan?${new URLSearchParams({
    dep: f.departureIdent, dest: f.destinationIdent,
    ...(f.stops.length ? { stops: f.stops.join(",") } : {}),
    ...(f.cruiseAltitudeFt != null ? { altitude_ft: String(f.cruiseAltitudeFt) } : {}),
    ...(f.altitudes ? { altitudes: f.altitudes } : {}),
  })}`;
}
