import { describe, expect, it } from "vitest";
import { altFt, feet, gal, grouped, magneticVariation, nm, windCorrection } from "./units";

describe("figures written as the FAA writes them", () => {
  it("puts a comma between each three figures, rounded to a whole number", () => {
    expect(grouped(0)).toBe("0");
    expect(grouped(999)).toBe("999");
    expect(grouped(1000)).toBe("1,000");
    expect(grouped(12500)).toBe("12,500");
    expect(grouped(1234567.4)).toBe("1,234,567");
    expect(grouped(-1500)).toBe("-1,500");
    expect(grouped(2699.5)).toBe("2,700");
    expect(grouped(-2699.5)).toBe("-2,700");
    expect(grouped(-0.4)).toBe("0");
  });

  it("writes an altitude with it, and none as a dash", () => {
    expect(altFt(4500)).toBe("4,500");
    expect(feet(17999.6)).toBe("18,000 ft");
    expect(altFt(null)).toBe("—");
  });

  it("signs a wind correction as it is applied, with a minus sign, and none under half a degree", () => {
    expect(windCorrection(3.2)).toBe("+3°");
    expect(windCorrection(-3.2)).toBe("−3°");
    expect(windCorrection(-0.3)).toBe("0°");
    expect(windCorrection(-3.04, 1)).toBe("−3.0°");
    expect(windCorrection(-0.04, 1)).toBe("0.0°");
  });

  it("writes a variation east or west, as the chart does, never as a figure to add", () => {
    expect(magneticVariation(5.2)).toBe("5° E");
    expect(magneticVariation(5.24, 1)).toBe("5.2° E");
    expect(magneticVariation(-3.1)).toBe("3° W");
    expect(magneticVariation(0.2)).toBe("0°");
  });

  it("writes a route's distance and fuel to a tenth, a whole one too, and none as a dash", () => {
    expect(nm(102.4)).toBe("102.4 nm");
    expect(nm(102)).toBe("102.0 nm");
    expect(gal(12.34)).toBe("12.3 gal");
    expect(nm(null)).toBe("—");
    expect(gal(undefined)).toBe("—");
  });
});
