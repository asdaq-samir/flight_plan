import { create } from "zustand";
import type { TrafficAircraft } from "../api/types";

/** An airplane's report, and when its position was, this phone's clock (ms). */
export interface Report {
  plane: TrafficAircraft;
  at: number;
}

/** A point of a flown path: when (ms), where, how high (feet; null on the ground). */
export interface PathPoint {
  t: number;
  lat: number;
  lon: number;
  altFt: number | null;
}

/**
 * An airplane being tracked, as FlightAware and ForeFlight track one: which
 * (`hex`, the address's `?flight=`), whether the map keeps it in the
 * middle (`follow`), its last report, and the path it has flown since its
 * trace was read; and the airplanes of the last answer, for the Aircraft
 * card's list (`seen`). TrafficLayer writes the reports in as they come;
 * the cards (AircraftCard, FlightCard) read them, and pick a flight with
 * PlanWorkspace's own `pick`, which puts it in the address.
 */
interface Tracking {
  hex: string | null;
  /** The Aircraft card is open (`?aircraft=1`): the traffic is drawn
   *  while it is, whatever the map's settings. */
  listing: boolean;
  follow: boolean;
  latest: Report | null;
  path: PathPoint[];
  seen: Report[];
  /** Opens a flight's card: PlanWorkspace's, set while it is mounted. */
  pick: ((hex: string, plane?: TrafficAircraft) => void) | null;
}

export const useTracking = create<Tracking>(() => ({
  hex: null, listing: false, follow: true, latest: null, path: [], seen: [], pick: null,
}));

/** A flight tracked from now, the map following it; its report where the
 *  one picking it has it (a row of the list, a search's answer), so its
 *  card and the map have it at once. */
export function track(hex: string | null, plane?: TrafficAircraft) {
  useTracking.setState(s => (s.hex === hex
    ? {}
    : { hex, follow: true, path: [], latest: hex && plane ? { plane, at: Date.now() - (plane.seen_s ?? 0) * 1000 } : null }));
}

/** At most this many points of a tracked flight's path since its trace. */
const PATH_POINTS = 2000;

/** A report of the tracked airplane: its latest, and a point of its path. */
export function reported(report: Report) {
  useTracking.setState(s => {
    if (report.plane.hex !== s.hex || (s.latest && report.at <= s.latest.at && s.latest.plane.hex === s.hex)) return {};
    const point = { t: report.at, lat: report.plane.lat, lon: report.plane.lon, altFt: report.plane.altitude_ft ?? null };
    return { latest: report, path: [...s.path, point].slice(-PATH_POINTS) };
  });
}
