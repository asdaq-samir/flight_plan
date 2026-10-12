import { create } from "zustand";
import type { PastFlightPoint } from "../api/types";

/**
 * A past flight of a tracked airplane, picked from its card's Past
 * flights (FlightCard), as FlightAware shows one: its path on the map in
 * its heights' colours (TrafficLayer's PastFlightPath), its track log,
 * and its replay -- the airplane flown along it again at 10, 50 or 200
 * times, from where the pilot left it.
 */
interface PastFlightState {
  hex: string | null;
  id: number | null;
  points: PastFlightPoint[];
  /** The replay's moment, s since 1970; null before it has been played. */
  at: number | null;
  playing: boolean;
  speed: number;
}

/** How many times faster than it was flown a replay goes. */
export const REPLAY_SPEEDS = [10, 50, 200] as const;

export const usePastFlight = create<PastFlightState>(() => ({
  hex: null, id: null, points: [], at: null, playing: false, speed: 50,
}));

/** A past flight picked: its path drawn once its points are here. */
export function choosePastFlight(hex: string, id: number) {
  usePastFlight.setState(s => (s.hex === hex && s.id === id ? {} : { hex, id, points: [], at: null, playing: false }));
}

export function clearPastFlight() {
  usePastFlight.setState({ hex: null, id: null, points: [], at: null, playing: false });
}

/** Played from where it was left, or from the start once it has ended. */
export function playPastFlight() {
  usePastFlight.setState(s => {
    const first = s.points[0]?.t ?? null, last = s.points.at(-1)?.t ?? null;
    if (first === null || last === null) return {};
    return { playing: true, at: s.at === null || s.at >= last ? first : s.at };
  });
}

export function pausePastFlight() {
  usePastFlight.setState({ playing: false });
}

/** Back to before it was played: the airplane off the map. */
export function stopPastFlight() {
  usePastFlight.setState({ playing: false, at: null });
}

/** The replay `ms` of the phone's time on, at its speed; stopped at the end. */
export function stepPastFlight(ms: number) {
  usePastFlight.setState(s => {
    const last = s.points.at(-1)?.t;
    if (!s.playing || s.at === null || last === undefined) return {};
    const at = Math.min(last, s.at + (ms / 1000) * s.speed);
    return { at, playing: at < last };
  });
}

/**
 * Where the airplane was at `t`, between the reports either side of it:
 * its position and height in proportion, its track, speed and climb the
 * earlier report's. Null outside the flight.
 */
export function positionAt(points: PastFlightPoint[], t: number): PastFlightPoint | null {
  if (!points.length || t < points[0]!.t || t > points.at(-1)!.t) return null;
  let lo = 0, hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.t <= t) lo = mid;
    else hi = mid;
  }
  const a = points[lo]!, b = points[hi]!;
  const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
  const alt = a.alt_ft != null && b.alt_ft != null ? a.alt_ft + (b.alt_ft - a.alt_ft) * f : a.alt_ft ?? null;
  return { ...a, t, lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f, alt_ft: alt };
}
