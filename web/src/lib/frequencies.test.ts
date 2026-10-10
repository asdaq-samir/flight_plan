import { describe, expect, test } from "vitest";
import { frequencyLine, mhzText } from "./frequencies";

describe("a field's frequencies as its card lists them", () => {
  test("are written as pilots write them", () => {
    expect(mhzText(118.3)).toBe("118.3");
    expect(mhzText(122.95)).toBe("122.95");
    expect(mhzText(124.475)).toBe("124.475");
    expect(mhzText(121)).toBe("121.0");
  });

  test("are named in words, with what OurAirports says only where it adds to the name", () => {
    expect(frequencyLine("TWR", "TWR")).toEqual({ name: "Tower", kind: "tower", detail: null });
    expect(frequencyLine("UNIC", "UNICOM")).toEqual({ name: "UNICOM", kind: "traffic", detail: null });
    expect(frequencyLine("A/D", "MINNEAPOLIS APP/DEP")).toEqual({ name: "Approach and departure", kind: "approach", detail: "Minneapolis APP/DEP" });
    expect(frequencyLine("ATIS", "ATIS")).toEqual({ name: "ATIS", kind: "weather", detail: null });
    expect(frequencyLine("GCCD", "GND/CLNC DEL")).toMatchObject({ name: "Ground and clearance", kind: "ground" });
  });

  test("name a type with no name of its own by its description", () => {
    expect(frequencyLine("POST", "ANG COMD POST")).toMatchObject({ kind: "other", detail: null });
    expect(frequencyLine("POST", "ANG COMD POST").name).toBe("ANG comd post");
    expect(frequencyLine(null, null)).toEqual({ name: "Frequency", kind: "other", detail: null });
  });
});
