import type { PastFlightSummary } from "../../../lib/api/types";
import { clockTime, duration } from "../../../lib/clock";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Sat 11 Oct", this device's day, written by hand as lib/clock writes times. */
export const dayOf = (at: Date) => `${DAYS[at.getDay()]} ${at.getDate()} ${MONTHS[at.getMonth()]}`;

/** A time from the planner, seconds since 1970, as a Date. */
export const when = (s: number) => new Date(s * 1000);

/** "2h 13m", "41m". */
export function lasted(seconds: number): string {
  return duration(seconds / 60);
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

/** "15:10 today", "09:42 yesterday", "18:05 Sat 11 Oct": when, as
 *  FlightAware's list says it, in this device's 24-hour clock. */
export function whenSaid(at: Date, today: Date = new Date()): string {
  const days = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
    - new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime()) / 86_400_000);
  const day = days === 0 ? "today" : days === 1 ? "yesterday" : dayOf(at);
  return `${clockTime(at)} ${day}`;
}

/** A field's town as FlightAware writes it under the ident: "Skyhaven,
 *  NH" in the US, the town alone abroad; its name where its town is not
 *  known. */
export function placeOf(field: { city?: string | null; region?: string | null; name?: string | null } | null | undefined): string | null {
  if (!field) return null;
  const state = field.region?.startsWith("US-") ? field.region.slice(3) : null;
  if (field.city) return state ? `${field.city}, ${state}` : field.city;
  return field.name ?? null;
}

/** "16:02" today, "11 Oct" before: when, as short as a chip on the
 *  airplane's sketch has room for. */
export function shortWhen(at: Date, today: Date = new Date()): string {
  const same = at.getFullYear() === today.getFullYear() && at.getMonth() === today.getMonth() && at.getDate() === today.getDate();
  return same ? clockTime(at) : `${at.getDate()} ${MONTHS[at.getMonth()]}`;
}
