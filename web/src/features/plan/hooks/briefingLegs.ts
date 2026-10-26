import type { Candidate, Course, Leg } from "../../../lib/api/types";
import { isLegPoint, navLogRows, rowPoint } from "../components/navlog/rows";

/**
 * The nav log's legs as the briefing asks for them (/api/briefing's
 * `fixes`, `leg_min`, `ground_min`), for the planner to place each hazard
 * on the legs the pilot sees numbered and time it by their ETEs: the
 * fixes the rows are at (the tops of climb and descent are on a leg, not
 * between two), each leg's minutes and each one's minutes on the ground
 * after it. Null until every leg is in and can be flown: the planner
 * then places them on the route as entered.
 */
export function briefingLegs(course: Course | null, selected: Candidate[], legs: Leg[]): { fixes: string; legMin: string; groundMin: string } | null {
  if (!course || legs.length === 0 || legs.some(l => l.ete_min == null)) return null;
  const fixes = navLogRows(course, selected, legs).filter(row => !isLegPoint(row)).map(rowPoint);
  if (fixes.length !== legs.length + 1) return null;
  return {
    fixes: fixes.map(p => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`).join(";"),
    legMin: legs.map(l => l.ete_min!.toFixed(1)).join(","),
    groundMin: legs.map(l => (l.ground_min ?? 0).toFixed(0)).join(","),
  };
}
