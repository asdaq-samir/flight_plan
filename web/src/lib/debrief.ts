/**
 * A flight debriefed from its flown track (the roadmap's debrief, against
 * ACS PA.VI.A's tolerances): the saved flight's nav log is the plan, the
 * track (lib/track) what was flown. Leg by leg, how much of the cruise
 * was within 200 ft of the planned altitude and how much of the way the
 * ground track was within 15° of the course, and how far off the line it
 * went (within 3 nm, S5); at each checkpoint, when it was passed against
 * when it was due (within 5 minutes, S6) and how close; at each field
 * landed at, the altitude about where the downwind starts against the
 * pattern's.
 *
 * Deterministic: measured, not judged. GPS altitude is not the
 * altimeter's and a ground track is not a heading, so each figure is
 * close to what the examiner sees, not it -- the page says so.
 */
import type { Flight } from "./api/types";
import type { TrackPoint } from "./track";

type Checkpoint = Flight["checkpoints"][number];

const R_NM = 3440.065;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Faster than this over the ground is flying; slower, taxiing. */
export const AIRBORNE_KT = 40;
/** PA.VI.A's tolerances: S7's altitude, and its heading applied to the
 *  ground track; S5's distance from the planned route; S6's time at each
 *  checkpoint against its estimate. */
export const ALTITUDE_FT = 200;
export const COURSE_DEG = 15;
export const OFF_ROUTE_NM = 3;
export const ETA_MIN = 5;
/** How near the field the downwind is taken to start, and PA.III.B.S5's
 *  pattern altitude. */
export const PATTERN_NM = 1.5;
export const PATTERN_FT = 100;

export function distanceNm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearingDeg(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

function angleOff(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 540) % 360 - 180);
  return d;
}

/** Ground speed at each point, knots: over at least ten seconds round
 *  it, which a one-second GPS's jitter would otherwise make a mess of. */
export function groundSpeeds(points: TrackPoint[]): number[] {
  return points.map((_, i) => {
    let j = i, k = i;
    while ((points[k]!.t - points[j]!.t) < 10_000 && (j > 0 || k < points.length - 1)) {
      if (j > 0) j--;
      if (k < points.length - 1) k++;
    }
    const hours = (points[k]!.t - points[j]!.t) / 3_600_000;
    return hours > 0 ? distanceNm(points[j]!, points[k]!) / hours : 0;
  });
}

/** The track's flights: each run of points over AIRBORNE_KT, as [first,
 *  last] indices, a minute's dip under it (a slow flight, a go-around)
 *  kept in, and a run of under a minute (a fast taxi) dropped. */
export function airborne(points: TrackPoint[]): [number, number][] {
  const speeds = groundSpeeds(points);
  const runs: [number, number][] = [];
  speeds.forEach((kt, i) => {
    if (kt < AIRBORNE_KT) return;
    const last = runs[runs.length - 1];
    if (last && points[i]!.t - points[last[1]]!.t < 60_000) last[1] = i;
    else runs.push([i, i]);
  });
  return runs.filter(([a, b]) => points[b]!.t - points[a]!.t >= 60_000);
}

interface Segment {
  index: number;
  from: Checkpoint;
  to: Checkpoint;
  hop: number;
}

/** Where a point is against a segment: how far along it (0 to 1), how far
 *  right of it (left negative), and how far from it at all. Flat over a
 *  leg, which is near enough at a leg's length. */
function against(seg: Segment, p: { lat: number; lon: number }) {
  const kx = Math.cos(rad(seg.from.lat)) * 60;
  const bx = (seg.to.lon - seg.from.lon) * kx, by = (seg.to.lat - seg.from.lat) * 60;
  const px = (p.lon - seg.from.lon) * kx, py = (p.lat - seg.from.lat) * 60;
  const len2 = bx * bx + by * by;
  const t = len2 > 0 ? (px * bx + py * by) / len2 : 0;
  const right = len2 > 0 ? -(bx * py - by * px) / Math.sqrt(len2) : Math.hypot(px, py);
  const away = t < 0 ? Math.hypot(px, py) : t > 1 ? Math.hypot(px - bx, py - by) : Math.abs(right);
  return { t: Math.min(1, Math.max(0, t)), right, away };
}

export interface LegGrade {
  from: string;
  to: string;
  plannedAltFt: number | null;
  /** The share of its graded cruise within ALTITUDE_FT, 0-1; null where
   *  none was graded (no altitudes in the file, or no cruise on it). */
  altitudeWithin: number | null;
  /** Its furthest from the planned altitude, signed (+ high). */
  worstAltFt: number | null;
  courseDeg: number | null;
  /** The share of the way the ground track was within COURSE_DEG. */
  courseWithin: number | null;
  /** Its furthest off the course line, nm, signed (+ right). */
  worstOffNm: number | null;
}

export interface CheckpointPass {
  name: string;
  category: string;
  /** Minutes from the takeoff it was due, and was passed (or landed at);
   *  null where the plan had no time, or the track never got there. */
  dueMin: number | null;
  passedMin: number | null;
  /** The track's closest to it, nm. */
  closestNm: number | null;
}

export interface PatternEntry {
  ident: string;
  /** The altitude PATTERN_NM from the field, ft MSL. */
  altFt: number;
  patternFt: number;
}

export interface Debrief {
  takeoff: number;
  landing: number;
  flownMin: number;
  plannedMin: number | null;
  legs: LegGrade[];
  passes: CheckpointPass[];
  patterns: PatternEntry[];
  /** The flown altitude along the course, for the profile; and the
   *  plan's, a step a leg. */
  profile: { alongNm: number; altFt: number }[];
  planned: { fromNm: number; toNm: number; altFt: number | null }[];
  /** The flight as flown, for the map: each point, and whether it was
   *  outside a tolerance there -- over 3 nm off the route, or over 200 ft
   *  off the altitude in the cruise. */
  line: { lat: number; lon: number; off: boolean }[];
  hasAltitude: boolean;
  /** What does not fit, in words: a track from somewhere else, takeoffs
   *  that do not match the stops. */
  notes: string[];
}

/** The flight's hops, by checkpoint index: from each field taken off
 *  from to the next landed at. */
function hops(cps: Checkpoint[]): [number, number][] {
  const fields = cps.map((c, i) => (i === 0 || i === cps.length - 1 || c.category === "stop" ? i : -1)).filter(i => i >= 0);
  return fields.slice(1).map((end, h) => [fields[h]!, end]);
}

/** A flight debriefed against its track; null where the track never
 *  flew. `patterns` are the fields' pattern altitudes, ft MSL, by ident. */
export function debrief(flight: Flight, points: TrackPoint[], patterns: Record<string, number> = {}): Debrief | null {
  const cps = [...flight.checkpoints].sort((a, b) => a.sequenceNo - b.sequenceNo);
  const runs = airborne(points);
  if (cps.length < 2 || runs.length === 0) return null;
  const legHops = hops(cps);
  const notes: string[] = [];
  // Each hop its own flight where the track has as many; else the whole
  // track one flight, its times from the first takeoff.
  let flights: [number, number][];
  if (runs.length === legHops.length) flights = runs;
  else {
    flights = legHops.map(() => [runs[0]![0], runs[runs.length - 1]![1]]);
    if (legHops.length > 1) notes.push(`The track has ${runs.length} flight${runs.length === 1 ? "" : "s"} for the plan's ${legHops.length}: times are from the first takeoff.`);
  }
  const first = points[flights[0]![0]]!, last = points[flights[flights.length - 1]![1]]!;
  const offStart = distanceNm(first, cps[0]!), offEnd = distanceNm(last, cps[cps.length - 1]!);
  if (offStart > 5) notes.push(`The track takes off ${offStart.toFixed(0)} nm from ${cps[0]!.name}: is it this flight's?`);
  if (offEnd > 5) notes.push(`The track lands ${offEnd.toFixed(0)} nm from ${cps[cps.length - 1]!.name}.`);

  const segments: Segment[] = cps.slice(1).map((to, i) => ({
    index: i, from: cps[i]!, to, hop: legHops.findIndex(([a, b]) => i >= a && i < b),
  }));
  const hasAltitude = points.some(p => p.altFt != null);
  const grades = segments.map(() => ({ altW: 0, altIn: 0, worstAlt: null as number | null, courseW: 0, courseIn: 0, worstOff: null as number | null }));
  const profile: Debrief["profile"] = [];
  const line: Debrief["line"] = [];
  const passed = new Map<number, number>();
  const passes: CheckpointPass[] = [];
  const entries: PatternEntry[] = [];

  legHops.forEach(([a, b], h) => {
    const [start, end] = flights[h]!;
    const hopSegs = segments.filter(s => s.hop === h);
    // The cruise: from first reaching the first leg's altitude to last
    // being at the last leg's, before the landing.
    const firstAlt = cps[a + 1]?.altitudeFt ?? null, lastAlt = cps[b]?.altitudeFt ?? null;
    let cruiseFrom = Infinity, cruiseTo = -Infinity;
    for (let i = start; i <= end; i++) {
      const alt = points[i]!.altFt;
      if (alt == null) continue;
      if (firstAlt != null && cruiseFrom === Infinity && alt >= firstAlt - ALTITUDE_FT) cruiseFrom = points[i]!.t;
      if (lastAlt != null && alt >= lastAlt - ALTITUDE_FT) cruiseTo = points[i]!.t;
    }
    let cursor = 0;
    let prevAlong = cps[a]!.alongTrackNm;
    let prevT = points[start]!.t;
    for (let i = start; i <= end; i++) {
      const p = points[i]!;
      // The nearest of the legs about where it was, so a route that
      // doubles back is not read on its way out as on its way home.
      let best = hopSegs[cursor]!, where = against(best, p);
      for (let s = Math.max(0, cursor - 1); s <= Math.min(hopSegs.length - 1, cursor + 3); s++) {
        const w = against(hopSegs[s]!, p);
        if (w.away < where.away) { best = hopSegs[s]!; where = w; }
      }
      cursor = hopSegs.indexOf(best);
      const along = best.from.alongTrackNm + where.t * (best.to.alongTrackNm - best.from.alongTrackNm);
      // Each checkpoint passed: when the track first got past it.
      for (let k = a + 1; k < b; k++) {
        const cp = cps[k]!;
        if (!passed.has(k) && along >= cp.alongTrackNm && prevAlong < cp.alongTrackNm) {
          const share = along > prevAlong ? (cp.alongTrackNm - prevAlong) / (along - prevAlong) : 0;
          passed.set(k, prevT + share * (p.t - prevT));
        }
      }
      prevAlong = along; prevT = p.t;
      const weight = i < end ? Math.min(30_000, points[i + 1]!.t - p.t) : 0;
      const g = grades[best.index]!;
      const sinceLegStart = along - best.from.alongTrackNm;
      const toField = cps[b]!.alongTrackNm - along, fromField = along - cps[a]!.alongTrackNm;
      // Course: not over the fields, nor in the turn onto a leg.
      if (best.to.trueCourseDeg != null && fromField > 2 && toField > 2 && sinceLegStart > 1) {
        let j = i, k = i;
        while (points[k]!.t - points[j]!.t < 20_000 && (j > start || k < end)) { if (j > start) j--; if (k < end) k++; }
        if (k > j) {
          const off = angleOff(bearingDeg(points[j]!, points[k]!), best.to.trueCourseDeg);
          g.courseW += weight;
          if (off <= COURSE_DEG) g.courseIn += weight;
        }
        if (g.worstOff == null || Math.abs(where.right) > Math.abs(g.worstOff)) g.worstOff = where.right;
      }
      // Altitude: in the cruise, and not in a step to a new one.
      const planned = best.to.altitudeFt;
      const stepped = best.index > a && cps[best.index]!.altitudeFt !== planned && sinceLegStart < 3;
      let off = Math.abs(where.right) > OFF_ROUTE_NM && fromField > 2 && toField > 2;
      if (p.altFt != null && planned != null && p.t >= cruiseFrom && p.t <= cruiseTo && !stepped) {
        const dev = p.altFt - planned;
        g.altW += weight;
        if (Math.abs(dev) <= ALTITUDE_FT) g.altIn += weight;
        else off = true;
        if (g.worstAlt == null || Math.abs(dev) > Math.abs(g.worstAlt)) g.worstAlt = dev;
      }
      line.push({ lat: p.lat, lon: p.lon, off });
      if (p.altFt != null) profile.push({ alongNm: along, altFt: p.altFt });
    }

    // The checkpoints' times, from this hop's takeoff.
    let due = 0;
    for (let k = a + 1; k <= b; k++) {
      const cp = cps[k]!;
      due = cp.eteMin == null || Number.isNaN(due) ? NaN : due + cp.eteMin;
      const at = k === b ? points[end]!.t : passed.get(k);
      let closest = Infinity;
      for (let i = start; i <= end; i++) closest = Math.min(closest, distanceNm(points[i]!, cp));
      passes.push({
        name: cp.name, category: cp.category,
        dueMin: Number.isNaN(due) ? null : due,
        passedMin: at == null ? null : (at - points[start]!.t) / 60_000,
        closestNm: Number.isFinite(closest) ? closest : null,
      });
    }

    // The pattern: the altitude where it first came within PATTERN_NM of
    // the field it landed at.
    const field = cps[b]!;
    const patternFt = patterns[field.name];
    if (patternFt != null) {
      for (let i = start; i <= end; i++) {
        const alt = points[i]!.altFt;
        if (alt != null && distanceNm(points[i]!, field) <= PATTERN_NM) {
          entries.push({ ident: field.name, altFt: alt, patternFt });
          break;
        }
      }
    }
  });

  const legs: LegGrade[] = segments.map((s, i) => {
    const g = grades[i]!;
    return {
      from: s.from.name, to: s.to.name,
      plannedAltFt: s.to.altitudeFt ?? null,
      altitudeWithin: g.altW > 0 ? g.altIn / g.altW : null,
      worstAltFt: g.worstAlt,
      courseDeg: s.to.trueCourseDeg ?? null,
      courseWithin: g.courseW > 0 ? g.courseIn / g.courseW : null,
      worstOffNm: g.worstOff,
    };
  });
  const flownMs = flights.reduce((sum, [a, b], h) => (h > 0 && flights[h - 1]![0] === a ? sum : sum + points[b]!.t - points[a]!.t), 0);
  const plannedMin = cps.slice(1).reduce<number | null>((sum, c) => (sum == null || c.eteMin == null ? null : sum + c.eteMin), 0);
  // At most 400 points on the profile and 1,500 on the map: they are
  // drawn, not read. An off point is never thinned out of the map's.
  const stride = Math.max(1, Math.ceil(profile.length / 400));
  const lineStride = Math.max(1, Math.ceil(line.length / 1500));
  return {
    takeoff: first.t, landing: last.t, flownMin: flownMs / 60_000, plannedMin,
    legs, passes, patterns: entries,
    profile: profile.filter((_, i) => i % stride === 0),
    planned: segments.map(s => ({ fromNm: s.from.alongTrackNm, toNm: s.to.alongTrackNm, altFt: s.to.altitudeFt ?? null })),
    line: line.filter((pt, i) => pt.off || i % lineStride === 0 || i === line.length - 1),
    hasAltitude, notes,
  };
}
