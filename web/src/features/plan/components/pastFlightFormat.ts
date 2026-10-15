import type { PastFlightSummary } from "../../../lib/api/types";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Sat 11 Oct", this device's day, written by hand as lib/clock writes times. */
export const dayOf = (at: Date) => `${DAYS[at.getDay()]} ${at.getDate()} ${MONTHS[at.getMonth()]}`;

/** A time from the planner, seconds since 1970, as a Date. */
export const when = (s: number) => new Date(s * 1000);

/** "2 h 13 min", "41 min". */
export function lasted(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
}

/** "LCI → LWM", "LWM → in the air", "? → LCI": an end with no field
 *  near where it was first or last heard (out of the receivers' reach
 *  there) a question mark, where a dash read as a fault. */
export function legOf(flight: PastFlightSummary): string {
  const to = flight.in_air ? "in the air" : flight.destination?.ident ?? "?";
  return `${flight.origin?.ident ?? "?"} → ${to}`;
}

/** Arrived, In the air, or Last heard (where it went unheard on its way). */
export const statusOf = (flight: PastFlightSummary) => (flight.in_air ? "In the air" : flight.landed ? "Arrived" : "Last heard");
