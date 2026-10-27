import { format } from "date-fns";

/** The FAA's chart cycle ("10-02-2025", the planner's chart_cycle) as the
 *  day its edition took effect, "2 Oct 2025"; the cycle as sent where it
 *  is not a date. Map settings' Charts row and About's Chart edition. */
export function editionOf(cycle: string): string {
  const [month, day, year] = cycle.split("-").map(Number);
  const date = new Date(year!, (month ?? 1) - 1, day);
  return Number.isNaN(date.getTime()) ? cycle : format(date, "d MMM yyyy");
}
