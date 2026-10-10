import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { create } from "zustand";
import { useEffect } from "react";
import { api } from "../api/client";
import type { AheadAlert } from "../api/types";
import { faaWords } from "../advisories";
import { shortAirspaceName } from "../airspace";
import { usePreferences } from "../preferences";
import { altFt } from "../units";
import { underway } from "./glide";
import { useOwnShip, type Fix } from "./ownShip";

/**
 * What is ahead of own ship in the air, as an EFB says it over the map:
 * the Class B, C and D, special-use areas and TFRs the track goes into in
 * the next five minutes, and the ground or an obstacle it comes within
 * 500 ft of in the next minute -- the planner's (vfr.alerts), asked from
 * the GPS's position, track, ground speed, altitude and the vertical
 * speed seen over the last fixes. Advisory, from a phone: not a TAWS.
 */

/** The fixes the vertical speed is read over: long enough that a phone's
 *  altitude, good to some tens of feet, does not read as a climb. */
const VS_WINDOW_MS = 15_000;
const recent: Fix[] = [];

useOwnShip.subscribe(s => {
  const fix = s.fix;
  if (!fix || fix.altitudeFt == null || recent.at(-1)?.at === fix.at) return;
  recent.push(fix);
  while (recent.length > 2 && fix.at - recent[1]!.at >= VS_WINDOW_MS) recent.shift();
});

/** Feet a minute, from the oldest fix in the window to the newest; 0
 *  until a few seconds of them are in. */
function verticalSpeed(): number {
  const first = recent[0], last = recent.at(-1);
  if (!first || !last || last.at - first.at < 5000) return 0;
  return ((last.altitudeFt! - first.altitudeFt!) / (last.at - first.at)) * 60_000;
}

export interface AheadAsk {
  lat: number;
  lon: number;
  track: number;
  gs: number;
  alt?: number;
  vs: number;
}

/**
 * What to ask the planner, rounded so that it is asked again as the
 * airplane moves a third of a mile, turns five degrees or changes height
 * by 100 ft (the altitude rounded down), not at every fix; null on the ground, with no track, or
 * with own ship off.
 */
export function askFor(fix: Fix | null, vs: number): AheadAsk | null {
  if (!fix || !underway(fix) || fix.headingDeg == null || fix.speedKt == null) return null;
  const round = (n: number, step: number) => Math.round(n / step) * step;
  // Down for the altitude: the cautious side for the ground and a
  // structure, which are alerted against it.
  const down = (n: number, step: number) => Math.floor(n / step) * step;
  return {
    lat: round(fix.lat, 0.005), lon: round(fix.lon, 0.005),
    track: round(fix.headingDeg, 5) % 360, gs: round(fix.speedKt, 10),
    ...(fix.altitudeFt != null ? { alt: down(fix.altitudeFt, 100) } : {}),
    vs: round(vs, 200),
  };
}

/** The alerts the pilot has acknowledged, by id: not shown again until
 *  each has gone from what is ahead (and so comes back if it does). */
export const useAcknowledged = create<{ ids: string[] }>(() => ({ ids: [] }));

export function acknowledge(ids: string[]) {
  useAcknowledged.setState(s => ({ ids: [...new Set([...s.ids, ...ids])] }));
}

export interface Ahead {
  /** What is ahead and not acknowledged, warnings first, then soonest. */
  alerts: AheadAlert[];
  /** What the planner could not read, said rather than shown as clear. */
  unavailable: string[];
  /** The planner did not answer: there is no saying what is ahead. */
  failed: boolean;
}

/** What is ahead of own ship now; null when nothing is being looked at
 *  (on the ground, own ship off, the alerts switched off). */
export function useAhead(): Ahead | null {
  const on = usePreferences(s => s.alerts);
  const key = useOwnShip(s => {
    const ask = s.enabled ? askFor(s.fix, verticalSpeed()) : null;
    return ask ? JSON.stringify(ask) : null;
  });
  const ask = on && key ? (JSON.parse(key) as AheadAsk) : null;
  const { data, isError } = useQuery({
    queryKey: ["ahead", ask],
    queryFn: () => api.airspaceAhead(ask!),
    enabled: !!ask,
    // The last answer kept while the next is asked, so the line does not
    // go and come back every third of a mile; TFRs change, so asked again.
    placeholderData: keepPreviousData, staleTime: 10_000, refetchInterval: 20_000,
    // Its failure is said in its own line (AlertsBanner), where it is.
    meta: { silent: true },
  });
  const acknowledged = useAcknowledged(s => s.ids);
  // An acknowledged alert gone from what is ahead is forgotten: met again,
  // it is said again.
  useEffect(() => {
    if (!data) return;
    const ahead = new Set(data.alerts.map(a => a.id));
    if (acknowledged.some(id => !ahead.has(id))) useAcknowledged.setState({ ids: acknowledged.filter(id => ahead.has(id)) });
  }, [data, acknowledged]);
  if (!ask) return null;
  return {
    alerts: (data?.alerts ?? []).filter(a => !acknowledged.includes(a.id)),
    unavailable: data?.unavailable ?? [],
    failed: isError,
  };
}

const SPECIAL_USE: Record<string, string> = {
  P: "Prohibited area", R: "Restricted area", W: "Warning area", A: "Alert area",
};

/** An alert's name: "Rockford Class C", "Restricted area R-6901A", "Volk
 *  East MOA", "TFR 6/1111", "Tower 2,700 ft", "Terrain". */
export function alertTitle(a: AheadAlert): string {
  switch (a.kind) {
    case "airspace": return `${shortAirspaceName(a.name)} Class ${a.class}`;
    case "special_use":
      if (a.class === "MOA") return faaWords(/\bMOA\b/.test(a.name) ? a.name : `${a.name} MOA`);
      return `${SPECIAL_USE[a.class ?? ""] ?? "Special use"} ${a.name}`;
    case "tfr": return `TFR ${a.notam_id ?? ""}`.trim();
    case "obstacle": return `${faaWords(a.name)} ${altFt(a.top_ft)} ft`;
    default: return "Terrain";
  }
}

/** When: "Inside", "Now", "In 40 s", "In 3 min". */
export function alertWhen(a: AheadAlert): string {
  if (a.inside) return "Inside";
  if (a.seconds < 10) return "Now";
  if (a.seconds < 60) return `In ${Math.round(a.seconds / 5) * 5} s`;
  return `In ${Math.round(a.seconds / 60)} min`;
}

/** Where, after when: "4.2 nm", or the ground's height against the
 *  airplane's there, "300 ft below you". */
export function alertWhere(a: AheadAlert): string {
  if (a.clearance_ft != null) {
    return a.clearance_ft >= 0 ? `${altFt(a.clearance_ft)} ft below you` : `${altFt(-a.clearance_ft)} ft above you`;
  }
  return `${a.distance_nm.toFixed(1)} nm`;
}
