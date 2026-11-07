import { describe, expect, test } from "vitest";
import { metarWords } from "./metarWords";

describe("a METAR said aloud", () => {
  test("the figures in the report's order, the category last", () => {
    expect(metarWords("Milwaukee", {
      raw: "KMKE 031552Z 27010G18KT 10SM BKN030 12/08 A3002", flight_category: "MVFR", ceiling_ft: 3000, ceiling_unknown: false, visibility_sm: 10,
      wind_dir_true_deg: 270, wind_speed_kt: 10, wind_gust_kt: 18, altimeter_in_hg: 30.02, temp_c: 12, dewpoint_c: 8,
    })).toBe("Milwaukee: wind 270 at 10 gusting 18 knots, visibility 10 miles, ceiling 3,000 feet, temperature 12, dew point 8, altimeter 30.02. M V F R.");
  });

  test("calm, a fraction of a mile, no ceiling, nothing missing said", () => {
    expect(metarWords("KDLH", { wind_speed_kt: 0, visibility_sm: 0.5, ceiling_ft: null, ceiling_unknown: false, flight_category: "IFR" }))
      .toBe("KDLH: wind calm, visibility half a mile, no ceiling. I F R.");
    expect(metarWords("KDLH", { wind_speed_kt: 5, wind_dir_true_deg: null, visibility_sm: 1, ceiling_ft: 800, ceiling_unknown: false }))
      .toBe("KDLH: wind variable at 5 knots, visibility 1 mile, ceiling 800 feet.");
    // OVC/// with ten miles: not "no ceiling", and no category to say.
    expect(metarWords("KDLH", { wind_speed_kt: 0, visibility_sm: 10, ceiling_ft: null, ceiling_unknown: true, flight_category: null }))
      .toBe("KDLH: wind calm, visibility 10 miles, ceiling height not known.");
  });
});
