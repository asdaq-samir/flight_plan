import { describe, expect, it } from "vitest";
import { hm } from "./clock";

describe("a time en route as a paper nav log writes it", () => {
  it("pads the minutes, rounded first", () => {
    expect(hm(18)).toBe("0:18");
    expect(hm(95)).toBe("1:35");
    // 119.6 minutes is two hours: rounded on its own, the remainder read "1:60".
    expect(hm(119.6)).toBe("2:00");
  });
});
