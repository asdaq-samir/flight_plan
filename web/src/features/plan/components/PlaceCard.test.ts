import { afterEach, describe, expect, it, vi } from "vitest";
import { observedLine, windLine } from "../../../lib/metarText";

type Metar = Parameters<typeof windLine>[0];
const metar = (m: Partial<Metar>) => m as Metar;

describe("windLine", () => {
  it("calls no wind calm", () => {
    expect(windLine(metar({ wind_speed_kt: 0, wind_dir_true_deg: 0 }))).toBe("Calm");
    expect(windLine(metar({ wind_speed_kt: null }))).toBe("Calm");
  });

  it("writes the direction as three digits, true", () => {
    expect(windLine(metar({ wind_speed_kt: 10, wind_dir_true_deg: 140 }))).toBe("140° at 10 kt");
    expect(windLine(metar({ wind_speed_kt: 5, wind_dir_true_deg: 90 }))).toBe("090° at 5 kt");
  });

  it("says variable when there is no direction, and adds gusts", () => {
    expect(windLine(metar({ wind_speed_kt: 4, wind_dir_true_deg: null }))).toBe("Variable at 4 kt");
    expect(windLine(metar({ wind_speed_kt: 12, wind_dir_true_deg: 270, wind_gust_kt: 18 }))).toBe("270° at 12 kt, gusts 18");
  });
});

describe("observedLine", () => {
  afterEach(() => vi.useRealTimers());

  const at = (now: string) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
  };

  it("gives the time in Zulu and how long ago", () => {
    at("2026-10-10T13:09:00Z");
    expect(observedLine("2026-10-10T12:55:00Z")).toBe("Observed 1255Z, 14 minutes ago. Wind true, as reported.");
    expect(observedLine("2026-10-10T13:08:00Z")).toContain("1 minute ago");
    expect(observedLine("2026-10-10T13:09:00Z")).toContain("just now");
  });

  it("switches to hours at 90 minutes, and never reads in the future", () => {
    at("2026-10-10T14:30:00Z");
    expect(observedLine("2026-10-10T13:01:00Z")).toContain("89 minutes ago");
    expect(observedLine("2026-10-10T13:00:00Z")).toContain("2 hours ago");
    expect(observedLine("2026-10-10T14:40:00Z")).toContain("just now");
  });

  it("is empty for a date it cannot read", () => {
    expect(observedLine("not a date")).toBe("");
  });
});
