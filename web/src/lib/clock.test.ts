import { describe, expect, it } from "vitest";
import { ago, duration, durationByHand, hm } from "./clock";

describe("a time en route as a paper nav log writes it", () => {
  it("pads the minutes, rounded first", () => {
    expect(hm(18)).toBe("0:18");
    expect(hm(95)).toBe("1:35");
    // 119.6 minutes is two hours: rounded on its own, the remainder read "1:60".
    expect(hm(119.6)).toBe("2:00");
  });
});

describe("a duration", () => {
  it("is Intl.DurationFormat's narrow style", () => {
    expect(duration(65)).toBe("1h 5m");
    expect(duration(45)).toBe("45m");
    expect(duration(180)).toBe("3h");
    expect(duration(0)).toBe("0m");
  });
  it("carries a rounded-up minute into the hour", () => {
    expect(duration(179.6)).toBe("3h");
    expect(duration(59.6)).toBe("1h");
  });
  it("writes by hand what the browser's formatter writes", () => {
    for (const minutes of [7, 45, 60, 65, 125, 179.6, 1500]) {
      const t = { hours: Math.floor(Math.round(minutes) / 60), minutes: Math.round(minutes) % 60 };
      expect(durationByHand(t)).toBe(duration(minutes));
    }
  });
});

describe("how long ago", () => {
  it("is a duration with ago, just now under a minute", () => {
    expect(ago(20_000)).toBe("just now");
    expect(ago(-5_000)).toBe("just now");
    expect(ago(23 * 60_000 + 40_000)).toBe("23m ago");
    expect(ago(125 * 60_000)).toBe("2h 5m ago");
  });
});
