import { describe, expect, it } from "vitest";
import { settleSeconds } from "./engine";

describe("settleSeconds", () => {
  it("takes the owner's 0.3 s over the pill-to-half distance, clamped either side", () => {
    expect(settleSeconds(273)).toBe(0.3);
    expect(settleSeconds(20)).toBe(0.22);
    expect(settleSeconds(900)).toBe(0.35);
    expect(settleSeconds(-273)).toBe(0.3);
  });
});
