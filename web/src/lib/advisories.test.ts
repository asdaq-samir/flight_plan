import { describe, expect, it } from "vitest";
import { faaWords, gairmetAltitudes, gairmetTitle, pirepConditions, sigmetHazard, suaAltitudes, tfrAltitudes, tfrTimes } from "./advisories";

const gairmet = { hazard: "Icing", severity: "MOD", due_to: "ICE", valid_at: null, altitude_low_ft: null, from_freezing_level: true, altitude_high_ft: 22000 };

describe("advisories in words", () => {
  it("a G-AIRMET's hazard, how bad, and how high", () => {
    expect(gairmetTitle(gairmet)).toBe("Icing, moderate");
    expect(gairmetAltitudes(gairmet)).toBe("Freezing level to 22,000 ft");
    expect(gairmetAltitudes({ ...gairmet, from_freezing_level: false, altitude_low_ft: 5000, altitude_high_ft: 18000 })).toBe("5,000 to 18,000 ft");
    expect(gairmetAltitudes({ ...gairmet, hazard: "IFR conditions", from_freezing_level: false, altitude_high_ft: null })).toBeNull();
  });

  it("a PIREP's turbulence and icing", () => {
    const pirep = { altitude_ft: 7000, along_track_nm: 12, urgent: false, turbulence: "MOD", icing: "NEG" };
    expect(pirepConditions(pirep)).toBe("Turbulence moderate · No icing");
    expect(pirepConditions({ ...pirep, turbulence: null, icing: null })).toBeNull();
  });

  it("a TFR's altitudes and times", () => {
    expect(tfrAltitudes({ floor_ft: 0, floor_ref: "MSL", ceiling_ft: 10000, ceiling_ref: "MSL" })).toBe("Surface to 10,000 ft MSL");
    expect(tfrAltitudes({ floor_ft: 0, floor_ref: "AGL", ceiling_ft: 400, ceiling_ref: "AGL" })).toBe("Surface to 400 ft AGL");
    expect(tfrTimes({ effective: null, expires: null })).toBeNull();
    expect(tfrTimes({ effective: "2026-10-01T16:00:00Z", expires: null })).toMatch(/^From .* until further notice$/);
  });
});

describe("suaAltitudes", () => {
  it("a special-use area's limits as the chart writes them", () => {
    expect(suaAltitudes({ floor_ft: 0, floor_ref: "SFC", ceiling_ft: 18000, ceiling_ref: "MSL" })).toBe("Surface to 18,000 ft");
    expect(suaAltitudes({ floor_ft: 8000, floor_ref: "MSL", ceiling_ft: 18000, ceiling_ref: "STD" })).toBe("8,000 ft to FL180");
    expect(suaAltitudes({ floor_ft: 500, floor_ref: "AGL", ceiling_ft: null, ceiling_ref: null })).toBe("500 ft AGL to unstated");
  });
});

describe("the FAA's capitals in sentence case", () => {
  it("keeps the codes and the figures, and starts each sentence with a capital", () => {
    expect(faaWords("INTERMITTENT BY NOTAM 4 HOURS IN ADVANCE")).toBe("Intermittent by NOTAM 4 hours in advance");
    expect(faaWords("0700 - 2200 LOCAL, MON - FRI; OTHER TIMES BY NOTAM")).toBe("0700 - 2200 local, Mon - Fri; other times by NOTAM");
    expect(faaWords("AIR SPEED LOSS OR GAIN OF 20KTS OR MORE BELOW 2000 FT AGL")).toBe("Air speed loss or gain of 20KTS or more below 2000 ft AGL");
    // A cause made of contractions alone stays as the FAA wrote it.
    expect(faaWords("CIG BLW 010 VIS BLW 3SM BR FG")).toBe("CIG BLW 010 VIS BLW 3SM BR FG");
    expect(faaWords("Security: VIP movement")).toBe("Security: VIP movement");
    expect(faaWords(null)).toBe("");
    expect(sigmetHazard("CONVECTIVE")).toBe("Convective");
    expect(sigmetHazard("MTN OBSCN")).toBe("Mountain obscuration");
    expect(sigmetHazard(null, "SIGMET")).toBe("SIGMET");
  });
});
