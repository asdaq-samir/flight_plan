import type { Fix } from "./ownShip";

/** A light single's still-air glide: the Cessna 172S's maximum glide
 *  chart (POH figure 3-1, 68 KIAS) is about 1.5 nm for every 1,000 ft,
 *  9 to 1. */
const GLIDE_NM_PER_1000_FT = 1.5;
/** Below this over the ground, or slower than this, the airplane is on
 *  the ground or about to be, and there is no ring to draw. */
const AIRBORNE_AGL_FT = 500;
export const AIRBORNE_KT = 40;

/** How far own ship glides in still air from its GPS altitude over
 *  `groundFt` -- the nearest field's elevation, as near as the page
 *  knows the ground -- in nm; null on the ground or with no altitude. */
export function glideRangeNm(fix: Fix | null, groundFt: number | null | undefined): number | null {
  if (!fix || fix.altitudeFt == null || groundFt == null) return null;
  const agl = fix.altitudeFt - groundFt;
  if (agl < AIRBORNE_AGL_FT || (fix.speedKt ?? 0) < AIRBORNE_KT) return null;
  return (agl / 1000) * GLIDE_NM_PER_1000_FT;
}

/** The height to arrive at over a field glided to: its pattern, AC
 *  90-66C's 1,000 ft above it for a propeller airplane, from where a
 *  landing can still be flown. */
const ARRIVE_AGL_FT = 1000;

/** Whether own ship can glide, in still air, to `field` and arrive over it
 *  at pattern height -- from its GPS altitude over that field's own
 *  elevation, not the nearest one's: a field on higher ground is nearer
 *  the airplane's height. False where either height is not known. */
export function reachesField(fix: Fix | null, field: { distance_nm: number; elevation_ft?: number | null }): boolean {
  if (!fix || fix.altitudeFt == null || field.elevation_ft == null || (fix.speedKt ?? 0) < AIRBORNE_KT) return false;
  const spare = fix.altitudeFt - field.elevation_ft - ARRIVE_AGL_FT;
  return spare > 0 && (spare / 1000) * GLIDE_NM_PER_1000_FT >= field.distance_nm;
}

/** Own ship moving at flying speed: in the air, or about to be. */
export function underway(fix: Fix | null): boolean {
  return (fix?.speedKt ?? 0) >= AIRBORNE_KT;
}
