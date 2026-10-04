import { describe, expect, it } from "vitest";
import { gairmetAltitudes, gairmetTitle, pirepConditions, tfrAltitudes, tfrTimes } from "./advisories";

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
