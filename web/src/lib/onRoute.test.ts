import { describe, expect, it } from "vitest";
import type { OnRoute } from "./api/types";
import { clockTime } from "./clock";
import { legLines, legWords, metWhileValid, onRouteLine } from "./onRoute";

const on = (over: Partial<OnRoute>): OnRoute => ({
  legs: [1, 2], from_nm: 40, to_nm: 70, enter: "2026-10-04T14:20:00Z", leave: "2026-10-04T14:45:00Z",
  valid_from: "2026-10-04T13:00:00Z", valid_to: "2026-10-04T15:00:00Z", when: "during", source: "SIGMET", issued: null, ...over,
});
const t = (iso: string) => clockTime(new Date(iso));

describe("legWords", () => {
  it("says the legs as the nav log numbers them, runs together", () => {
    expect(legWords([1])).toBe("Leg 2");
    expect(legWords([1, 2])).toBe("Legs 2–3");
    expect(legWords([0, 2, 3])).toBe("Legs 1, 3–4");
    expect(legWords([])).toBe("");
  });
});

describe("onRouteLine", () => {
  it("is the legs, the airplane's time there and until when the hazard is valid", () => {
    expect(onRouteLine(on({}))).toBe(`Legs 2–3 · ${t("2026-10-04T14:20:00Z")}–${t("2026-10-04T14:45:00Z")}, valid till ${t("2026-10-04T15:00:00Z")}`);
  });

  it("says when the airplane is there before the hazard starts or after it ends", () => {
    expect(onRouteLine(on({ when: "before", valid_from: "2026-10-04T16:00:00Z" }))).toContain(`before it starts at ${t("2026-10-04T16:00:00Z")}`);
    expect(onRouteLine(on({ when: "after" }))).toContain(`after it ends at ${t("2026-10-04T15:00:00Z")}`);
    expect(metWhileValid(on({ when: "after" }))).toBe(false);
    expect(metWhileValid(on({ when: null, source: "PIREP" }))).toBe(true);
  });

  it("gives a point's one time, and a pilot report's when it was made", () => {
    const pirep = on({ legs: [0], enter: "2026-10-04T14:10:00Z", leave: "2026-10-04T14:10:00Z", when: null, source: "PIREP",
      valid_from: null, valid_to: null, issued: "2026-10-04T13:40:00Z" });
    expect(onRouteLine(pirep)).toBe(`Leg 1 · ${t("2026-10-04T14:10:00Z")}, reported ${t("2026-10-04T13:40:00Z")}`);
  });

  it("does not give a G-AIRMET's snapshot window as if it were the product's", () => {
    expect(onRouteLine(on({ source: "G-AIRMET" }))).not.toContain("valid till");
  });
});

describe("legLines", () => {
  const fixes = [{ lat: 0, lon: 0 }, { lat: 1, lon: 0 }, { lat: 2, lon: 0 }, { lat: 3, lon: 0 }, { lat: 4, lon: 0 }];
  it("joins legs next to each other into one line and leaves out any past the fixes", () => {
    expect(legLines([1, 2], fixes)).toEqual([[fixes[1], fixes[2], fixes[3]]]);
    expect(legLines([0, 3, 9], fixes)).toEqual([[fixes[0], fixes[1]], [fixes[3], fixes[4]]]);
  });
});
