import { angleBetween, bearingDeg, distanceNm, type LatLon } from "./geo";
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
 *  by weight, not by engine (GDL 90 Data Interface Specification
 *  560-1058-00 Rev A, Table 11, DO-260B's categories): A1 light, under
 *  15,500 lb; A2 small, 15,500 to 75,000 lb; A3 large, 75,000 to 300,000
 *  lb, A4 a high-vortex large one (a B757) and A5 heavy, over 300,000 lb
 *  -- the large ones; A7 rotorcraft. A6, highly maneuverable (over 5 g and
 *  fast), is none of these: other. Not "jets": most business jets send A1
 *  or A2, and a large turboprop A3. */
export function kindOf(plane: Pick<TrafficAircraft, "category">): Exclude<FilterKind, "any"> {
  const c = plane.category ?? "";
  if (c === "A1") return "light";
  if (c === "A2") return "small";
  if (c === "A3" || c === "A4" || c === "A5") return "large";
  if (c === "A7") return "helicopter";
  return "other";
}

/** A filter kept from before "large" was named for what it is ("jet"). */
export function keptFilter(f: AircraftFilter): AircraftFilter {
  return (f.kind as string) === "jet" ? { ...f, kind: "large" } : f;
}

/** Its height's band, ft as the planner gives it (GNSS where sent, else
 *  pressure): low below 3,000, mid to 10,000, high to 18,000, and the
 *  flight levels from 18,000 MSL up, Class A ("from 18,000 feet MSL to
 *  and including FL600", 14 CFR 71.33(a)). Up there a flight level is a
 *  pressure altitude, and a GNSS height near 18,000 may fall either side
 *  of it: a band to look by, not a boundary to fly by. */
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

/** Declaring an emergency: 7700 set for one (AIM 6-2-2), 7500 for
 *  unlawful interference (AIM 6-3-4), 7600 for a radio failed (AIM 6-4-2),
 *  or an emergency sent in its ADS-B. */
export function inEmergency(plane: Pick<TrafficAircraft, "squawk" | "emergency">): boolean {
  return ["7500", "7600", "7700"].includes(plane.squawk ?? "") || !!plane.emergency;
}

/** An airport as the filter measures from: where it is and how high. */
export interface FilterField extends LatLon {
  elevationFt: number;
}

/** Round an airport, nm: "about" it -- its pattern and one joining it,
 *  well past the 4 nm round a Class C or D primary airport inside which
 *  14 CFR 91.117(b) holds an airplane to 200 kt at or below 2,500 ft AGL.
 *  (Class D's own area is tailored to each field, AIM 3-2-5.) */
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
