import { describe, expect, test } from "vitest";
import { atisRows, glanceWords, heardAny, readAtis, skyWords, visibilityWords, windWords } from "./atis";
import fixture from "./fixtures/atis.json";

describe("an ATIS heard", () => {
  test("the fixture holds a dozen broadcasts at least", () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(12);
  });

  test.each(fixture.cases)("is read into its figures by the engine: $name", ({ heard, reading }) => {
    expect(readAtis(heard)).toEqual(reading);
  });

  test("the glance is the runway in use and the altimeter", () => {
    const r = readAtis(fixture.cases[0]!.heard);
    expect(heardAny(r)).toBe(true);
    expect(glanceWords(r)).toBe("Runway 19R · 29.92 inHg");
    expect(atisRows(r)).toEqual([
      { label: "Information", value: "C · 1852Z" },
      { label: "Wind", value: "210° at 12 kt, gusts 18" },
      { label: "Visibility", value: "10 sm" },
      { label: "Sky", value: "Few 4,500 ft" },
      { label: "Temperature", value: "18 °C, dew point 12 °C" },
      { label: "Altimeter", value: "29.92 inHg" },
      { label: "Approach", value: "ILS runway 19R" },
      { label: "Runways", value: "19R" },
    ]);
  });

  test("nothing of a broadcast in other words", () => {
    const r = readAtis("Plan a trip to Las Vegas");
    expect(heardAny(r)).toBe(false);
    expect(glanceWords(r)).toBe("Nothing of a broadcast was heard");
  });

  test("the wind, the visibility and the sky in a pilot's words", () => {
    expect(windWords({ from_deg: null, kt: 0, gust_kt: null, variable: false })).toBe("Calm");
    expect(windWords({ from_deg: null, kt: 4, gust_kt: null, variable: true })).toBe("Variable at 4 kt");
    expect(windWords({ from_deg: null, kt: null, gust_kt: null, variable: true })).toBe("Light and variable");
    expect(windWords({ from_deg: 180, kt: 15, gust_kt: 25, variable: true })).toBe("180° variable at 15 kt, gusts 25");
    expect(visibilityWords(2.5)).toBe("2½ sm");
    expect(visibilityWords(0.75)).toBe("¾ sm");
    expect(visibilityWords(10)).toBe("10 sm");
    // The ceiling is the lowest broken or overcast layer (14 CFR 1.1).
    expect(skyWords([{ cover: "scattered", base_ft: 1200 }, { cover: "broken", base_ft: 2500 }, { cover: "overcast", base_ft: 4000 }]))
      .toBe("Scattered 1,200 ft · Broken 2,500 ft (ceiling) · Overcast 4,000 ft");
    expect(skyWords([{ cover: "clear", base_ft: null }])).toBe("Clear");
  });
});
