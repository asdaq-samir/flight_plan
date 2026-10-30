import { describe, expect, it } from "vitest";
import { declinationOf, fixRadialDistance, hoursOf, morseOf, radialOf, serviceVolume, threeFigures } from "./navaid";

// Joliet's VOR/DME as NASR files it (NAV_BASE, 2026-10-29): 2° E.
const JOT = { ident: "JOT", lat: 41.54641852, lon: -88.31841055, mag_var: 2 };

describe("navaid", () => {
  it("says a radial in three figures, north 360", () => {
    expect(threeFigures(0)).toBe("360");
    expect(threeFigures(359.6)).toBe("360");
    expect(threeFigures(45.2)).toBe("045");
  });

  it("takes the radial to the station's own declination: due north of a 2° E VOR is its 358 radial", () => {
    const off = radialOf(JOT, { lat: JOT.lat + 0.5, lon: JOT.lon })!;
    expect(threeFigures(off.radial)).toBe("358");
    expect(threeFigures(off.toCourse)).toBe("178");
    expect(off.nm).toBeCloseTo(30, 0);
    // A west declination the other way: 4° W puts due east on its 094.
    expect(threeFigures(radialOf({ ...JOT, mag_var: -4 }, { lat: JOT.lat, lon: JOT.lon + 0.5 })!.radial)).toBe("094");
    expect(radialOf({ ...JOT, mag_var: null }, JOT)).toBeNull();
  });

  it("puts a fix off the nearest VOR", () => {
    const far = { ident: "XXX", lat: 45, lon: -90, mag_var: 0 };
    expect(fixRadialDistance({ lat: JOT.lat + 0.2, lon: JOT.lon }, [far, JOT])).toBe("JOT 358° 12 nm");
    expect(fixRadialDistance(JOT, [])).toBeNull();
  });

  it("sends the ident in Morse, letters apart", () => {
    expect(morseOf("JOT")).toBe("·−−−  −−−  −");
  });

  it("says the service volumes as AIM 1-1-8 bounds them", () => {
    expect(serviceVolume("T")).toBe("Terminal · 25 nm, 1,000–12,000 ft above it");
    expect(serviceVolume("VL")).toBe("VOR Low · 40 nm under 5,000 ft above it, 70 nm to 18,000");
    expect(serviceVolume("X")).toBeNull();
    expect(hoursOf("24")).toBe("Continuous");
    expect(declinationOf(-4)).toBe("4° W");
  });
});
