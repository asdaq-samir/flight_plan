/**
 * A route edit made on the route as it was drawn, put onto the route as
 * the address has it now.
 *
 * The route box and FPL's list work out an edit from the route they show:
 * Delete on the destination's pill is "the points shown, without the
 * last". The address can be a change ahead of what is drawn -- the page
 * draws a new route in a transition, a few hundred milliseconds of a
 * busy phone's -- and an edit worked out from the older route, written
 * whole, brought that older route back: the departure taken out, then
 * Delete on the destination before the box was drawn again, and the
 * departure was back (stops.spec on the live bundle, 2026-10-26). So the
 * edit is carried over as what it did -- these points out, those in after
 * that one -- onto the route as it is now.
 */
export interface Route { dep: string; stops: string[]; dest: string }

const pointsOf = (r: Route) => [r.dep, ...r.stops, r.dest].filter(Boolean);
const same = (a: Route, b: Route) => pointsOf(a).join("|") === pointsOf(b).join("|") && !!a.dep === !!b.dep && !!a.dest === !!b.dest;

/** `next`, an edit of `shown`, made to `now` instead; `next` itself where
 *  the route shown is the route now, as it nearly always is. */
export function rebasedRoute(shown: Route, next: Route, now: Route): Route {
  if (same(shown, now)) return next;
  const before = pointsOf(shown), after = pointsOf(next);
  // What the edit took out, each once (a route may name a point twice).
  const out = [...before];
  const added: { ident: string; anchor: string | null; ahead: string | null }[] = [];
  after.forEach((ident, i) => {
    const at = out.indexOf(ident);
    if (at >= 0) out.splice(at, 1);
    else added.push({ ident, anchor: i > 0 ? after[i - 1]! : null, ahead: after[i + 1] ?? null });
  });
  const points = pointsOf(now);
  for (const ident of out) {
    const at = points.indexOf(ident);
    if (at >= 0) points.splice(at, 1);
  }
  // What it put in, after the point it followed; where that point has
  // gone since, before the one it led to; with neither, before the
  // destination, as a stop is.
  for (const { ident, anchor, ahead } of added) {
    const follows = anchor === null ? -1 : points.indexOf(anchor);
    const leads = ahead === null ? -1 : points.indexOf(ahead);
    const at = anchor === null ? 0 : follows >= 0 ? follows + 1 : leads >= 0 ? leads : Math.max(0, points.length - (next.dest ? 1 : 0));
    points.splice(at, 0, ident);
  }
  // The ends as the box makes them: two points or more a whole route, the
  // first the departure and the last the destination; one, the end the
  // edit kept.
  if (!points.length) return { dep: "", stops: [], dest: "" };
  if (points.length === 1) return !next.dep && next.dest ? { dep: "", stops: [], dest: points[0]! } : { dep: points[0]!, stops: [], dest: "" };
  return { dep: points[0]!, stops: points.slice(1, -1), dest: points.at(-1)! };
}
