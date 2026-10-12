import { beforeEach, describe, expect, it } from "vitest";
import {
  choosePastFlight, clearPastFlight, pausePastFlight, playPastFlight, positionAt, stepPastFlight, stopPastFlight, usePastFlight,
} from "./pastFlight";

const POINTS = [
  { t: 1000, lat: 43.0, lon: -71.0, alt_ft: 1000, gs_kt: 90, track_deg: 90, vrate_fpm: 500 },
  { t: 1100, lat: 43.0, lon: -70.0, alt_ft: 3000, gs_kt: 110, track_deg: 90, vrate_fpm: 0 },
];

describe("a past flight replayed", () => {
  beforeEach(() => {
    clearPastFlight();
    choosePastFlight("a89c1e", 1000);
    usePastFlight.setState({ points: POINTS, speed: 10 });
  });

  it("puts the airplane between its reports in proportion, outside them nowhere", () => {
    expect(positionAt(POINTS, 1025)).toMatchObject({ t: 1025, lat: 43.0, lon: -70.75, alt_ft: 1500, gs_kt: 90 });
    expect(positionAt(POINTS, 999)).toBeNull();
    expect(positionAt(POINTS, 1101)).toBeNull();
  });

  it("plays from the start at its speed, stops at the end, and plays again from the start", () => {
    playPastFlight();
    expect(usePastFlight.getState().at).toBe(1000);
    stepPastFlight(5000);                                // 5 s at 10 times: 50 s of the flight
    expect(usePastFlight.getState().at).toBe(1050);
    pausePastFlight();
    stepPastFlight(5000);
    expect(usePastFlight.getState().at).toBe(1050);
    playPastFlight();
    stepPastFlight(60_000);
    expect(usePastFlight.getState()).toMatchObject({ at: 1100, playing: false });
    playPastFlight();
    expect(usePastFlight.getState().at).toBe(1000);
    stopPastFlight();
    expect(usePastFlight.getState()).toMatchObject({ at: null, playing: false });
  });
});
