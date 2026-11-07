import { describe, expect, it } from "vitest";
import type { DataCycle } from "./api/types";
import { callEngine } from "./engine/engine";
import { cycleWarning, dataWarning, dayWords, outOfDate } from "./dataCycles";
import fixture from "./fixtures/dataCycles.json";

const cycle = (over: Partial<DataCycle>): DataCycle => ({
  key: "charts", name: "Charts", kind: "chart", edition: "2026-10-29", effective: "2026-10-29", expires: "2026-12-24",
  current: "2026-10-29", state: "in_force", behind: 0, ...over,
});

// NASR of 1 Oct 2026 on 6 Nov 2026: the next took effect 29 Oct (the FAA's
// NASR subscription page), so it is one cycle behind.
const nasr = cycle({ key: "nasr", name: "Airports, frequencies and navaids", kind: "airac", edition: "2026-10-01",
  effective: "2026-10-01", expires: "2026-10-29", state: "expired", behind: 1 });

describe("FAA data past its cycle, in words", () => {
  it("says nothing while every edition is in force", () => {
    expect(dataWarning([cycle({})])).toBeNull();
    expect(dataWarning(undefined)).toBeNull();
    expect(cycleWarning(cycle({}))).toBeNull();
    expect(cycleWarning(cycle({ state: "not_yet" }))).toBeNull();
  });

  it("says since when a data set is out of date, and how far behind", () => {
    expect(cycleWarning(nasr)).toBe("Out of date since 29 Oct 2026");
    expect(cycleWarning({ ...nasr, edition: "2026-09-03", expires: "2026-10-01", behind: 2 }))
      .toBe("Out of date since 1 Oct 2026, 2 editions behind");
    expect(dayWords("2026-10-29")).toBe("29 Oct 2026");
  });

  it("names every data set out of date in one line for the Brief", () => {
    expect(dataWarning([nasr, cycle({})])).toBe("FAA data out of date: airports and frequencies");
    const stale = [nasr, cycle({ state: "expired", behind: 1 }), cycle({ key: "cifp", name: "Procedures", kind: "airac", state: "expired" })];
    expect(outOfDate(stale)).toHaveLength(3);
    expect(dataWarning(stale)).toBe("FAA data out of date: airports and frequencies, charts and procedures");
  });

  it("the engine's rule is the shared fixture's, asked from the web", () => {
    for (const c of fixture.cases) {
      const got = callEngine("data_cycle", { kind: c.kind as "airac" | "chart" | "dof", effective: c.effective, on: c.on });
      expect({ state: got.state, expires: got.expires, current: got.current, current_ident: got.current_ident, next: got.next, behind: got.behind },
        c.why).toEqual(c.expected);
    }
  });
});
