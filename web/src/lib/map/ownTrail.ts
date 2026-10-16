import { create } from "zustand";
import { distanceNm } from "../geo";
import { readKept, writeKept } from "../storage";
import { underway } from "./glide";
import { useOwnShip } from "./ownShip";
import type { PathPoint } from "./tracking";

/**
 * Own ship's path flown, as ForeFlight's breadcrumbs: a point of the GPS
 * every tenth of a mile or ten seconds while the airplane is moving at
 * flying speed (glide's underway), at the pilot's ask -- to see where
 * they have been, beside a tracked flight's path or alone. A new flight
 * starts a new path: a point more than ten minutes after the last is the
 * first of it. Kept in this browser (localStorage), so a reload in the
 * air keeps the path; at most a long day's flying of it.
 */
const KEY = "vfr.owntrail";
const STEP_NM = 0.1;
const STEP_MS = 10_000;
const NEW_FLIGHT_MS = 10 * 60_000;
const MOST = 5000;

function kept(): PathPoint[] {
  const held = readKept<PathPoint[]>(KEY, []);
  const last = Array.isArray(held) ? held.at(-1) : undefined;
  return last && Date.now() - last.t < NEW_FLIGHT_MS ? held : [];
}

export const useOwnTrail = create<{ path: PathPoint[] }>(() => ({ path: kept() }));

let saved = 0;
useOwnShip.subscribe(s => {
  const fix = s.fix;
  // A dry run's flying is not where the pilot has been.
  if (!s.enabled || s.simulated || !fix || !underway(fix)) return;
  const path = useOwnTrail.getState().path;
  const last = path.at(-1);
  if (last && fix.at - last.t < STEP_MS && distanceNm(last, fix) < STEP_NM) return;
  const point = { t: fix.at, lat: fix.lat, lon: fix.lon, altFt: fix.altitudeFt };
  const next = last && fix.at - last.t > NEW_FLIGHT_MS ? [point] : [...path, point].slice(-MOST);
  useOwnTrail.setState({ path: next });
  // Written down at most every half minute: a phone's storage is slow.
  if (fix.at - saved > 30_000) {
    saved = fix.at;
    writeKept(KEY, next);   // a private window: this page's alone
  }
});

/** The path put away, as its button in the map's settings asks. */
export function clearOwnTrail() {
  useOwnTrail.setState({ path: [] });
  writeKept(KEY, null);
}
