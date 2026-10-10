import { describe, expect, it } from "vitest";
import { altFt, feet, grouped } from "./units";

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
});
