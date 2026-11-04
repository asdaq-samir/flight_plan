/**
 * The strip's figures and inks, apart from its components (so each file
 * of components exports components alone, for fast refresh): the ribbon's
 * points from the nav log's rows, where the airplane is along them, the
 * pilot's initials, and the strip's colours.
 */
import { distanceNm } from "../../lib/geo";
import { isLegPoint, rowPoint, type NavLogRow } from "../plan/components/navlog/rows";

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
