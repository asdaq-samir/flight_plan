/**
 * When a report sent with only its day and time (DDHHMMZ, as METARs, TAFs
 * and FIS-B's text give it) was made, as an instant: kept apart from the
 * METAR reader (lib/metarText), whose parser loads only once a report is
 * heard, so what orders the reports heard costs the page nothing.
 */

/** When a report made on day DD at HH:MM UTC was made: this month's, or
 *  last month's where that day is still to come. */
export function observedAt(time: string, now: Date): string | null {
  const m = /^(\d{2})(\d{2})(\d{2})Z$/.exec(time);
  if (!m) return null;
  const [day, hour, minute] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let when = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day, hour, minute);
  // An hour's grace for a clock a little behind the station's.
  if (when > now.getTime() + 3_600_000) when = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, day, hour, minute);
  return new Date(when).toISOString().replace(".000Z", "Z");
}
