import { callEngine } from "./engine/engine";
import type { LatLon } from "./geo";
import type { TrafficAircraft } from "./api/types";

/**
 * The Aircraft tab's filters, for an FBO's desk as much as a pilot's, at
 * the owner's ask ("filter aircraft by near you, by based out of airport,
 * by enroute/landing to an airport, departing from airport etc."): where
 * -- the map's view, near the pilot, or round an airport, and there
 * inbound, departing, based or just about -- and what: its kind, its
 * height, its operator, an emergency. Each a plain test on an airplane
 * the planner gives (wingtip.traffic), so the list and its tests agree --
 * worked out by the shared engine (native/crates/pilot/src/aircraft, through
 * lib/engine), with their sources there; only the filter's own shape and
 * what is asked of it stay here.
 */

export type FilterPlace = "map" | "near" | "airport";
export type FilterRelation = "around" | "inbound" | "departing" | "based";
export type FilterKind = "any" | "light" | "small" | "large" | "helicopter" | "other";
export type FilterBand = "any" | "low" | "mid" | "high" | "flight-levels";

export interface AircraftFilter {
  place: FilterPlace;
  /** The airport's ident, as typed (KLWM or LWM). */
  airport: string;
  relation: FilterRelation;
  /** How near the pilot, nm. */
  nearNm: number;
  kind: FilterKind;
  band: FilterBand;
  /** An operator's three-letter ICAO code (UAL), or "" for any. */
  operator: string;
  emergency: boolean;
}

export const NO_FILTER: AircraftFilter = {
  place: "map", airport: "", relation: "around", nearNm: 25, kind: "any", band: "any", operator: "", emergency: false,
};

/** Whether anything is asked for: with nothing, there is no list, at the
 *  owner's ask ("I don't think we need a near you list in aircraft"). */
export function filtering(f: AircraftFilter): boolean {
  return f.place !== "map" || f.kind !== "any" || f.band !== "any" || f.operator !== "" || f.emergency;
}

/** What an airplane is, by its transponder's emitter category, which is
 *  by weight, not by engine (GDL 90's Table 11, DO-260B's): light, small,
 *  large, helicopter or other. */
export function kindOf(plane: Pick<TrafficAircraft, "category">): Exclude<FilterKind, "any"> {
  return callEngine("traffic_kind", { category: plane.category ?? null });
}

/** A filter kept from before "large" was named for what it is ("jet"). */
export function keptFilter(f: AircraftFilter): AircraftFilter {
  return (f.kind as string) === "jet" ? { ...f, kind: "large" } : f;
}

/** Declaring an emergency: 7700, 7500 or 7600 squawked (AIM 6-2-2, 6-3-4,
 *  6-4-2), or an emergency sent in its ADS-B. */
export function inEmergency(plane: Pick<TrafficAircraft, "squawk" | "emergency">): boolean {
  return callEngine("in_emergency", { squawk: plane.squawk ?? null, emergency: plane.emergency ?? null });
}

/** An airport as the filter measures from: where it is and how high. */
export interface FilterField extends LatLon {
  elevationFt: number;
}

/**
 * How an airplane in the air stands to a field, read from its position,
 * track and climb -- not its flight plan, which the FAA does not publish
 * openly: inbound where it is pointed at the field and coming down (or
 * already close in), departing where it is pointed away and going up (or
 * still close in and low), within 40 nm and not far above it; about it
 * within 10 nm. As the planner reads a past flight's ends (wingtip.traffic
 * FIELD_APPROACH_*).
 */
export function relationTo(plane: TrafficAircraft, field: FilterField): { around: boolean; inbound: boolean; departing: boolean } {
  return callEngine("field_relation", {
    plane: { lat: plane.lat, lon: plane.lon, altitude_ft: plane.altitude_ft ?? null, track_deg: plane.track_deg ?? null, vertical_fpm: plane.vertical_fpm ?? null },
    field: { lat: field.lat, lon: field.lon, elevation_ft: field.elevationFt },
  });
}

/** An airport ident as the planner's fields name it: "KLWM" and "LWM"
 *  one -- the procedures' test, kept here for the traffic's callers. */
export { sameField } from "./procedures";

/** The airplanes this filter keeps, of those the place's question gave:
 *  the place's own test done by its caller (round the field, near the
 *  pilot), what it is here. */
export function matches(plane: TrafficAircraft, f: AircraftFilter): boolean {
  return callEngine("traffic_matches", {
    plane: { category: plane.category ?? null, altitude_ft: plane.altitude_ft ?? null, callsign: plane.callsign ?? null, squawk: plane.squawk ?? null, emergency: plane.emergency ?? null },
    filter: { kind: f.kind, band: f.band, operator: f.operator, emergency: f.emergency },
  });
}
