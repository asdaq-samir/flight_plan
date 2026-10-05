// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import type { Flight } from "./api/types";
import { airborne, debrief } from "./debrief";
import { readTrack, thin, TrackError, type TrackPoint } from "./track";

/** A flight due north along 88° W: A at 42° N, a lake 30 nm on, B 30 nm
 *  past it, 18 minutes a leg at 3,500 ft. */
const FLIGHT = {
  id: 1, departureIdent: "A", destinationIdent: "B", stops: [], aircraftTailNumber: null, cruiseAltitudeFt: 3500,
  totalDistanceNm: 60, totalEteMin: 36, totalFuelGal: 6, plannedFor: null, createdAt: "2026-10-01T12:00:00Z", risk: null,
  checkpoints: [
    { sequenceNo: 0, name: "A", category: "departure", lat: 42, lon: -88, alongTrackNm: 0, legDistanceNm: null, trueCourseDeg: null, magneticHeadingDeg: null, groundspeedKt: null, eteMin: null, fuelGal: null, altitudeFt: null },
    { sequenceNo: 1, name: "Lake", category: "lake", lat: 42.5, lon: -88, alongTrackNm: 30, legDistanceNm: 30, trueCourseDeg: 0, magneticHeadingDeg: 3, groundspeedKt: 100, eteMin: 18, fuelGal: 3, altitudeFt: 3500 },
    { sequenceNo: 2, name: "B", category: "destination", lat: 43, lon: -88, alongTrackNm: 60, legDistanceNm: 30, trueCourseDeg: 0, magneticHeadingDeg: 3, groundspeedKt: 100, eteMin: 18, fuelGal: 3, altitudeFt: 3500 },
  ],
} as Flight;

/** Flown every 5 s: two minutes' taxi, then north at 100 kt half a mile
 *  east of the line, climbing at 500 fpm to 3,600; 3,800 for two minutes
 *  on the second leg; down at 500 fpm to 1,800 in the last 4 nm; taxi. */
function flown(): TrackPoint[] {
  const t0 = Date.parse("2026-10-02T15:00:00Z");
  const lon = -88 + 0.5 / (60 * Math.cos((42.5 * Math.PI) / 180));
  const points: TrackPoint[] = [];
  for (let s = 0; s < 120; s += 5) points.push({ t: t0 + s * 1000, lat: 42 - 0.002 + (s / 3600) * (10 / 60), lon, altFt: 700 });
  const off = t0 + 120_000;
  for (let s = 0; s <= 36 * 60; s += 5) {
    const nm = (s / 3600) * 100;
    let alt = Math.min(3600, 700 + (s / 60) * 500);
    if (nm > 40 && nm < 40 + 100 / 30) alt = 3800;
    if (nm > 56) alt = Math.max(1800, 3600 - (nm - 56) * 600);
    points.push({ t: off + s * 1000, lat: 42 + nm / 60, lon, altFt: alt });
  }
  const on = off + 36 * 60_000;
  for (let s = 5; s < 120; s += 5) points.push({ t: on + s * 1000, lat: 43 + (s / 3600) * (10 / 60), lon, altFt: 700 });
  return points;
}

describe("a track read", () => {
  test("GPX's points, metres to feet, in time order", () => {
    const points = readTrack(`<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>
      <trkpt lat="42.1" lon="-88.1"><ele>1000</ele><time>2026-10-02T15:00:05Z</time></trkpt>
      <trkpt lat="42.0" lon="-88.0"><ele>304.8</ele><time>2026-10-02T15:00:00Z</time></trkpt>
    </trkseg></trk></gpx>`);
    expect(points.map(p => p.lat)).toEqual([42.0, 42.1]);
    expect(points[0]!.altFt).toBeCloseTo(1000, 0);
  });

  test("KML's gx:Track, as ForeFlight writes its track log", () => {
    const points = readTrack(`<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2"><Document><Placemark><gx:Track>
      <when>2026-10-02T15:00:00Z</when><when>2026-10-02T15:00:04Z</when>
      <gx:coord>-88.0 42.0 300</gx:coord><gx:coord>-88.0 42.01 310</gx:coord>
    </gx:Track></Placemark></Document></kml>`);
    expect(points).toHaveLength(2);
    expect(points[1]!.lat).toBe(42.01);
  });

  test("a file it cannot use says why", () => {
    expect(() => readTrack("not xml at all")).toThrow(TrackError);
    expect(() => readTrack(`<gpx><trk><trkseg><trkpt lat="42" lon="-88"/><trkpt lat="42.1" lon="-88"/></trkseg></trk></gpx>`)).toThrow(/no times/);
    expect(thin(flown(), 100)).toHaveLength(100);
  });
});

describe("a flight debriefed", () => {
  const d = debrief(FLIGHT, flown(), { B: 1700 })!;

  test("the flight is the track's run over 40 kt", () => {
    expect(airborne(flown())).toHaveLength(1);
    expect(d.flownMin).toBeCloseTo(36, 0);
    expect(d.plannedMin).toBe(36);
    expect(d.notes).toEqual([]);
  });

  test("leg by leg: the course held and how far off it, the altitude held", () => {
    expect(d.legs[0]!.courseWithin).toBe(1);
    // Half a mile east of a northbound line: right of it.
    expect(d.legs[0]!.worstOffNm).toBeCloseTo(0.5, 1);
    // The climb is not the cruise: 3,600 from there is within 200.
    expect(d.legs[0]!.altitudeWithin).toBe(1);
    // Two minutes at 3,800 of the second leg's cruise.
    expect(d.legs[1]!.altitudeWithin).toBeGreaterThan(0.75);
    expect(d.legs[1]!.altitudeWithin).toBeLessThan(0.95);
    expect(d.legs[1]!.worstAltFt).toBe(300);
  });

  test("each checkpoint when it was due and when it was passed, and the pattern", () => {
    expect(d.passes.map(p => p.name)).toEqual(["Lake", "B"]);
    expect(d.passes[0]!.dueMin).toBe(18);
    expect(d.passes[0]!.passedMin).toBeCloseTo(18, 0);
    expect(d.passes[0]!.closestNm).toBeCloseTo(0.5, 1);
    expect(d.passes[1]!.passedMin).toBeCloseTo(36, 0);
    expect(d.patterns).toHaveLength(1);
    expect(d.patterns[0]!.patternFt).toBe(1700);
    expect(d.patterns[0]!.altFt).toBeGreaterThan(1700);
  });

  test("a track from somewhere else is said, and one that never flew is none", () => {
    const elsewhere = flown().map(p => ({ ...p, lat: p.lat + 1 }));
    expect(debrief(FLIGHT, elsewhere)!.notes[0]).toMatch(/takes off 60 nm from A/);
    const taxi = flown().slice(0, 20);
    expect(debrief(FLIGHT, taxi)).toBeNull();
  });
});
