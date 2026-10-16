import { describe, expect, it } from "vitest";
import { awayFrom, nmAway, nmFigure } from "./useAway";

describe("how far, as the app says it", () => {
  it("to a tenth under 10 nm, in whole miles from there", () => {
    expect(nmFigure(4.64)).toBe("4.6");
    expect(nmFigure(0.04)).toBe("0.0");
    // 9.96 is 10.0 to a tenth: said as 10, not "10.0".
    expect(nmFigure(9.96)).toBe("10");
    expect(nmAway(12.3)).toBe("12 nm");
  });

  it("which way, as a compass point", () => {
    // Campbell (C81) to Waukegan (KUGN), some 17 nm to the east-north-east.
    expect(awayFrom({ lat: 42.3246, lon: -88.0741 }, { lat: 42.4222, lon: -87.8679 })).toMatch(/^1\d nm (NE|E)$/);
  });
});
