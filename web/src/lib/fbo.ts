import { bearingDeg, distanceNm, type LatLon } from "./geo";
import type { TrafficAircraft } from "./api/types";

/**
 * The Aircraft tab's filters, for an FBO's desk as much as a pilot's, at
 * the owner's ask ("filter aircraft by near you, by based out of airport,
 * by enroute/landing to an airport, departing from airport etc."): where
 * -- the map's view, near the pilot, or round an airport, and there
 * inbound, departing, based or just about -- and what: its kind, its
 * height, its operator, an emergency. Each a plain test on an airplane
 * the planner gives (vfr.traffic), so the list and its tests agree.
 */

export type FilterPlace = "map" | "near" | "airport";
export type FilterRelation = "around" | "inbound" | "departing" | "based";
export type FilterKind = "any" | "light" | "small" | "jet" | "helicopter" | "other";
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

/** What an airplane is, by its transponder's emitter category (DO-260B):
 *  A1 light (under 15,500 lb), A2 small (to 75,000 lb), A3 to A6 large,
 *  heavy and high-performance -- the jets -- and A7 rotorcraft. */
export function kindOf(plane: Pick<TrafficAircraft, "category">): Exclude<FilterKind, "any"> {
  const c = plane.category ?? "";
  if (c === "A1") return "light";
  if (c === "A2") return "small";
  if (c === "A3" || c === "A4" || c === "A5" || c === "A6") return "jet";
  if (c === "A7") return "helicopter";
  return "other";
}

/** Its height's band, ft as the planner gives it (GNSS where sent, else
 *  pressure): low below 3,000, mid to 10,000, high to 18,000, and the
 *  flight levels from 18,000 MSL up, Class A (14 CFR 71.33). */
export function bandOf(altitudeFt: number | null | undefined): Exclude<FilterBand, "any"> | null {
  if (altitudeFt == null) return null;
  if (altitudeFt < 3000) return "low";
  if (altitudeFt < 10_000) return "mid";
  if (altitudeFt < 18_000) return "high";
  return "flight-levels";
}

/** The operator's ICAO code, from an airline's callsign ("UAL2088" ->
 *  "UAL"); none for a registration flown as a callsign (N174HA). */
export function operatorOf(plane: Pick<TrafficAircraft, "callsign">): string | null {
  const m = /^([A-Z]{3})\d/.exec((plane.callsign ?? "").trim().toUpperCase());
  return m ? m[1]! : null;
}

/** Declaring an emergency: 7500, 7600 or 7700 set (AIM 6-2-2, 6-2-4,
 *  6-4-2), or an emergency sent in its ADS-B. */
export function inEmergency(plane: Pick<TrafficAircraft, "squawk" | "emergency">): boolean {
  return ["7500", "7600", "7700"].includes(plane.squawk ?? "") || !!plane.emergency;
}

/** An airport as the filter measures from: where it is and how high. */
export interface FilterField extends LatLon {
  elevationFt: number;
}

/** Round an airport, nm: "about" it, as Class D's surface area is about
 *  4 nm and a pattern well within it, with room for one joining. */
export const AROUND_NM = 10;
/** How far out an airplane may be inbound or departing, nm. */
export const RELATION_NM = 40;
/** Under this far above the field, ft, an airplane can still be coming in
 *  or going out of it; higher, it is passing over. */
const RELATION_ABOVE_FT = 12_000;
/** Pointed at it, or away, within this, degrees. */
const HEADED_DEG = 30;
/** Coming down, or going up, this fast, ft/min. */
const CHANGING_FPM = 200;

const angleBetween = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

/**
 * How an airplane in the air stands to a field, read from its position,
 * track and climb -- not its flight plan, which the FAA does not publish
 * openly: inbound where it is pointed at the field and coming down (or
 * already close in), departing where it is pointed away and going up (or
 * still close in and low), within RELATION_NM and not far above it. As
 * the planner reads a past flight's ends (vfr.traffic FIELD_APPROACH_*).
 */
export function relationTo(plane: TrafficAircraft, field: FilterField): { around: boolean; inbound: boolean; departing: boolean } {
  const nm = distanceNm(field, plane);
  const above = plane.altitude_ft == null ? null : plane.altitude_ft - field.elevationFt;
  const around = nm <= AROUND_NM;
  if (nm > RELATION_NM || above == null || above > RELATION_ABOVE_FT || plane.track_deg == null) {
    return { around, inbound: false, departing: false };
  }
  const toField = bearingDeg(plane, field);
  const rate = plane.vertical_fpm ?? 0;
  const inbound = angleBetween(plane.track_deg, toField) <= HEADED_DEG && (rate <= -CHANGING_FPM || nm <= AROUND_NM);
  const departing = angleBetween(plane.track_deg, (toField + 180) % 360) <= HEADED_DEG
    && (rate >= CHANGING_FPM || (nm <= AROUND_NM && above < 3000));
  return { around, inbound, departing };
}

/** An airport ident as the planner's fields name it: "KLWM" and "LWM" one. */
export const sameField = (a: string, b: string) => {
  const bare = (s: string) => s.trim().toUpperCase().replace(/^K(?=[A-Z0-9]{3}$)/, "");
  return bare(a) === bare(b);
};

/** The airplanes this filter keeps, of those the place's question gave:
 *  the place's own test done by its caller (round the field, near the
 *  pilot), what it is here. */
export function matches(plane: TrafficAircraft, f: AircraftFilter): boolean {
  if (f.kind !== "any" && kindOf(plane) !== f.kind) return false;
  if (f.band !== "any" && bandOf(plane.altitude_ft) !== f.band) return false;
  if (f.operator && operatorOf(plane) !== f.operator) return false;
  if (f.emergency && !inEmergency(plane)) return false;
  return true;
}
