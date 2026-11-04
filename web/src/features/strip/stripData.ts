/**
 * The strip's figures and inks, apart from its components (so each file
 * of components exports components alone, for fast refresh): the ribbon's
 * points from the nav log's rows, where the airplane is along them and
 * what the plan has burnt by there, the pilot's initials, and the strip's
 * colours.
 */
import type { Leg } from "../../lib/api/types";
import { distanceNm } from "../../lib/geo";
import { isLegPoint, legOf, rowPoint, type NavLogRow } from "../plan/components/navlog/rows";

/** The strip's colours (the canvas's boards, 2026-11-04): the course's
 *  magenta, a checkpoint's brown, a field's green -- the ink theme's
 *  tokens where the page has them (index.css), these inks until it does. */
export const INK = {
  magenta: "var(--ink-magenta, #b3338c)",
  brown: "var(--ink-brown, #8a5a2b)",
  field: "var(--ink-field, #1d7a46)",
  flown: "var(--muted-foreground, #8e8e93)",
} as const;

/** A point on the ribbon: a field (green) or a checkpoint (brown). */
export interface RibbonPoint { key: string; field: boolean; name: string }

/** The ribbon's points from the nav log's rows: the fields and the
 *  checkpoints, the tops of climb and descent left out. */
export function ribbonPoints(rows: NavLogRow[]): RibbonPoint[] {
  return rows.filter(r => !isLegPoint(r)).map(r => ({ key: r.key, field: r.kind !== "checkpoint", name: rowPoint(r).name }));
}

/**
 * Where the airplane is along the route, for the ribbon: the leg it is
 * on and how far along it. The nearest point of the route is found, and
 * the airplane put on the leg before or after it by which of the two
 * it is closer to going on to -- a glance, not navigation: the next
 * checkpoint's own figures are the flying head's (FlyingHead).
 */
export function positionAlong(rows: NavLogRow[], fix: { lat: number; lon: number } | null): { leg: number; along: number } | null {
  const points = rows.filter(r => !isLegPoint(r)).map(rowPoint);
  if (!fix || points.length < 2) return null;
  let nearest = 0;
  let least = Infinity;
  points.forEach((p, i) => {
    const d = distanceNm(fix, p);
    if (d < least) { least = d; nearest = i; }
  });
  const next = points[nearest + 1];
  const before = points[nearest - 1];
  // Past the nearest point, on the way to the next: along that leg;
  // else still on the way to it from the one before.
  if (next && (!before || distanceNm(fix, next) < distanceNm(points[nearest]!, next))) {
    const legNm = distanceNm(points[nearest]!, next);
    return { leg: nearest, along: legNm > 0 ? Math.min(1, least / legNm) : 0 };
  }
  if (before) {
    const legNm = distanceNm(before, points[nearest]!);
    return { leg: nearest - 1, along: legNm > 0 ? Math.max(0, 1 - least / legNm) : 1 };
  }
  return { leg: 0, along: 0 };
}

/** What the plan says of the flight at a place on the ribbon: the fuel
 *  burnt since the last landing, the distance and time still to fly, and
 *  the hop (the flights between landings, Totals.hops) it is on. */
export interface FlownAlong { burntGal: number; leftNm: number; leftMin: number; hop: number }

/**
 * The plan's own figures summed to the airplane's place on the ribbon
 * (positionAlong), for the strip's figures in the air (StripAir): each
 * leg's fuel, miles and minutes as the planner gave them (navlog/rows'
 * pieces, the tops of climb and descent their own), the legs behind the
 * airplane whole, and of the leg under it as much of each piece as the
 * airplane has come along it by distance -- the dry run's accounting of
 * the same legs (navlog/dryRun), by place rather than by time, since the
 * planner has no figure for a position between two points. The fuel
 * burnt starts again at each landing, where the plan fills the tanks
 * (app.planning.route_totals). Null until every leg is in.
 */
export function flownAlong(rows: NavLogRow[], position: { leg: number; along: number } | null): FlownAlong | null {
  if (!position || rows.length < 2) return null;
  // Each ribbon leg's pieces, in order, and which ribbon legs end at a
  // landing: a stop at a field, not a waypoint flown through.
  const pieces: Leg[][] = [[]];
  const landingAfter = new Set<number>();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]!;
    const leg = legOf(row);
    if (!leg) return null;
    pieces[pieces.length - 1]!.push(leg);
    if (isLegPoint(row)) continue;
    if (row.kind === "stop" && row.airport.kind !== "fix") landingAfter.add(pieces.length - 1);
    pieces.push([]);
  }
  let burnt = 0, flownNm = 0, flownMin = 0, totalNm = 0, totalMin = 0, hop = 0;
  pieces.forEach((legs, k) => {
    const nm = legs.reduce((sum, l) => sum + l.distance_nm, 0);
    // How far along this ribbon leg the airplane is: the whole of the legs
    // behind it, as far as it has come on the one under it, none ahead.
    let left = k < position.leg ? nm : k === position.leg ? nm * Math.min(1, Math.max(0, position.along)) : 0;
    for (const l of legs) {
      totalNm += l.distance_nm;
      totalMin += l.ete_min ?? 0;
      if (left <= 0) continue;
      const take = Math.min(l.distance_nm, left);
      const share = l.distance_nm > 0 ? take / l.distance_nm : 1;
      burnt += (l.fuel_gal ?? 0) * share;
      flownNm += take;
      flownMin += (l.ete_min ?? 0) * share;
      left -= take;
    }
    // Landed and off again: the next hop, its tanks full.
    if (landingAfter.has(k) && k < position.leg) { hop++; burnt = 0; }
  });
  return { burntGal: burnt, leftNm: Math.max(0, totalNm - flownNm), leftMin: Math.max(0, totalMin - flownMin), hop };
}

/** The pilot's initials from their name ("Asdaq Samir" is AS), or the
 *  first letter of their address; none signed out. */
export function initialsOf(pilot: { displayName?: string | null; email?: string | null } | null | undefined): string {
  const name = pilot?.displayName?.trim();
  if (name && !name.includes("@")) {
    const parts = name.split(/\s+/).filter(Boolean);
    return (parts.length > 1 ? `${parts[0]![0]}${parts.at(-1)![0]}` : name.slice(0, 2)).toUpperCase();
  }
  const address = pilot?.email ?? name;
  return address ? address[0]!.toUpperCase() : "";
}
