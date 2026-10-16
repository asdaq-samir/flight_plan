import { describe, expect, it } from "vitest";
import { categoryOf } from "./map/flightCategory";
import { metarOf, observedAt } from "./metarText";

const NOW = new Date("2026-10-11T16:20:00Z");

describe("a METAR read from its text", () => {
  it("reads the figures the card shows, and stops at the remarks", () => {
    const metar = metarOf("METAR KDLH 111555Z 25012G20KT 10SM FEW040 BKN090 OVC250 13/M02 A3012 RMK AO2 SLP199 T01331022=", NOW)!;
    expect(metar).toMatchObject({
      observed_at: "2026-10-11T15:55:00Z", wind_dir_true_deg: 250, wind_speed_kt: 12, wind_gust_kt: 20,
      visibility_sm: 10, ceiling_ft: 9000, temp_c: 13, dewpoint_c: -2, altimeter_in_hg: 30.12, flight_category: "VFR",
    });
    expect(metar.raw).toBe("METAR KDLH 111555Z 25012G20KT 10SM FEW040 BKN090 OVC250 13/M02 A3012 RMK AO2 SLP199 T01331022=");
  });

  it("a mile and a half, a vertical visibility as the ceiling, a variable wind", () => {
    const metar = metarOf("SPECI KMSN 111612Z AUTO VRB04KT 1 1/2SM BR VV004 08/08 A2990", NOW)!;
    expect(metar).toMatchObject({ visibility_sm: 1.5, ceiling_ft: 400, wind_dir_true_deg: null, wind_speed_kt: 4, flight_category: "LIFR" });
    expect(metarOf("METAR KOSH 111553Z 00000KT M1/4SM FG OVC001 M01/M01 A3001", NOW)).toMatchObject({ visibility_sm: 0.25, ceiling_ft: 100, temp_c: -1 });
  });

  it("no ceiling with only scattered cloud, and the categories at their edges", () => {
    expect(metarOf("METAR KATW 111555Z 18008KT 5SM HZ SCT008 20/12 A3001", NOW)).toMatchObject({ ceiling_ft: null, flight_category: "MVFR" });
    expect(categoryOf(3000, 10)).toBe("MVFR");
    expect(categoryOf(3100, 6)).toBe("VFR");
    expect(categoryOf(900, 10)).toBe("IFR");
    expect(categoryOf(null, 0.75)).toBe("LIFR");
    expect(categoryOf(null, null)).toBeNull();
  });

  it("a day still to come this month is last month's", () => {
    expect(observedAt("302355Z", NOW)).toBe("2026-09-30T23:55:00Z");
    expect(observedAt("111700Z", NOW)).toBe("2026-10-11T17:00:00Z");
  });

  it("is not a TAF", () => {
    expect(metarOf("TAF KDLH 111130Z 1112/1212 25012KT P6SM SCT050", NOW)).toBeNull();
  });
});
