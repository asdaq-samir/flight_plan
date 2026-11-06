import { callEngine } from "../engine/engine";
import type { Fix } from "./ownShip";

/*
 * Own ship's still-air glide: the Cessna 172S's 1.5 nm for every 1,000 ft
 * (POH figure 3-1), no ring under 500 ft over the ground or slower than
 * 40 kt, and a field in reach where the airplane arrives over it at its
 * pattern height (AC 90-66C's 1,000 ft). The rules and their sources are
 * the shared engine's (native/engine/src/motion/glide.rs), the debrief's
 * airborne speed with them, asked through lib/engine.
 */

/** How far own ship glides in still air from its GPS altitude over
 *  `groundFt` -- the nearest field's elevation, as near as the page
 *  knows the ground -- in nm; null on the ground or with no altitude. */
export function glideRangeNm(fix: Fix | null, groundFt: number | null | undefined): number | null {
  if (!fix) return null;
  return callEngine<number | null>("glide_range", { altitude_ft: fix.altitudeFt, speed_kt: fix.speedKt, ground_ft: groundFt ?? null });
}

/** Whether own ship can glide, in still air, to `field` and arrive over it
 *  at pattern height -- from its GPS altitude over that field's own
 *  elevation, not the nearest one's: a field on higher ground is nearer
 *  the airplane's height. False where either height is not known. */
export function reachesField(fix: Fix | null, field: { distance_nm: number; elevation_ft?: number | null }): boolean {
  if (!fix) return false;
  return callEngine<boolean>("glide_reaches", {
    altitude_ft: fix.altitudeFt, speed_kt: fix.speedKt, distance_nm: field.distance_nm, elevation_ft: field.elevation_ft ?? null,
  });
}

/** Own ship moving at flying speed: in the air, or about to be. */
export function underway(fix: Fix | null): boolean {
  return callEngine<boolean>("underway", { speed_kt: fix?.speedKt ?? null });
}
