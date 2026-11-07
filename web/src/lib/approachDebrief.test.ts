import { describe, expect, test } from "vitest";
import type { ProcedureDrawing } from "./api/types";
import {
  attemptsAt, debriefApproach, findApproaches, glidepathFt, guidanceOf, withMinimums, withTransition,
} from "./approachDebrief";
import { bearingDeg, destination, distanceNm, FT_PER_NM, rad } from "./geo";
import type { TrackPoint } from "./track";
import KBUR from "./fixtures/approachKbur.json";

// KBUR's ILS Y RWY 08 and RNAV (GPS) Z RWY 08 as the planner draws them
// from the CIFP of 1 Oct 2026 (tests/cifp, wingtip.procedures.procedure_drawing).
const drawings = KBUR as unknown as Record<string, ProcedureDrawing>;
const ILS = drawings["I08-Y"]!;
const ILS_LAX = drawings["I08-Y:LAX"]!;
const RNAV = drawings["R08-Z"]!;
const RNAV_MIKEI = drawings["R08-Z:MIKEI"]!;
const RW08 = { lat: 34.197911, lon: -118.369142 };

type Ll = { lat: number; lon: number };
const ll = (p: number[]): Ll => ({ lat: p[0]!, lon: p[1]! });

/**
 * A track flown along a line of points at 120 kt, a point a second: each
 * `off(nmToGo)` nm right of it (left negative) and at `alt(nmToGo)` ft,
 * nmToGo the distance left to the line's end; then `after` seconds
 * beyond it on the same course, at `afterAlt(s)` and `afterKt(s)`.
 */
function fly(line: Ll[], opts: {
  off?: (toGo: number) => number;
  alt?: (toGo: number) => number | null;
  after?: number;
  afterAlt?: (s: number) => number | null;
  afterKt?: (s: number) => number;
} = {}): TrackPoint[] {
  const legs = line.slice(1).map((b, i) => ({ a: line[i]!, b, nm: distanceNm(line[i]!, b) }));
  const total = legs.reduce((s, l) => s + l.nm, 0);
  const t0 = Date.parse("2026-10-30T15:00:00Z");
  const points: TrackPoint[] = [];
  const kt = 120;
  let s = 0;
  for (let along = 0; along <= total; along = (s * kt) / 3600) {
    let rest = along, k = 0;
    while (k < legs.length - 1 && rest > legs[k]!.nm) { rest -= legs[k]!.nm; k++; }
    const leg = legs[k]!;
    const course = bearingDeg(leg.a, leg.b);
    const on = destination(leg.a, course, Math.min(rest, leg.nm));
    const toGo = total - along;
    const off = opts.off?.(toGo) ?? 0;
    const p = off ? destination(on, course + (off > 0 ? 90 : -90), Math.abs(off)) : on;
    points.push({ t: t0 + s * 1000, lat: p.lat, lon: p.lon, altFt: opts.alt ? opts.alt(toGo) : null });
    s++;
  }
  const end = line[line.length - 1]!, course = bearingDeg(line[line.length - 2]!, end);
  let past = 0;
  for (let k = 1; k <= (opts.after ?? 0); k++) {
    past += (opts.afterKt?.(k) ?? kt) / 3600;
    const p = destination(end, course, past);
    points.push({ t: t0 + (s + k - 1) * 1000, lat: p.lat, lon: p.lon, altFt: opts.afterAlt ? opts.afterAlt(k) : null });
  }
  return points;
}

/** A procedure's way in, as a line to fly: its transition and its final,
 *  from 2 nm before its first fix on the course into it. */
function wayIn(d: ProcedureDrawing): Ll[] {
  const line: Ll[] = [];
  for (const l of d.lines) {
    if (l.role === "missed") continue;
    for (const p of l.points.map(ll)) if (!line.length || distanceNm(line[line.length - 1]!, p) > 0.001) line.push(p);
  }
  return [destination(line[0]!, bearingDeg(line[1]!, line[0]!), 2), ...line];
}
const lengthOf = (line: Ll[]) => line.slice(1).reduce((s, p, i) => s + distanceNm(line[i]!, p), 0);
const finalOf = (d: ProcedureDrawing) => wayIn({ ...d, lines: d.lines.filter(l => l.role !== "transition") });
const gp = ILS.runway_path!;
/** The ILS flown as charted: 3,700 to SILEX, 3,000 to the glide slope,
 *  then down it to the runway. */
const onIls = (toGo: number) => Math.min(glidepathFt(gp, toGo), toGo > 11 ? 3700 : 3000);
/** A missed approach from the runway, its climb begun `wait` s past it. */
const missedAfter = (wait: number) => (s: number) => (s <= wait ? gp.ft : gp.ft + ((s - wait) * 1000) / 60);

describe("the figures it is held to", () => {
  test("the glidepath's height at the final approach fix is the chart's glide slope altitude there", () => {
    // ARINC 424-18 5.29 code "I" at BUDDE: 3,000 ft, the glide slope at
    // 2,753 ft; 3.00° up from RW08's 787 ft (its 727 ft threshold and 60
    // ft crossing height), over the curve of the earth.
    const budde = ILS.fixes.find(f => f.ident === "BUDDE")!;
    expect(Math.abs(glidepathFt(gp, distanceNm(budde, RW08)) - 2753)).toBeLessThan(15);
  });

  test("an approach's guidance is read from its coded identifier", () => {
    expect(guidanceOf("I08-Y")).toBe("localizer");
    expect(guidanceOf("L08-Z")).toBe("localizer");
    expect(guidanceOf("R08-Z")).toBe("gps");
    expect(guidanceOf("RNV-A")).toBe("gps");
    expect(guidanceOf("S08")).toBe("other");
    expect(guidanceOf("VDM-A")).toBe("other");
  });

  test("the localizer's full scale is 350 ft at the threshold, opening at 2.5°", () => {
    // AIM 1-1-9: 700 ft full fly-left to full fly-right at the threshold.
    // At 5 nm out: 350 + 30,381 × tan 2.5° = 1,676 ft, 0.28 nm.
    const half = (350 + 5 * FT_PER_NM * Math.tan(rad(2.5))) / FT_PER_NM;
    expect(half).toBeCloseTo(0.276, 2);
  });
});

describe("an ILS flown as charted", () => {
  const track = fly(finalOf(ILS), { alt: onIls, after: 120, afterAlt: missedAfter(12) });

  test("scores clean: no full scale, no fix under its altitude", () => {
    const d = debriefApproach(ILS, track)!;
    expect(d).not.toBeNull();
    expect(d.fitNm).toBeLessThan(0.01);
    expect(d.findings.filter(f => f.tone === "stop" || f.tone === "caution")).toEqual([]);
    expect(d.findings.some(f => f.text.startsWith("Within full scale all the way"))).toBe(true);
    expect(d.crossings.map(c => c.ident)).toEqual(["SILEX", "BUDDE", "RW08"]);
    expect(d.plan.track.some(p => p.off)).toBe(false);
  });

  test("the missed approach's start is timed from the MAP", () => {
    const d = debriefApproach(ILS, track)!;
    expect(d.outcome.kind).toBe("missed");
    expect(d.outcome.secondsAfterMap!).toBeGreaterThanOrEqual(10);
    expect(d.outcome.secondsAfterMap!).toBeLessThanOrEqual(14);
    expect(d.findings.some(f => /^Missed approach started 1[0-4] s after the MAP$/.test(f.text))).toBe(true);
  });

  test("a landing is said as one", () => {
    const landing = fly(finalOf(ILS), {
      alt: onIls, after: 120, afterAlt: () => 727, afterKt: s => Math.max(5, 120 - s * 3),
    });
    const d = debriefApproach(ILS, landing)!;
    expect(d.outcome.kind).toBe("landed");
    expect(d.findings.some(f => f.text.startsWith("Landed"))).toBe(true);
  });

  test("is found among the field's approaches, the RNAV down the same final named with it", () => {
    const found = findApproaches([RNAV, ILS], track);
    expect(found).toHaveLength(1);
    expect(found[0]!.id).toBe("I08-Y");
    expect(found[0]!.alsoFits).toContain("RNAV (GPS) Z RWY 08");
  });

  test("the one the pilot picked wins where two fit alike", () => {
    // Both laterally on the same final and neither's glidepath followed:
    // no altitudes.
    const flat = fly(finalOf(ILS), { after: 60 });
    expect(findApproaches([ILS, RNAV], flat, "R08-Z")[0]!.id).toBe("R08-Z");
  });
});

describe("what it flags", () => {
  test("a track a mile off the final is flagged full scale on final", () => {
    // A mile left from 4.5 to 2.5 nm out, back on by the runway.
    const off = (toGo: number) => (toGo < 4.5 && toGo > 2.5 ? -1 : toGo <= 2.5 && toGo > 2 ? -(toGo - 2) * 2 : 0);
    const d = debriefApproach(ILS, fly(finalOf(ILS), { alt: onIls, off, after: 60, afterAlt: missedAfter(5) }))!;
    const lateral = d.findings.find(f => f.text.startsWith("Full scale left of the course"))!;
    expect(lateral.tone).toBe("stop");
    expect(lateral.text).toMatch(/on final, 1\.0 nm off at most$/);
    const nm = Number(/for (\d+\.\d) nm/.exec(lateral.text)![1]);
    expect(nm).toBeGreaterThan(1.8);
    expect(nm).toBeLessThan(3.1);
    expect(d.plan.track.some(p => p.off)).toBe(true);
  });

  test("a track that never came near the final approach fix is no approach of it", () => {
    const wide = fly(finalOf(ILS), { off: () => 2, alt: onIls });
    expect(attemptsAt(ILS, wide)).toEqual([]);
    expect(debriefApproach(ILS, wide)).toBeNull();
    expect(findApproaches([ILS, RNAV], wide)).toEqual([]);
  });

  test("on an RNAV, a mile off before the FAF is within terminal full scale, after it is not", () => {
    const line = wayIn(RNAV_MIKEI);
    const mikeiToGo = lengthOf(line.slice(1));
    const alt = (toGo: number) => (toGo > mikeiToGo - 2 ? 7000 : toGo > 6 ? 4100 : toGo > 5.2 ? 3000 : 1200);
    const half = (toGo: number) => (toGo > 7 && toGo < 9 ? 0.6 : toGo > 1.5 && toGo < 3 ? 0.6 : 0);
    const d = debriefApproach(RNAV_MIKEI, fly(line, { alt, off: half, after: 90, afterAlt: s => 1200 + s * 15 }))!;
    const full = d.findings.filter(f => f.text.startsWith("Full scale"));
    // ±1 nm before the ramp (AIM 1-1-17), ±0.3 nm down the final.
    expect(full).toHaveLength(1);
    expect(full[0]!.text).toMatch(/right of the course .* on final/);
  });

  test("a track under a fix's altitude before it is flagged", () => {
    // The RNAV via MIKEI, down to 3,500 a mile and a half before SILEX's
    // 4,100 (at or above).
    const line = wayIn(RNAV_MIKEI);
    const silexToGo = lengthOf(line.slice(2));
    const alt = (toGo: number) => (toGo > silexToGo + 1.5 ? 7000 : toGo > 5.5 ? 3500 : 1200);
    const d = debriefApproach(RNAV_MIKEI, fly(line, { alt, after: 60, afterAlt: s => 1200 + s * 15 }))!;
    const silex = d.findings.find(f => f.text.includes("SILEX"))!;
    expect(silex).toEqual({ tone: "stop", text: "At SILEX: 600 ft below 4,100" });
    expect(d.crossings.find(c => c.ident === "SILEX")!.underFt).toBeCloseTo(600, 0);
  });

  test("under a step-down inside the final is marked for an MDA's minimums", () => {
    // RNAV Z 08 with a step-down fix halfway down its final at 1,800.
    const final = RNAV.lines.find(l => l.role === "final")!;
    const [bubne, himen] = [final.points[1]!, final.points[2]!];
    const mid: [number, number] = [(bubne[0] + himen[0]) / 2, (bubne[1] + himen[1]) / 2];
    const stepped: ProcedureDrawing = {
      ...RNAV,
      lines: RNAV.lines.map(l => (l.role === "final" ? { ...l, points: [l.points[0]!, bubne, mid, himen] } : l)),
      fixes: [...RNAV.fixes.slice(0, 2), { ident: "STEPP", lat: mid[0], lon: mid[1], roles: [], min_ft: 1800, max_ft: null, missed: false }, ...RNAV.fixes.slice(2)],
    } as ProcedureDrawing;
    const midToGo = distanceNm(ll(mid), ll(himen));
    const alt = (toGo: number) => (toGo > 5.4 ? 4100 : toGo > midToGo + 1 ? 2400 : 1500);
    const d = debriefApproach(stepped, fly(finalOf(stepped), { alt, after: 60, afterAlt: s => 1500 + s * 15 }))!;
    expect(d.findings.find(f => f.text.includes("STEPP"))).toEqual({
      tone: "caution", text: "At STEPP: 300 ft below 1,800 (an MDA's step-down, not a glidepath's)",
    });
  });

  test("under the pilot's minimums before a missed approach is flagged", () => {
    const d = debriefApproach(ILS, fly(finalOf(ILS), { alt: onIls, after: 60, afterAlt: missedAfter(3) }), { minimumsFt: 1000 })!;
    expect(d.findings.find(f => f.text.startsWith("Down to"))?.tone).toBe("stop");
    // Typed again: at or above lower minimums, and the old finding gone.
    const lower = withMinimums(d, 700);
    expect(lower.findings.filter(f => f.minimums)).toEqual([{ tone: "ok", text: "Lowest before the MAP: 787 ft, at or above 700", minimums: true }]);
  });

  test("under the minimums to land is what 91.175(c) allows with the runway in sight, not a fault", () => {
    const landing = fly(finalOf(ILS), { alt: onIls, after: 120, afterAlt: () => 727, afterKt: s => Math.max(5, 120 - s * 3) });
    const d = debriefApproach(ILS, landing, { minimumsFt: 1000 })!;
    expect(d.findings.find(f => f.minimums)).toEqual({ tone: "info", text: "Below 1,000 to land: 91.175(c) asks for the runway in sight there", minimums: true });
  });

  test("below the glide slope's full scale is flagged, its height under the path said", () => {
    const low = (toGo: number) => (toGo < 4 && toGo > 2 ? onIls(toGo) - 400 : onIls(toGo));
    const d = debriefApproach(ILS, fly(finalOf(ILS), { alt: low, after: 60, afterAlt: missedAfter(5) }))!;
    expect(d.findings.some(f => f.tone === "stop" && f.text.startsWith("Below the glide slope's full scale"))).toBe(true);
    expect(d.findings.find(f => f.text.startsWith("Glidepath"))!.text).toMatch(/to 400 ft below it$/);
  });
});

describe("what it has to go on", () => {
  test("a track with no altitudes is debriefed on its course alone", () => {
    const d = debriefApproach(ILS, fly(finalOf(ILS), { after: 60 }))!;
    expect(d.hasAltitude).toBe(false);
    expect(d.findings.some(f => f.text === "The track has no altitudes: the course alone is debriefed")).toBe(true);
    expect(d.crossings.every(c => c.altFt == null && c.underFt == null)).toBe(true);
    expect(d.outcome.kind).toBe("unknown");
    expect(d.profile.track).toEqual([]);
  });

  test("the transition flown is found among its transitions, and the vectors where none was", () => {
    const viaLax = fly(wayIn(ILS_LAX), {
      alt: toGo => (toGo > 11 ? 4600 : onIls(toGo)), after: 60, afterAlt: missedAfter(5),
    });
    const vectors = findApproaches([ILS], viaLax)[0]!;
    expect(vectors.transition).toBeNull();
    expect(withTransition(vectors, [ILS_LAX], viaLax).transition).toBe("LAX");
    const straightIn = fly(finalOf(ILS), { alt: onIls, after: 60, afterAlt: missedAfter(5) });
    const fromVectors = findApproaches([ILS], straightIn)[0]!;
    expect(withTransition(fromVectors, [ILS_LAX], straightIn).transition).toBeNull();
  });

  test("two attempts are two approaches", () => {
    const once = fly(finalOf(ILS), { alt: onIls, after: 60, afterAlt: missedAfter(5) });
    const again = once.map(p => ({ ...p, t: p.t + 20 * 60_000 }));
    // The way back round, far off the final, between them.
    const between = Array.from({ length: 30 }, (_, k) => ({ t: once[once.length - 1]!.t + (k + 1) * 30_000, lat: 34.4, lon: -118.5 + k * 0.001, altFt: 3000 }));
    const found = findApproaches([ILS], [...once, ...between, ...again]);
    expect(found).toHaveLength(2);
  });
});
