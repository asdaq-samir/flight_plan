import type { Totals } from "../../lib/api/types";
import type { Flown } from "./components/navlog/dryRun";
import { decimalHours, etaAt, hhmm, one } from "./format";

/** One of the flight's figures: its name over it, its unit after it. */
export interface Figure {
  name: string; value: string; unit?: string; testId?: string;
  /** Red: the fuel required past what the tanks hold. */
  alert?: boolean;
}

export interface TripInput {
  totals: Totals | null;
  /** Before the nav log's totals: the course's distance and the book
   *  cruise speed and burn over it (see FlightLine). */
  estimate?: { distanceNm: number; cruiseTasKt: number | null; fuelBurnGph: number | null } | null;
  local: boolean;
  /** The route's destination, the To of a route with no stops. */
  destination: string;
  /** The departure time picked, ISO; empty for now. */
  depart?: string;
  /** The arrival's clock time in the time en route's place, the pilot's
   *  tap on it (FlightLine). */
  arrival?: boolean;
  /** With stops, the destination in the next stop's place, the pilot's
   *  tap on To (FlightLine): the distance and time the whole route's. */
  toDestination?: boolean;
  /** A dry run flying (dryRunFlown): the same figures from where the
   *  airplane is, at the owner's ask ("Dry run should keep the
   *  calculations as in the profile") -- the hop it is on, the distance and
   *  time left, the arrival, and the fuel required less what it has burnt. */
  flown?: Flown | null;
}

/** The flight to the next landing: the route's first hop where it has
 *  stops (the tanks filled at each, app.planning.route_totals), else the
 *  whole route -- what the strip's figures are of; a dry run's, the hop it
 *  is flying (`hop`). */
export function nextLanding(totals: Totals | null, destination: string, hop = 0): { to: string; totals: Totals | null } {
  const flight = totals?.hops[Math.min(hop, totals.hops.length - 1)];
  return flight ? { to: flight.destination, totals: flight.totals } : { to: destination, totals };
}

/** The reserve an estimate's fuel carries before the nav log's own: 45
 *  minutes at the cruise burn, the most the rules ask -- night VFR (14 CFR
 *  91.151(a)(2)) and IFR (91.167(a)(3)) -- as whether the flight is either is
 *  not known yet, so the estimate is never short (the audit's finding: the
 *  day's 30 minutes made it low at night and under IFR); and the start,
 *  taxi and takeoff allowance of the Cessna 172S handbook, 1.4 gal --
 *  vfr.navlog's NIGHT_RESERVE_MIN and DEFAULT_TAXI_FUEL_GAL. */
const ESTIMATE_RESERVE_H = 0.75;
const ESTIMATE_TAXI_GAL = 1.4;

/** The strip's figures, at the owner's ask ("To, Dist, ETE, Fuel. To is
 *  the next stop, fuel is the fuel required"): the next landing, and the
 *  distance, time and fuel required to it -- exact or (`whole`) each
 *  rounded as far as it goes: distance and fuel up to whole ones, the
 *  time in decimal hours. Up, so none is ever said short of what it is. */
export function tripFigures({ totals, estimate, local, destination, depart = "", arrival = false, toDestination = false, flown = null }: TripInput, whole: boolean): Figure[] {
  const guessed = !totals && !local && estimate ? guess(estimate) : null;
  const from = depart || new Date().toISOString();
  if (guessed) {
    const { distanceNm, minutes, fuelGal } = guessed;
    const required = fuelGal == null || estimate?.fuelBurnGph == null ? null : fuelGal + ESTIMATE_TAXI_GAL + ESTIMATE_RESERVE_H * estimate.fuelBurnGph;
    return [
      { name: "To", value: destination || "—", testId: "navlog-to" },
      { name: "Dist", value: whole ? `${Math.ceil(distanceNm)}` : one(distanceNm), unit: "nm" },
      arrival
        ? { name: "ETA", value: etaAt(from, minutes), testId: "navlog-eta" }
        : { name: "ETE", value: minutes == null ? "—" : `≈${whole ? decimalHours(minutes) : guessed.time}`, testId: "navlog-ete" },
      { name: "Fuel", value: required == null ? "—" : `≈${whole ? Math.ceil(required) : one(required)}`, unit: required == null ? undefined : "gal" },
    ];
  }
  const landing = nextLanding(totals, destination, flown?.hop);
  // To the destination, past the stops, where the pilot asked for it: the
  // whole route's distance and time. The fuel stays the next landing's,
  // what goes in the tanks before this flight: they are filled at each
  // stop (app.planning.route_totals), and the route has no one figure.
  const next = toDestination ? { to: destination, totals } : landing;
  const leg = next.totals;
  // A dry run's left from where the airplane is: to the hop's landing, or
  // the last's, its arrival from the run's moment.
  const left = flown ? (toDestination ? flown.last : flown.next) : null;
  const distance = left ? left.nm : leg?.distance_nm ?? null;
  const minutes = left ? left.min : leg?.ete_min ?? null;
  const time = minutes === null ? "—" : whole ? decimalHours(minutes) : enRoute(minutes);
  const planned = landing.totals?.fuel_required_gal ?? null;
  const required = planned === null ? null : flown ? Math.max(0, planned - flown.burntGal) : planned;
  const start = flown ? new Date(flown.now * 1000).toISOString() : from;
  const fuel = required == null ? null : whole ? `${Math.ceil(required)}` : one(required);
  // Red where the tanks do not hold it on any flight of the route -- a
  // later stop's included, which the per-flight lines under the route
  // caught before the owner took them out ("Remove fuel required at the
  // bottom of arrival"): the figure says it now, its breakdown which.
  const short = shortFlights(totals).length > 0;
  const fuelFigure = { name: "Fuel", value: fuel ?? "—", unit: fuel === null ? undefined : "gal", testId: fuel === null ? undefined : "navlog-fuel", alert: short };
  const to = { name: "To", value: next.to || "—", testId: "navlog-to" };
  if (local) return [to, { name: "Aloft", value: time, testId: "navlog-ete" }, fuelFigure];
  return [
    to,
    distance !== null ? { name: "Dist", value: whole ? `${Math.ceil(distance)}` : one(distance), unit: "nm" } : { name: "Dist", value: "—" },
    // The destination's arrival after the stops' time on the ground too
    // (Totals.ground_min); the time en route is the air's.
    arrival ? { name: "ETA", value: leg ? etaAt(start, minutes === null ? null : minutes + (toDestination && !flown ? leg.ground_min ?? 0 : 0)) : "—", testId: "navlog-eta" } : { name: "ETE", value: time, testId: "navlog-ete" },
    fuelFigure,
  ];
}

/** The flights of a route the tanks do not hold the fuel for: each hop
 *  between two landings, or the whole route with no stops -- "C81 → KMSN". */
export function shortFlights(totals: Totals | null): { name: string; shortGal: number }[] {
  if (!totals) return [];
  const flights = totals.hops.length > 0
    ? totals.hops.map(h => ({ name: `${h.departure} → ${h.destination}`, margin: h.totals.fuel_margin_gal }))
    : [{ name: "", margin: totals.fuel_margin_gal }];
  return flights.flatMap(f => (f.margin != null && f.margin < 0 ? [{ name: f.name, shortGal: -f.margin }] : []));
}

/** A time en route as the strip writes it: "15m" under an hour, where
 *  "0h 15m" took a column's room for its nought, and "2h 45m" from one;
 *  the dry run's time left too. */
export function enRoute(minutes: number): string {
  return Math.round(minutes) < 60 ? `${Math.round(minutes)}m` : hhmm(minutes);
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
