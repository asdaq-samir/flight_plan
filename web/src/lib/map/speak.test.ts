import { describe, expect, it } from "vitest";
import type { AheadAlert } from "../api/types";
import { spokenAlert, toSay } from "./speak";

const alert = (over: Partial<AheadAlert>): AheadAlert => ({
  id: "x", kind: "airspace", level: "caution", name: "ROCKFORD CLASS C", class: "C", need: "", inside: false,
  seconds: 130, distance_nm: 4.21, lat: 42, lon: -88, clearance_ft: null, ...over,
} as AheadAlert);

const classC = alert({ id: "c" });
const tower = alert({ id: "t", kind: "obstacle", name: "TOWER", class: null, top_ft: 2700, clearance_ft: 300, seconds: 40 });
const tfr = alert({ id: "f", kind: "tfr", level: "warning", name: "", notam_id: "6/1111", class: null, inside: true });
const terrain = alert({ id: "g", kind: "terrain", name: "", class: null, clearance_ft: -200, seconds: 5 });

describe("the alerts ahead, said", () => {
  it("as a voice reads the banner: feet and seconds in words, a TFR's number left to the screen", () => {
    expect(spokenAlert(classC)).toBe("Rockford Class C, in 2 minutes");
    expect(spokenAlert(alert({ seconds: 60 }))).toBe("Rockford Class C, in 1 minute");
    expect(spokenAlert(tower)).toBe("Tower 2,700 feet, 300 feet below you, in 40 seconds");
    expect(spokenAlert(tfr)).toBe("TFR, inside");
    expect(spokenAlert(terrain)).toBe("Terrain, 200 feet above you, now");
  });

  it("each once as it comes, the first in full and the rest as a count", () => {
    const first = toSay([classC, tower], new Set());
    expect(first.words).toBe("Rockford Class C, in 2 minutes, and 1 more.");
    // The same two again: nothing new to say.
    expect(toSay([classC, tower], first.said).words).toBeNull();
    // A new one joins them: it alone is said.
    expect(toSay([classC, tower, tfr], first.said).words).toBe("TFR, inside.");
  });

  it("again after it has gone from ahead and come back", () => {
    const both = toSay([classC, tower], new Set()).said;
    const gone = toSay([classC], both);
    expect(gone.words).toBeNull();
    expect([...gone.said]).toEqual(["c"]);
    expect(toSay([classC, tower], gone.said).words).toBe("Tower 2,700 feet, 300 feet below you, in 40 seconds.");
  });
});
