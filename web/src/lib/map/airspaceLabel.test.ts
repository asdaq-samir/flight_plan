import { describe, expect, it } from "vitest";
import { airspaceFacts, airspaceHours, airspaceLabel, hundreds } from "./airspaceLabel";

const volume = (over: Partial<Parameters<typeof airspaceLabel>[0]>) => ({
  airspace_class: "B" as const, floor_ft: 0, floor_sfc: true, ceiling_ft: 10000, ceiling_excluded: false, ...over,
});

describe("an airspace's label, as the sectional prints it", () => {
  it("writes feet as the chart's hundreds", () => {
    expect(hundreds(10000)).toBe("100");
    expect(hundreds(3600)).toBe("36");
    expect(hundreds(1900)).toBe("19");
  });

  it("is a Class B or C shelf's top over its floor, the surface as SFC", () => {
    // O'Hare's surface area and its 3,000 ft shelf.
    expect(airspaceLabel(volume({}))).toEqual({ kind: "shelf", top: "100", floor: "SFC" });
    expect(airspaceLabel(volume({ floor_ft: 3000, floor_sfc: false }))).toEqual({ kind: "shelf", top: "100", floor: "30" });
    // Midway's outer shelf: the file's top, not the chart's "T".
    expect(airspaceLabel(volume({ airspace_class: "C", ceiling_ft: 3600, floor_ft: 1900, floor_sfc: false })))
      .toEqual({ kind: "shelf", top: "36", floor: "19" });
    // A Class C up to but not including its top.
    expect(airspaceLabel(volume({ airspace_class: "C", ceiling_ft: 4000, ceiling_excluded: true })))
      .toEqual({ kind: "shelf", top: "-40", floor: "SFC" });
  });

  it("is a Class D's ceiling, with a minus where it is up to but not including it", () => {
    expect(airspaceLabel(volume({ airspace_class: "D", ceiling_ft: 3300 }))).toEqual({ kind: "ceiling", ceiling: "33" });
    // Wheeling, under O'Hare's 3,000 ft shelf.
    expect(airspaceLabel(volume({ airspace_class: "D", ceiling_ft: 3000, ceiling_excluded: true })))
      .toEqual({ kind: "ceiling", ceiling: "-30" });
  });

  it("is none where the file gives no top", () => {
    expect(airspaceLabel(volume({ ceiling_ft: null }))).toBeNull();
  });
});

describe("an airspace's card, in words", () => {
  const wheeling = {
    name: "CHICAGO, WAUKEGAN REGIONAL CLASS D", floor_ft: 0, floor_sfc: true, ceiling_ft: 3000, ceiling_excluded: true,
    hours_code: "NOTAM", hours_remark: "Legal description references NOTAM",
  };

  it("names it as a place is written, and gives its floor and ceiling in feet MSL", () => {
    expect(airspaceFacts(wheeling)).toEqual({
      name: "Chicago, Waukegan Regional Class D", floor: "SFC", ceiling: "Up to but not including 3,000 ft MSL", hours: "By NOTAM",
    });
    expect(airspaceFacts({ ...wheeling, floor_ft: 1900, floor_sfc: false, ceiling_ft: 10000, ceiling_excluded: false }))
      .toMatchObject({ floor: "1,900 ft MSL", ceiling: "10,000 ft MSL" });
  });

  it("says when it is in effect as the file's hours code and remark do", () => {
    expect(airspaceHours("H24", null)).toBe("Continuous");
    expect(airspaceHours("NOTAM", "Legal description references NOTAM")).toBe("By NOTAM");
    expect(airspaceHours("NOTAM", "0600-2200 LOCAL")).toBe("By NOTAM. 0600-2200 local");
    // Cocoa Beach's, the file's only "RMK".
    expect(airspaceHours("RMK", "Airspace effective on a random basis")).toBe("Airspace effective on a random basis");
    expect(airspaceHours(null, null)).toBeNull();
  });
});
