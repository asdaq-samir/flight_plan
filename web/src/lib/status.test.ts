import { describe, expect, it } from "vitest";
import { worstOf } from "./status";

describe("worstOf", () => {
  it("is a stop over a caution over not known, and nothing found when all are fine", () => {
    expect(worstOf(["ok", "caution", "stop"])).toBe("stop");
    expect(worstOf(["ok", "unknown", "caution"])).toBe("caution");
    expect(worstOf(["pending", "unknown"])).toBe("unknown");
    expect(worstOf(["ok", "ok"])).toBe("ok");
    expect(worstOf([])).toBe("ok");
  });
});
