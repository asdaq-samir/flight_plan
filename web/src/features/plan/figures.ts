import type { Totals } from "../../lib/api/types";
import { decimalHours, etaAt, hhmm } from "./format";

/** One of the flight's figures: its name over it, its unit after it. */
export interface Figure { name: string; value: string; unit?: string; testId?: string }

export interface TripInput {
  totals: Totals | null;
  /** Before the nav log's totals: the course's distance and the book
   *  cruise speed and burn over it (see FlightLine). */
  estimate?: { distanceNm: number; cruiseTasKt: number | null; fuelBurnGph: number | null } | null;
  /** The departure time picked, ISO; empty for now. */
  depart: string;
  local: boolean;
}

/** The strip's figures, exact or (`whole`) each rounded as far as it
 *  goes: distance and fuel up to whole ones, the time in decimal hours.
 *  Up, so none is ever said short of what it is. */
export function tripFigures({ totals, estimate, depart, local }: TripInput, whole: boolean): Figure[] {
  const guessed = !totals && !local && estimate ? guess(estimate) : null;
  const from = depart || new Date().toISOString();
  if (guessed) {
    const { distanceNm, minutes, fuelGal } = guessed;
    return [
      { name: "Dist", value: whole ? `${Math.ceil(distanceNm)}` : distanceNm.toFixed(1), unit: "nm" },
      { name: "ETE", value: minutes == null ? "—" : `≈${whole ? decimalHours(minutes) : guessed.time}`, testId: "navlog-ete" },
      // The arrival with no "≈" of its own, at the pilot's ask: the time
      // en route beside it carries it, and one is enough for both.
      { name: "ETA", value: etaAt(from, minutes), testId: "navlog-eta-estimate" },
      { name: "Fuel", value: fuelGal == null ? "—" : `≈${whole ? Math.ceil(fuelGal) : fuelGal.toFixed(1)}`, unit: fuelGal == null ? undefined : "gal" },
    ];
  }
  const minutes = totals?.ete_min ?? null;
  const time = minutes === null ? "—" : whole ? decimalHours(minutes) : hhmm(minutes);
  const fuel = totals?.fuel_gal == null ? null : whole ? `${Math.ceil(totals.fuel_gal)}` : `${totals.fuel_gal}`;
  const fuelFigure = { name: "Fuel", value: fuel ?? "—", unit: fuel === null ? undefined : "gal" };
  const arrival = totals ? etaAt(from, minutes) : "—";
  if (local) {
    return [{ name: "Aloft", value: time, testId: "navlog-ete" }, { name: "Back", value: arrival, testId: totals ? "navlog-eta" : undefined }, fuelFigure];
  }
  return [
    totals ? { name: "Dist", value: whole ? `${Math.ceil(totals.distance_nm)}` : `${totals.distance_nm}`, unit: "nm" } : { name: "Dist", value: "—" },
    { name: "ETE", value: time, testId: "navlog-ete" },
    { name: "ETA", value: arrival, testId: totals ? "navlog-eta" : undefined },
    fuelFigure,
  ];
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
  const hours = minutes == null ? null : Math.floor(minutes / 60);
  const fuelGal = minutes != null && fuelBurnGph ? (minutes / 60) * fuelBurnGph : null;
  return {
    minutes, distanceNm, fuelGal,
    time: minutes == null ? "—" : `${hours ? `${hours}h ` : ""}${Math.round(minutes - hours! * 60)}m`,
  };
}
