const DAY_MS = 86_400_000;

/** The routes by when they were planned, newest first, as Maps' Recents
 *  head them: since midnight, the last seven days, the last thirty, and
 *  before; a heading with nothing under it is left out. */
export function whenGroups<T extends { at: number }>(routes: T[], now: number): { title: string; routes: T[] }[] {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const today = midnight.getTime();
  const bounds: [string, number][] = [["Today", today], ["This Week", today - 6 * DAY_MS], ["This Month", today - 29 * DAY_MS], ["Earlier", -Infinity]];
  return bounds
    .map(([title, from], i) => ({
      title,
      routes: routes.filter(r => r.at >= from && (i === 0 || r.at < bounds[i - 1]![1])),
    }))
    .filter(g => g.routes.length > 0);
}
