import { describe, expect, test } from "vitest";
import { ctafOf, frequencyLine, kneeboardRadio, mhzText } from "./frequencies";

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

describe("which of a field's frequencies is the CTAF, and the kneeboard's list", () => {
  const f = (type: string, frequency_mhz: number, description = type) => ({ type, description, frequency_mhz });

  test("the CTAF so called, else a UNICOM that is the CTAF too, else a UNICOM, else MULTICOM's 122.9", () => {
    expect(ctafOf([f("UNIC", 122.8), f("CTAF", 122.7)]).frequency_mhz).toBe(122.7);
    expect(ctafOf([f("UNIC", 123.0, "CTAF/UNICOM")]).frequency_mhz).toBe(123);
    expect(ctafOf([f("UNIC", 122.95)]).frequency_mhz).toBe(122.95);
    expect(ctafOf([f("AWOS", 118.375)])).toMatchObject({ type: "MULTICOM", frequency_mhz: 122.9 });
  });

  test("the kneeboard names MULTICOM's 122.9 where the radio calls do, never for a towered field", () => {
    expect(kneeboardRadio([f("AWOS", 118.375)])).toEqual([["AWOS", 118.375], ["MULTICOM", 122.9]]);
    expect(kneeboardRadio([f("UNIC", 123.0, "CTAF/UNICOM")])).toEqual([["CTAF", 123]]);
    expect(kneeboardRadio([f("ATIS", 135.4), f("TWR", 118.3), f("UNIC", 122.95)])).toEqual([["ATIS", 135.4], ["TWR", 118.3]]);
    expect(kneeboardRadio([f("TWR", 118.3)])).toEqual([["TWR", 118.3]]);
  });
});
