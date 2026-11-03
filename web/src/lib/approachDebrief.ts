/**
 * A flown instrument approach debriefed against the procedure it flew,
 * at the owner's ask (2026-10-30, the plan to teach flying approaches):
 * which of the field's approaches the track flew, found by its final --
 * through the final approach fix inbound and down the final course --
 * then fix by fix how far off the coded course it was and for how long
 * past full-scale deflection, how high it crossed each fix against the
 * altitude published there, how far above or below the glidepath it came
 * down where one is published, how low before the missed approach point,
 * and when the missed approach began or where it landed.
 *
 * The procedure is the FAA's CIFP as the planner draws it
 * (vfr.procedures.procedure_drawing): its lines, its fixes with their
 * roles and crossing altitudes, and its placed glidepath (runway_path). The track is GPS's
 * (lib/track, or a followed airplane's ADS-B reports), so its altitude is
 * not the altimeter's and its course is a ground track: what is measured
 * here is close to what an instructor sees, not the panel's needles.
 * Measured, not judged, where no figure is sure: a VOR's or an NDB's
 * course is given in miles off and marked nowhere.
 *
 * Flat over the approach (a plane through the missed approach point, as
 * lib/debrief takes each leg): within 30 nm of it the error is a few feet
 * in a mile.
 */
import type { ProcedureDrawing } from "./api/types";
import { airborne } from "./debrief";
import { distanceNm, FT_PER_NM, rad } from "./geo";
import type { TrackPoint } from "./track";
import { altFt, grouped } from "./units";

/** How near a fix the track has to come, nm off the course through it, to
 *  have flown over it -- the app's own figure for "it went that way", a
 *  terminal GPS's full scale (AIM 1-1-17), not a rule. */
export const PASS_NM = 1;
/** The mean distance off the final, nm, from the final approach fix to the
 *  missed approach point, over which a track is not taken to have flown
 *  that approach at all (a straight-in from somewhere else). The app's. */
export const MATCH_NM = 0.5;
/** How far over the final approach fix's altitude, ft, the track may cross
 *  it and still be flying the approach rather than overflying it. */
export const MATCH_FT = 1500;

/** A localizer's full scale: 2.5° either side of its course (the
 *  Instrument Flying Handbook, FAA-H-8083-15B, chapter 9: "a full-scale
 *  deflection shows when the aircraft is 2.5° to either side of the
 *  centerline"), its width set to 700 ft from full fly-left to full
 *  fly-right at the threshold, transmitted from the far end of the runway
 *  (AIM 1-1-9). So half of it is 350 ft at the threshold, opening at 2.5°
 *  from there out. */
export const LOCALIZER_DEG = 2.5;
export const LOCALIZER_THRESHOLD_FT = 350;
/** A GPS's full scale, nm either side (AIM 1-1-17): terminal ±1 nm to 2 nm
 *  before the final approach waypoint, from there narrowing smoothly to
 *  the approach's ±0.3 nm at it, and ±0.3 nm down the final. An LPV's is
 *  angular and narrower near the runway (AIM 1-1-18): LNAV's is used for
 *  every RNAV (GPS) final, the wider of the two. */
export const GPS_TERMINAL_NM = 1;
export const GPS_APPROACH_NM = 0.3;
export const GPS_RAMP_NM = 2;
/** A glide slope's full scale: its beam is 1.4° thick (AIM 1-1-9; FAA-H-
 *  8083-15B chapter 9), 0.7° either side of the path, from its antenna 750
 *  to 1,250 ft down the runway (AIM 1-1-9): 1,000 ft taken here. */
export const GLIDESLOPE_DEG = 0.7;
export const GLIDESLOPE_ANTENNA_FT = 1000;
/** The earth's mean radius, ft: a straight glidepath rises above the
 *  curved sea level by d²/2R, 32 ft at 6 nm, which the chart's glide
 *  slope altitude at the final approach fix includes (KBUR's ILS 08: 2,753
 *  ft at BUDDE, 6.0 nm out on 3.00° from 787 ft). */
const EARTH_FT = 6_371_000 * 3.28084;
/** The mean distance off a glidepath, ft, within which the track is
 *  taken to have come down it: two approaches down one final are told
 *  apart by it. The app's. */
const GLIDEPATH_FIT_FT = 150;
/** A climb of this much from the lowest point after the final approach
 *  fix is the missed approach begun, its start that lowest point. The
 *  app's: GPS altitude wanders tens of feet. */
export const CLIMB_FT = 150;
/** Where the track, slowed to taxiing, is taken to have landed on the
 *  approach's runway: within this of its missed approach point, nm. */
const LANDED_NM = 3;

/** How the course is flown, by the approach's coded identifier (ARINC
 *  424-18 5.10, vfr.procedures APPROACH_TYPES): a localizer's ("I", "L"),
 *  a GPS's ("R", "P", and the circling "RNV-", "GPS-"), or another (VOR,
 *  NDB, LDA, back course), whose course is measured and marked nowhere:
 *  a VOR's and an NDB's full scale is an angle from a station the
 *  drawing does not place. */
export type Guidance = "localizer" | "gps" | "other";
export function guidanceOf(id: string): Guidance {
  if (/^(RNV|GPS)-?[A-Z]$/.test(id)) return "gps";
  const kind = /^([A-Z])\d\d[LCR]?(-?[A-Z])?$/.exec(id)?.[1];
  if (kind === "I" || kind === "L") return "localizer";
  if (kind === "R" || kind === "P") return "gps";
  return "other";
}

export type Tone = "stop" | "caution" | "ok" | "info";
export interface ApproachFinding {
  tone: Tone;
  text: string;
  /** The minimums' finding, put in again as the pilot types theirs. */
  minimums?: true;
}

const ORDER: Record<Tone, number> = { stop: 0, caution: 1, ok: 2, info: 3 };
const ordered = (findings: ApproachFinding[]) =>
  findings.map((f, i) => ({ f, i })).sort((a, b) => ORDER[a.f.tone] - ORDER[b.f.tone] || a.i - b.i).map(x => x.f);

export interface FixCrossing {
  ident: string;
  roles: string[];
  minFt: number | null;
  maxFt: number | null;
  /** When it was crossed (ms), and how high (ft, GPS); null where the
   *  track never came within PASS_NM of it, or has no altitude there. */
  t: number | null;
  altFt: number | null;
  /** Its furthest under its minimum on the way to it, ft (+ under). */
  underFt: number | null;
}

export interface ApproachDebrief {
  airport: string;
  id: string;
  name: string;
  transition: string | null;
  guidance: Guidance;
  /** When the track crossed the final approach fix inbound, ms. */
  fafAt: number;
  /** How far off the final it flew on average, nm: how well it fits; and
   *  off the glidepath, ft, where there is one and altitudes to say. */
  fitNm: number;
  glidepathFitFt: number | null;
  /** The fixes passed, in order, the missed approach's left out. */
  crossings: FixCrossing[];
  findings: ApproachFinding[];
  /** The plate's plan view: the procedure's lines (the way in; the missed
   *  approach), its fixes, and the track over it, each point off where it
   *  was past full scale or under a minimum. */
  plan: {
    inbound: [number, number][];
    missed: [number, number][][];
    fixes: { ident: string; lat: number; lon: number; roles: string[] }[];
    track: { lat: number; lon: number; off: boolean }[];
  };
  /** The profile: the track's altitude by its distance to the missed
   *  approach point along the procedure, the fixes' minimums there, and
   *  the glidepath from the final approach fix to the runway. */
  profile: {
    track: { toGoNm: number; altFt: number; off: boolean }[];
    fixes: { ident: string; toGoNm: number; minFt: number | null; maxFt: number | null }[];
    glidepath: { fromNm: number; fromFt: number; toNm: number; toFt: number } | null;
  };
  outcome: { kind: "landed" | "missed" | "unknown"; secondsAfterMap: number | null };
  /** The way in's fixes before the final approach fix, and how many of
   *  them the track passed: all, where it came in by the transition. */
  wayIn: { fixes: number; passed: number };
  hasAltitude: boolean;
  /** The lowest the track came after the final approach fix, before the
   *  missed approach point (or the climb, or the landing), ft. */
  lowestFt: number | null;
  /** Approaches whose final the track fitted as well, by name: the same
   *  final as another to the same runway, which the track cannot tell
   *  apart. */
  alsoFits: string[];
}

type XY = { x: number; y: number };

interface PathFix { ident: string; roles: string[]; minFt: number | null; maxFt: number | null; v: number }

/** The way in, as one line: the transition then the final, each vertex's
 *  distance along it, the fixes at their vertices, where the final starts
 *  and where its final approach fix and missed approach point are. */
interface Path {
  ll: [number, number][];
  xy: XY[];
  cum: number[];
  fixes: PathFix[];
  finalFrom: number;
  faf: PathFix;
  map: PathFix;
}

function framer(lat0: number, lon0: number) {
  const kx = Math.cos(rad(lat0)) * 60;
  return (lat: number, lon: number): XY => ({ x: (lon - lon0) * kx, y: (lat - lat0) * 60 });
}

function pathOf(d: ProcedureDrawing, at: (lat: number, lon: number) => XY): Path | null {
  const ll: [number, number][] = [];
  let finalFrom = -1;
  for (const line of d.lines) {
    if (line.role !== "transition" && line.role !== "final") continue;
    if (line.role === "final" && finalFrom < 0) finalFrom = Math.max(0, ll.length - 1);
    for (const p of line.points) {
      const last = ll[ll.length - 1];
      if (last && Math.abs(last[0] - p[0]) < 1e-5 && Math.abs(last[1] - p[1]) < 1e-5) continue;
      ll.push([p[0], p[1]]);
    }
  }
  if (finalFrom < 0 || ll.length < 2) return null;
  const xy = ll.map(([lat, lon]) => at(lat, lon));
  const cum = [0];
  for (let i = 1; i < xy.length; i++) cum.push(cum[i - 1]! + Math.hypot(xy[i]!.x - xy[i - 1]!.x, xy[i]!.y - xy[i - 1]!.y));
  // Each fix at its vertex, in the order the way in reaches them.
  const fixes: PathFix[] = [];
  let from = 0;
  for (const f of d.fixes) {
    if (f.missed) continue;
    const p = at(f.lat, f.lon);
    let v = -1;
    for (let i = from; i < xy.length; i++) if (Math.hypot(xy[i]!.x - p.x, xy[i]!.y - p.y) < 0.1) { v = i; break; }
    if (v < 0) continue;
    fixes.push({ ident: f.ident, roles: f.roles, minFt: f.min_ft ?? null, maxFt: f.max_ft ?? null, v });
    from = v;
  }
  const faf = fixes.find(f => f.roles.includes("FAF"));
  const map = fixes.find(f => f.roles.includes("MAP"));
  if (!faf || !map || map.v <= faf.v) return null;
  return { ll, xy, cum, fixes, finalFrom, faf, map };
}

/** The course through vertex v, as a unit vector: the way out of it, or
 *  into it at the line's end. */
function courseAt(path: Path, v: number): XY {
  const [a, b] = v < path.xy.length - 1 ? [path.xy[v]!, path.xy[v + 1]!] : [path.xy[v - 1]!, path.xy[v]!];
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
}

/** Each time the track crossed the line square to the course at vertex v,
 *  going the course's way, within PASS_NM of it: its point index, the
 *  share of the way to the next point, and how far right of it (nm). */
function crossings(path: Path, v: number, xy: XY[], from: number, to: number) {
  const f = path.xy[v]!, d = courseAt(path, v);
  const out: { i: number; u: number; right: number }[] = [];
  for (let i = Math.max(0, from); i < Math.min(to, xy.length - 1); i++) {
    const a = xy[i]!, b = xy[i + 1]!;
    const sa = (a.x - f.x) * d.x + (a.y - f.y) * d.y, sb = (b.x - f.x) * d.x + (b.y - f.y) * d.y;
    if (!(sa < 0 && sb >= 0)) continue;
    const u = -sa / (sb - sa);
    const cx = a.x + u * (b.x - a.x) - f.x, cy = a.y + u * (b.y - a.y) - f.y;
    const right = d.y * cx - d.x * cy;
    if (Math.abs(right) <= PASS_NM) out.push({ i, u, right });
  }
  return out;
}

/** The track's passes by the fix at vertex v: each crossing (above); else,
 *  where it turned at the fix rather than going through its line, each
 *  nearest it came within PASS_NM. The first or the last of them. */
function passOf(path: Path, v: number, xy: XY[], from: number, to: number, which: "first" | "last") {
  const through = crossings(path, v, xy, from, to);
  if (through.length) return which === "first" ? through[0]! : through[through.length - 1]!;
  const f = path.xy[v]!;
  const away = (i: number) => Math.hypot(xy[i]!.x - f.x, xy[i]!.y - f.y);
  const near: { i: number; u: number; right: number }[] = [];
  const last = Math.min(to, xy.length - 1);
  for (let i = Math.max(0, from); i <= last; i++) {
    const d = away(i);
    if (d <= PASS_NM && (i === from || d <= away(i - 1)) && (i === last || d < away(i + 1))) near.push({ i, u: 0, right: d });
  }
  return (which === "first" ? near[0] : near[near.length - 1]) ?? null;
}

/** Where a point is against the way in between two vertices: how far
 *  along it (nm from its start) and how far right of it (left negative). */
function against(path: Path, p: XY, va: number, vb: number): { along: number; right: number; away: number } {
  let best = { along: path.cum[va]!, right: 0, away: Infinity };
  for (let k = va; k < Math.max(vb, va + 1) && k < path.xy.length - 1; k++) {
    const a = path.xy[k]!, b = path.xy[k + 1]!;
    const bx = b.x - a.x, by = b.y - a.y, len2 = bx * bx + by * by;
    const px = p.x - a.x, py = p.y - a.y;
    const t = len2 > 0 ? Math.min(1, Math.max(0, (px * bx + py * by) / len2)) : 0;
    const right = len2 > 0 ? (by * px - bx * py) / Math.sqrt(len2) : Math.hypot(px, py);
    const away = Math.hypot(px - t * bx, py - t * by);
    if (away < best.away) best = { along: path.cum[k]! + t * Math.sqrt(len2), right, away };
  }
  return best;
}

const at = <T>(xs: T[], i: number) => xs[i]!;
function altAt(points: TrackPoint[], i: number, u: number): number | null {
  const a = at(points, i).altFt, b = points[i + 1]?.altFt ?? null;
  if (a != null && b != null) return a + u * (b - a);
  return u < 0.5 ? a ?? b : b ?? a;
}
const timeAt = (points: TrackPoint[], i: number, u: number) => at(points, i).t + u * ((points[i + 1]?.t ?? at(points, i).t) - at(points, i).t);

/** The glidepath's height at a distance from its runway's threshold, nm,
 *  ft MSL: a straight line up from the runway's crossing altitude at its
 *  angle, over the curved earth. */
export function glidepathFt(gp: NonNullable<ProcedureDrawing["runway_path"]>, nmOut: number): number {
  const d = nmOut * FT_PER_NM;
  return gp.ft + d * Math.tan(rad(gp.deg)) + (d * d) / (2 * EARTH_FT);
}

/** Each time the track flew inbound over the approach's final approach
 *  fix: the attempts at it, as point indices -- from the last one's end,
 *  to the next one's start. */
export function attemptsAt(d: ProcedureDrawing, points: TrackPoint[]): { faf: number; from: number; to: number }[] {
  const end = points[points.length - 1];
  if (!end || points.length < 2) return [];
  const map = d.fixes.find(f => f.roles.includes("MAP") && !f.missed);
  if (!map) return [];
  const to = framer(map.lat, map.lon);
  const path = pathOf(d, to);
  if (!path) return [];
  const xy = points.map(p => to(p.lat, p.lon));
  const passes = crossings(path, path.faf.v, xy, 0, xy.length);
  return passes.map((c, k) => ({ faf: c.i, from: k === 0 ? 0 : passes[k - 1]!.i + 1, to: k + 1 < passes.length ? passes[k + 1]!.i : points.length - 1 }));
}

export interface DebriefOptions {
  /** The attempt to debrief (attemptsAt); the first where none is given. */
  attempt?: { faf: number; from: number; to: number };
  /** The pilot's DA or MDA from the plate, ft MSL: the CIFP has no
   *  minimums, so none is assumed. */
  minimumsFt?: number | null;
}

/**
 * One attempt at an approach debriefed; null where the track did not fly
 * it: never inbound over its final approach fix within PASS_NM, or then
 * not down its final within MATCH_NM on average, or far over the fix's
 * altitude.
 */
export function debriefApproach(d: ProcedureDrawing, points: TrackPoint[], options: DebriefOptions = {}): ApproachDebrief | null {
  if (d.kind !== "approach" || points.length < 2) return null;
  const mapFix = d.fixes.find(f => f.roles.includes("MAP") && !f.missed);
  if (!mapFix) return null;
  const to = framer(mapFix.lat, mapFix.lon);
  const path = pathOf(d, to);
  if (!path) return null;
  const attempt = options.attempt ?? attemptsAt(d, points)[0];
  if (!attempt) return null;
  const xy = points.map(p => to(p.lat, p.lon));
  const guidance = guidanceOf(d.id);
  const gp = d.runway_path ?? null;
  const hasAltitude = points.some(p => p.altFt != null);
  const fafCross = crossings(path, path.faf.v, xy, attempt.faf, attempt.faf + 1)[0];
  if (!fafCross) return null;

  // The missed approach point, the first time over it after the final
  // approach fix; else the track's nearest to it on the final.
  const mapPass = passOf(path, path.map.v, xy, attempt.faf, attempt.to, "first");
  // The landing: the flight's run of points over taxiing speed, ended near
  // the runway before the next attempt.
  const runs = airborne(points);
  const run = runs.find(([a, b]) => a <= attempt.faf && b >= attempt.faf);
  // A run that ends with the track is the recording stopped in the air.
  const landedAt = run && run[1] <= attempt.to && run[1] < points.length - 1 && distanceNm(at(points, run[1]), mapFix) <= LANDED_NM ? run[1] : null;
  // The missed approach: the lowest point after the final approach fix
  // from which the track climbed CLIMB_FT.
  let climbAt: number | null = null;
  if (hasAltitude && landedAt == null) {
    let low = -1;
    for (let i = attempt.faf + 1; i <= attempt.to; i++) {
      const alt = at(points, i).altFt;
      if (alt == null) continue;
      if (low < 0 || alt <= at(points, low).altFt!) low = i;
      else if (alt - at(points, low).altFt! >= CLIMB_FT) { climbAt = low; break; }
    }
  }
  // The scored way in ends over the missed approach point, or where the
  // climb or the landing came first.
  const endAt = Math.min(
    mapPass ? mapPass.i + 1 : attempt.to,
    climbAt ?? Infinity, landedAt ?? Infinity,
  );
  const mapAlong = path.cum[path.map.v]!;

  // Each fix of the way in passed, back from the final approach fix: the
  // last time over it before the next, so a hold or a procedure turn there
  // is flown before it counts.
  type Pass = { fix: PathFix; i: number; u: number };
  const passes: Pass[] = [{ fix: path.faf, i: fafCross.i, u: fafCross.u }];
  for (let k = path.fixes.indexOf(path.faf) - 1; k >= 0; k--) {
    const fix = path.fixes[k]!;
    const last = passOf(path, fix.v, xy, attempt.from, passes[0]!.i, "last");
    if (last && last.i <= passes[0]!.i) passes.unshift({ fix, i: last.i, u: last.u });
  }
  // Fixes after the final approach fix (step-downs, the MAP), forward.
  for (const fix of path.fixes.slice(path.fixes.indexOf(path.faf) + 1)) {
    const from = passes[passes.length - 1]!.i;
    const c = passOf(path, fix.v, xy, from, endAt + 1, "first");
    if (c) passes.push({ fix, i: c.i, u: c.u });
  }
  // From vectors to the final, where no fix before the final approach fix
  // was passed: from where the track came onto the final's line, within
  // PASS_NM of it, going its way.
  let startAt = passes[0]!.i;
  let startV = passes[0]!.fix.v;
  if (passes[0]!.fix === path.faf) {
    let i = fafCross.i;
    while (i > attempt.from) {
      const w = against(path, at(xy, i - 1), path.finalFrom, path.faf.v);
      if (w.away > PASS_NM || w.along < path.cum[path.finalFrom]! - 0.01) break;
      i--;
    }
    startAt = i;
    startV = path.finalFrom;
  }

  // The fit: the mean distance off the final, from its final approach fix.
  let fitSum = 0, fitN = 0;
  for (let i = fafCross.i + 1; i <= endAt && i < points.length; i++) {
    const w = against(path, at(xy, i), path.faf.v, path.map.v);
    if (w.along >= mapAlong - 1e-6 && i > fafCross.i + 1) break;
    fitSum += w.away; fitN++;
  }
  const fitNm = fitN ? fitSum / fitN : Math.abs(fafCross.right);
  if (fitNm > MATCH_NM) return null;
  const fafAlt = altAt(points, fafCross.i, fafCross.u);
  const fafLimit = path.faf.minFt ?? path.faf.maxFt;
  if (fafAlt != null && fafLimit != null && fafAlt - fafLimit > MATCH_FT) return null;

  const threshold = gp ?? null;
  /** Full scale either side at a distance along the way in, nm; null where
   *  no figure is sure (see Guidance). */
  const fullScale = (along: number): number | null => {
    if (guidance === "gps") {
      const fafAlong = path.cum[path.faf.v]!;
      if (along >= fafAlong) return GPS_APPROACH_NM;
      if (along >= fafAlong - GPS_RAMP_NM) {
        return GPS_TERMINAL_NM - ((GPS_TERMINAL_NM - GPS_APPROACH_NM) * (along - (fafAlong - GPS_RAMP_NM))) / GPS_RAMP_NM;
      }
      return GPS_TERMINAL_NM;
    }
    if (guidance === "localizer" && threshold && along >= path.cum[path.finalFrom]!) {
      const outFt = Math.max(0, mapAlong - along) * FT_PER_NM;
      return (LOCALIZER_THRESHOLD_FT + outFt * Math.tan(rad(LOCALIZER_DEG))) / FT_PER_NM;
    }
    return null;
  };

  const findings: ApproachFinding[] = [];
  const trackOff = new Map<number, boolean>();
  const alongAt = new Map<number, number>();
  type Stretch = { side: number; nm: number; worst: number; fromAlong: number };
  const stretches: Stretch[] = [];
  let open: Stretch | null = null;
  let worstRight = 0;
  // A hold or a procedure turn at a fix (a hold in lieu of one) is flown
  // off the line by design: from first coming to the fix to the last time
  // over it inbound, the course is not scored.
  const holdFixes = new Set(d.holds.filter(h => !h.missed).map(h => h.fix));
  const reversing = new Set<number>();
  passes.forEach((pass, k) => {
    if (!holdFixes.has(pass.fix.ident)) return;
    const from = k === 0 ? startAt : passes[k - 1]!.i + 1;
    const fix = path.xy[pass.fix.v]!;
    let first = -1;
    for (let i = Math.max(attempt.from, from); i <= pass.i; i++) {
      if (Math.hypot(at(xy, i).x - fix.x, at(xy, i).y - fix.y) <= PASS_NM) { first = i; break; }
    }
    if (first >= 0) for (let i = first + 1; i <= pass.i; i++) reversing.add(i);
  });
  // Course: each point from the start to the end, against the way in
  // between the fixes it was passed between.
  const lastV = path.xy.length - 2;
  let seg = -1;
  for (let i = startAt; i <= endAt && i < points.length; i++) {
    while (seg + 1 < passes.length && i > passes[seg + 1]!.i) seg++;
    const va = seg < 0 ? startV : passes[seg]!.fix.v;
    const vb = seg + 1 < passes.length ? passes[seg + 1]!.fix.v : path.map.v;
    const lo = Math.min(lastV, Math.min(va, vb));
    const w = against(path, at(xy, i), lo, Math.max(lo + 1, va, vb));
    alongAt.set(i, w.along);
    if (reversing.has(i)) { open = null; continue; }
    if (Math.abs(w.right) > Math.abs(worstRight)) worstRight = w.right;
    const scale = fullScale(w.along);
    const off = scale != null && Math.abs(w.right) > scale;
    if (off) {
      const step = i > startAt ? distanceNm(at(points, i - 1), at(points, i)) : 0;
      const side = Math.sign(w.right);
      if (open && open.side === side) {
        open.nm += step;
        if (Math.abs(w.right) > Math.abs(open.worst)) open.worst = w.right;
      } else {
        open = { side, nm: 0, worst: w.right, fromAlong: w.along };
        stretches.push(open);
      }
    } else open = null;
    if (off) trackOff.set(i, true);
  }
  const fafAlong = path.cum[path.faf.v]!;
  const where = (s: Stretch) => {
    if (s.fromAlong >= fafAlong - 1e-6) return "on final";
    const before = [...path.fixes].reverse().find(f => path.cum[f.v]! <= s.fromAlong + 1e-6);
    const next = path.fixes.find(f => path.cum[f.v]! > s.fromAlong + 1e-6);
    return before && next ? `from ${before.ident} to ${next.ident}` : next ? `before ${next.ident}` : "on the way in";
  };
  for (const s of stretches) {
    findings.push({
      tone: "stop",
      text: `Full scale ${s.side > 0 ? "right" : "left"} of the course for ${Math.max(0.1, s.nm).toFixed(1)} nm ${where(s)}, ${Math.abs(s.worst).toFixed(1)} nm off at most`,
    });
  }

  // Altitude at and before each fix: none under its minimum on the way to
  // it from the fix before -- a step-down's altitude holds until it is
  // passed, and those before it during the descent (AIM 5-4-5) -- and none
  // over its maximum where it is crossed.
  const crossingsOut: FixCrossing[] = [];
  const insideFinal = (fix: PathFix) => path.cum[fix.v]! > fafAlong + 1e-6;
  passes.forEach((pass, k) => {
    const { fix } = pass;
    const alt = altAt(points, pass.i, pass.u);
    const from = k === 0 ? startAt : passes[k - 1]!.i + 1;
    let under: number | null = null;
    const isMap = fix === path.map;
    const floorAt = (i: number): number | null => {
      if (fix.minFt == null || isMap) return null;
      // Down the glidepath before the final approach fix, under its
      // intercept altitude, is the approach flown (AIM 5-4-5): the floor
      // there is the lower of the two, less the glide slope's full scale.
      if (fix === path.faf && gp) {
        const p = at(points, i);
        const below = (distanceNm(p, gp) * FT_PER_NM + GLIDESLOPE_ANTENNA_FT) * Math.tan(rad(GLIDESLOPE_DEG));
        return Math.min(fix.minFt, glidepathFt(gp, distanceNm(p, gp)) - below);
      }
      return fix.minFt;
    };
    for (let i = from; i <= pass.i; i++) {
      const a = at(points, i).altFt, floor = floorAt(i);
      if (a == null || floor == null) continue;
      if (floor - a > 0 && (under == null || floor - a > under)) under = floor - a;
      if (floor - a > 0) trackOff.set(i, true);
    }
    const atAlt = alt;
    const floorHere = floorAt(pass.i);
    if (atAlt != null && floorHere != null && floorHere - atAlt > 0 && (under == null || floorHere - atAlt > under)) under = floorHere - atAlt;
    crossingsOut.push({ ident: fix.ident, roles: fix.roles, minFt: fix.minFt, maxFt: fix.maxFt, t: timeAt(points, pass.i, pass.u), altFt: atAlt, underFt: under });
    if (under != null && fix.minFt != null) {
      const atFix = atAlt != null && floorHere != null && floorHere - atAlt >= under - 1;
      // Inside the final, a step-down's altitude is the MDA's line of
      // minimums' alone, not a glidepath's DA (AIM 5-4-5).
      const stepDown = insideFinal(fix);
      findings.push({
        tone: stepDown ? "caution" : "stop",
        text: `${atFix ? "At" : "Before"} ${fix.ident}: ${grouped(Math.round(under))} ft below ${altFt(fix.minFt)}${stepDown ? " (an MDA's step-down, not a glidepath's)" : ""}`,
      });
    }
    // The final approach fix's "at" altitude is the glide slope's intercept
    // where there is a glidepath, crossed lower on it (ARINC 424-18 5.29 "I").
    if (fix.maxFt != null && atAlt != null && atAlt - fix.maxFt > 0 && !isMap && !(fix === path.faf && gp)) {
      findings.push({ tone: "stop", text: `At ${fix.ident}: ${grouped(Math.round(atAlt - fix.maxFt))} ft above ${altFt(fix.maxFt)}` });
    }
  });

  // The glidepath, from the final approach fix to the runway: how far over
  // and under it, and on a glide slope, how long past its full scale.
  let profileGp: ApproachDebrief["profile"]["glidepath"] = null;
  let gpSum = 0, gpN = 0;
  if (gp) {
    const fromNm = mapAlong - fafAlong;
    profileGp = { fromNm, fromFt: glidepathFt(gp, fromNm), toNm: 0, toFt: gp.ft };
    let high: number | null = null, low: number | null = null, underNm = 0, overNm = 0;
    for (let i = fafCross.i + 1; i <= endAt && i < points.length; i++) {
      const p = at(points, i);
      if (p.altFt == null) continue;
      const dev = p.altFt - glidepathFt(gp, distanceNm(p, gp));
      gpSum += Math.abs(dev); gpN++;
      high = high == null ? dev : Math.max(high, dev);
      low = low == null ? dev : Math.min(low, dev);
      if (guidance === "localizer") {
        const scale = (distanceNm(p, gp) * FT_PER_NM + GLIDESLOPE_ANTENNA_FT) * Math.tan(rad(GLIDESLOPE_DEG));
        const step = distanceNm(at(points, i - 1), p);
        if (dev < -scale) { underNm += step; trackOff.set(i, true); }
        if (dev > scale) overNm += step;
      }
    }
    if (high != null && low != null) {
      const said = (ft: number) => `${grouped(Math.abs(Math.round(ft / 10) * 10))} ft ${ft >= 0 ? "above" : "below"}`;
      findings.push({ tone: "info", text: `Glidepath (${gp.deg.toFixed(2)}°): from ${said(high)} to ${said(low)} it` });
      if (underNm > 0) findings.push({ tone: "stop", text: `Below the glide slope's full scale for ${Math.max(0.1, underNm).toFixed(1)} nm` });
      if (overNm > 0) findings.push({ tone: "caution", text: `Above the glide slope's full scale for ${Math.max(0.1, overNm).toFixed(1)} nm` });
    }
  }

  // The lowest before the missed approach point, held to the pilot's
  // minimums where they give them (withMinimums).
  let lowestFt: number | null = null;
  for (let i = fafCross.i + 1; i <= endAt && i < points.length; i++) {
    const a = at(points, i).altFt;
    if (a != null && (lowestFt == null || a < lowestFt)) lowestFt = a;
  }
  if (!hasAltitude) findings.push({ tone: "info", text: "The track has no altitudes: the course alone is debriefed" });

  // The missed approach, against the missed approach point, or the landing.
  const mapT = mapPass ? timeAt(points, mapPass.i, mapPass.u) : null;
  let outcome: ApproachDebrief["outcome"] = { kind: "unknown", secondsAfterMap: null };
  if (landedAt != null) {
    const s = mapT != null ? (at(points, landedAt).t - mapT) / 1000 : null;
    outcome = { kind: "landed", secondsAfterMap: s };
    findings.push({ tone: "info", text: s != null ? `Landed ${Math.round(s)} s after the MAP` : "Landed" });
  } else if (climbAt != null) {
    const s = mapT != null ? (at(points, climbAt).t - mapT) / 1000 : null;
    outcome = { kind: "missed", secondsAfterMap: s };
    const w = against(path, at(xy, climbAt), path.faf.v, path.map.v);
    const short = mapAlong - w.along;
    findings.push({
      tone: "info",
      text: s != null && Math.round(s) >= 0
        ? Math.round(s) === 0 ? "Missed approach started at the MAP" : `Missed approach started ${Math.round(s)} s after the MAP`
        : `Missed approach started ${short.toFixed(1)} nm before the MAP${s != null ? ` (${Math.round(-s)} s)` : ""}`,
    });
  } else if (hasAltitude) {
    findings.push({ tone: "info", text: "No climb or landing after the MAP in the track" });
  }
  if (stretches.length === 0 && guidance !== "other") {
    findings.push({ tone: "ok", text: `Within full scale all the way, ${Math.abs(worstRight).toFixed(1)} nm ${worstRight >= 0 ? "right" : "left"} at most` });
  } else if (guidance === "other") {
    findings.push({ tone: "info", text: `Course: ${Math.abs(worstRight).toFixed(1)} nm ${worstRight >= 0 ? "right" : "left"} of it at most` });
  }

  // The track drawn: from where it came onto the way in to a couple of
  // minutes into the missed approach, or the landing.
  const drawTo = Math.min(attempt.to, landedAt ?? (climbAt != null ? climbAt + Math.max(1, timeIndex(points, climbAt, 120_000)) : endAt + 1));
  const drawFrom = Math.max(attempt.from, startAt - 5);
  const track = points.slice(drawFrom, drawTo + 1).map((p, k) => ({ lat: p.lat, lon: p.lon, off: trackOff.get(drawFrom + k) ?? false }));
  const profileTrack = [...alongAt].flatMap(([i, along]) => {
    const alt = at(points, i).altFt;
    return alt == null ? [] : [{ toGoNm: mapAlong - along, altFt: alt, off: trackOff.get(i) ?? false }];
  });
  return withMinimums({
    airport: d.airport, id: d.id, name: d.name, transition: d.transition ?? null, guidance,
    fafAt: timeAt(points, fafCross.i, fafCross.u), fitNm, glidepathFitFt: gpN ? gpSum / gpN : null, crossings: crossingsOut,
    findings: ordered(findings), lowestFt,
    plan: {
      inbound: path.ll,
      missed: d.lines.filter(l => l.role === "missed").map(l => l.points.map(p => [p[0], p[1]] as [number, number])),
      fixes: d.fixes.map(f => ({ ident: f.ident, lat: f.lat, lon: f.lon, roles: f.roles })),
      track,
    },
    profile: {
      track: profileTrack.filter((_, i, all) => i % Math.max(1, Math.ceil(all.length / 300)) === 0),
      fixes: path.fixes.map(f => ({ ident: f.ident, toGoNm: mapAlong - path.cum[f.v]!, minFt: f.minFt, maxFt: f.maxFt })),
      glidepath: profileGp,
    },
    outcome, hasAltitude, alsoFits: [],
    wayIn: { fixes: path.fixes.indexOf(path.faf), passed: passes.indexOf(passes.find(p => p.fix === path.faf)!) },
  }, options.minimumsFt ?? null);
}

/**
 * A debrief held to the pilot's minimums, the DA or MDA they flew to (the
 * CIFP has none): under them before a missed approach is flying below
 * them without the runway in sight, which 14 CFR 91.175(c) and (e) do
 * not allow; under them to land is what (c) allows with it in sight. With
 * none given, the lowest is said, measured. Again as they are typed.
 */
export function withMinimums(d: ApproachDebrief, minimumsFt: number | null): ApproachDebrief {
  const rest = d.findings.filter(f => !f.minimums);
  const low = d.lowestFt;
  if (low == null) return { ...d, findings: rest };
  const mins = minimumsFt;
  const finding: ApproachFinding = mins != null && low < mins
    ? d.outcome.kind === "landed"
      ? { tone: "info", text: `Below ${altFt(mins)} to land: 91.175(c) asks for the runway in sight there`, minimums: true }
      : { tone: "stop", text: `Down to ${altFt(low)} before the missed approach, ${grouped(Math.round(mins - low))} ft below ${altFt(mins)}`, minimums: true }
    : { tone: mins != null ? "ok" : "info", text: `Lowest before the MAP: ${altFt(low)} ft${mins != null ? `, at or above ${altFt(mins)}` : ""}`, minimums: true };
  return { ...d, findings: ordered([...rest, finding]) };
}

/** How many points on from `i` the track is `ms` later. */
function timeIndex(points: TrackPoint[], i: number, ms: number): number {
  let k = i;
  while (k < points.length - 1 && points[k]!.t - points[i]!.t < ms) k++;
  return k - i;
}

/**
 * The approaches the track flew, one for each time it came down a final:
 * of the field's approaches drawn (each without a transition, as from
 * vectors, or with the one picked), the one whose final it fitted best;
 * the one the pilot picked for the flight where it fits as well.
 */
export function findApproaches(
  drawings: ProcedureDrawing[], points: TrackPoint[], picked: string | null = null, minimumsFt: number | null = null,
): ApproachDebrief[] {
  const found: ApproachDebrief[] = [];
  for (const d of drawings) {
    for (const attempt of attemptsAt(d, points)) {
      const flown = debriefApproach(d, points, { attempt, minimumsFt });
      if (flown) found.push(flown);
    }
  }
  // One a time down a final: those within three minutes over a final
  // approach fix are one, the best kept and the rest named with it. As
  // good laterally (within 0.05 nm), the one picked for the flight wins,
  // then one whose glidepath the track came down (within GLIDEPATH_FIT_FT).
  found.sort((a, b) => a.fafAt - b.fafAt);
  const followed = (f: ApproachDebrief) => f.glidepathFitFt != null && f.glidepathFitFt <= GLIDEPATH_FIT_FT;
  const beats = (f: ApproachDebrief, g: ApproachDebrief) => {
    if (Math.abs(f.fitNm - g.fitNm) >= 0.05) return f.fitNm < g.fitNm;
    if ((f.id === picked) !== (g.id === picked)) return f.id === picked;
    if (followed(f) !== followed(g)) return followed(f);
    return false;
  };
  const kept: ApproachDebrief[] = [];
  for (const f of found) {
    const k = kept.findIndex(g => Math.abs(g.fafAt - f.fafAt) < 180_000);
    if (k < 0) { kept.push(f); continue; }
    const same = kept[k]!;
    const near = Math.abs(f.fitNm - same.fitNm) < 0.05;
    if (beats(f, same)) kept[k] = { ...f, alsoFits: near ? [...same.alsoFits, same.name] : same.alsoFits };
    else if (near && !same.alsoFits.includes(f.name)) kept[k] = { ...same, alsoFits: [...same.alsoFits, f.name] };
  }
  return kept;
}

/**
 * Of an approach's transitions drawn, the one the track came in by: every
 * fix of it before the final passed, and the closest to it on the way; the
 * debrief from vectors (`vectors`) where none was flown.
 */
export function withTransition(vectors: ApproachDebrief, drawings: ProcedureDrawing[], points: TrackPoint[], minimumsFt: number | null = null): ApproachDebrief {
  let best = vectors, bestFixes = vectors.wayIn.passed;
  for (const d of drawings) {
    const attempt = attemptsAt(d, points).find(a => Math.abs(points[a.faf]!.t - vectors.fafAt) < 120_000);
    if (!attempt) continue;
    const flown = debriefApproach(d, points, { attempt, minimumsFt });
    if (!flown) continue;
    const { fixes, passed } = flown.wayIn;
    if (passed === fixes && passed > bestFixes) { best = { ...flown, alsoFits: vectors.alsoFits }; bestFixes = passed; }
  }
  return best;
}
