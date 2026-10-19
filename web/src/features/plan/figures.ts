import type { Totals } from "../../lib/api/types";
import { decimalHours, hhmm, one } from "./format";

/** One of the flight's figures: its name over it, its unit after it. */
export interface Figure { name: string; value: string; unit?: string; testId?: string }

export interface TripInput {
  totals: Totals | null;
  /** Before the nav log's totals: the course's distance and the book
   *  cruise speed and burn over it (see FlightLine). */
  estimate?: { distanceNm: number; cruiseTasKt: number | null; fuelBurnGph: number | null } | null;
  local: boolean;
  /** The route's destination, the To of a route with no stops. */
  destination: string;
}

/** The flight to the next landing: the route's first hop where it has
 *  stops (the tanks filled at each, app.planning.route_totals), else the
 *  whole route -- what the strip's figures are of. */
export function nextLanding(totals: Totals | null, destination: string): { to: string; totals: Totals | null } {
  const hop = totals?.hops[0];
  return hop ? { to: hop.destination, totals: hop.totals } : { to: destination, totals };
}

/** The reserve an estimate's fuel carries before the nav log's own: the
 *  day VFR one, 30 minutes at the cruise burn (14 CFR 91.151), and the
 *  start, taxi and takeoff allowance of the Cessna 172S handbook, 1.4 gal
 *  -- vfr.navlog's DAY_RESERVE_MIN and DEFAULT_TAXI_FUEL_GAL. */
const ESTIMATE_RESERVE_H = 0.5;
const ESTIMATE_TAXI_GAL = 1.4;

/** The strip's figures, at the owner's ask ("To, Dist, ETE, Fuel. To is
 *  the next stop, fuel is the fuel required"): the next landing, and the
 *  distance, time and fuel required to it -- exact or (`whole`) each
 *  rounded as far as it goes: distance and fuel up to whole ones, the
 *  time in decimal hours. Up, so none is ever said short of what it is. */
export function tripFigures({ totals, estimate, local, destination }: TripInput, whole: boolean): Figure[] {
  const guessed = !totals && !local && estimate ? guess(estimate) : null;
  if (guessed) {
    const { distanceNm, minutes, fuelGal } = guessed;
    const required = fuelGal == null || estimate?.fuelBurnGph == null ? null : fuelGal + ESTIMATE_TAXI_GAL + ESTIMATE_RESERVE_H * estimate.fuelBurnGph;
    return [
      { name: "To", value: destination || "—", testId: "navlog-to" },
      { name: "Dist", value: whole ? `${Math.ceil(distanceNm)}` : one(distanceNm), unit: "nm" },
      { name: "ETE", value: minutes == null ? "—" : `≈${whole ? decimalHours(minutes) : guessed.time}`, testId: "navlog-ete" },
      { name: "Fuel", value: required == null ? "—" : `≈${whole ? Math.ceil(required) : one(required)}`, unit: required == null ? undefined : "gal" },
    ];
  }
  const next = nextLanding(totals, destination);
  const leg = next.totals;
  const minutes = leg?.ete_min ?? null;
  const time = minutes === null ? "—" : whole ? decimalHours(minutes) : enRoute(minutes);
  const required = leg?.fuel_required_gal ?? null;
  const fuel = required == null ? null : whole ? `${Math.ceil(required)}` : one(required);
  const fuelFigure = { name: "Fuel", value: fuel ?? "—", unit: fuel === null ? undefined : "gal", testId: fuel === null ? undefined : "navlog-fuel" };
  const to = { name: "To", value: next.to || "—", testId: "navlog-to" };
  if (local) return [to, { name: "Aloft", value: time, testId: "navlog-ete" }, fuelFigure];
  return [
    to,
    leg ? { name: "Dist", value: whole ? `${Math.ceil(leg.distance_nm)}` : one(leg.distance_nm), unit: "nm" } : { name: "Dist", value: "—" },
    { name: "ETE", value: time, testId: "navlog-ete" },
    fuelFigure,
  ];
}

/** A time en route as the strip writes it: "15m" under an hour, where
 *  "0h 15m" took a column's room for its nought, and "2h 45m" from one;
 *  the dry run's time left too. */
export function enRoute(minutes: number): string {
  return Math.round(minutes) < 60 ? `${Math.round(minutes)}m` : hhmm(minutes);
}

/** Each figure on its own: the one that does not fit its column rounded,
 *  the rest as they are. */
export function fitFigures(exact: Figure[], rounded: Figure[], fits: (f: Figure) => boolean): Figure[] {
  return exact.map((f, i) => (fits(f) ? f : rounded[i] ?? f));
}

/** The figures from the airplane's book alone (FlightLine's `estimate`):
 *  the distance as the course has it, and at cruise speed with no wind
 *  the time, and the fuel at the cruise burn over that time -- each
 *  marked "≈", none of the nav log's climb, wind or legs in it. */
function guess({ distanceNm, cruiseTasKt, fuelBurnGph }: { distanceNm: number; cruiseTasKt: number | null; fuelBurnGph: number | null }) {
  const minutes = cruiseTasKt ? (distanceNm / cruiseTasKt) * 60 : null;
  const fuelGal = minutes != null && fuelBurnGph ? (minutes / 60) * fuelBurnGph : null;
  // Written as the nav log's own time is once it is in (enRoute): this
  // one rounded its minutes on their own, and 119.6 read "1h 60m".
  return { minutes, distanceNm, fuelGal, time: minutes == null ? "—" : enRoute(minutes) };
}
