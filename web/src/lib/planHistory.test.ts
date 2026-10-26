import { describe, expect, it } from "vitest";
import { describeEdit, LIMIT, observed, planStateOf, redone, restored, SETTLE_MS, started, undone } from "./planHistory";

const route = { dep: "KMSN", stops: "KJVL,KRFD", dest: "KDPA" };

describe("planHistory", () => {
  it("keeps the plan's keys only", () => {
    const params = new URLSearchParams({ ...route, place: "KORD", view: "briefing", procs: "KDPA:R02R" });
    expect(planStateOf(params)).toEqual({ ...route, procs: "KDPA:R02R" });
  });

  it("puts the plan back and leaves the page's own keys", () => {
    const now = new URLSearchParams({ dep: "KORD", place: "KORD", direct: "KRFD" });
    const back = restored(now, route);
    expect(Object.fromEntries(back)).toEqual({ ...route, place: "KORD" });
  });

  it("takes a cleared route back, and gives it again", () => {
    let h = started(route, 0);
    const cleared = observed(h, {}, 10_000);
    expect(cleared.note).toBe("Route cleared");
    h = cleared.history;
    const back = undone(h, 11_000)!;
    expect(back.now).toEqual(route);
    expect(undone(back, 11_100)).toBeNull();
    const again = redone(back, 12_000)!;
    expect(again.now).toEqual({});
    expect(redone(again, 12_100)).toBeNull();
  });

  it("folds the page's own settling into the pilot's change", () => {
    let h = started({}, 0);
    h = observed(h, { dep: "ORD", dest: "KDPA" }, 5_000).history;
    // The card's answer made ORD KORD half a second later.
    const settled = observed(h, { dep: "KORD", dest: "KDPA" }, 5_500);
    expect(settled.note).toBeNull();
    expect(settled.history.past).toEqual([{}]);
    // A load's own settling is not a step either.
    expect(observed(started({ dep: "ORD" }, 0), { dep: "KORD" }, SETTLE_MS - 1).history.past).toEqual([]);
  });

  it("drops what was redone once the pilot changes the plan", () => {
    let h = started(route, 0);
    h = observed(h, { ...route, stops: "KJVL" }, 5_000).history;
    h = undone(h, 6_000)!;
    h = observed(h, { ...route, dest: "KUGN" }, 9_000).history;
    expect(h.future).toEqual([]);
    expect(redone(h, 9_100)).toBeNull();
  });

  it("does not grow without end", () => {
    let h = started({ dep: "A0" }, 0);
    for (let i = 1; i <= LIMIT + 10; i++) h = observed(h, { dep: `A${i}` }, i * 10_000).history;
    expect(h.past).toHaveLength(LIMIT);
  });

  it("says what was taken away", () => {
    expect(describeEdit(route, { ...route, stops: "KJVL" })).toBe("KRFD removed");
    expect(describeEdit(route, { dep: "KMSN", dest: "KDPA" })).toBe("Stops removed");
    expect(describeEdit(route, { dep: "@42.1,-88.2", stops: "KRFD", dest: "KDPA", direct: "KRFD", was: "KMSN|KJVL,KRFD|KDPA" })).toBe("Direct to KRFD");
    expect(describeEdit(route, { dep: "KMSN", dest: "KUGN" })).toBe("Route replaced");
    expect(describeEdit({ ...route, procs: "KDPA:R02R,KMSN:ACKER4" }, { ...route, procs: "KMSN:ACKER4" })).toBe("Procedure removed");
    expect(describeEdit({ ...route, holds: "KJVL:090:R:1M:2T" }, route)).toBe("Hold removed");
    // Adding is not taking away: no bar, the keyboard still undoes it.
    expect(describeEdit(route, { ...route, stops: "KJVL,KRFD,KUES" })).toBeNull();
    expect(describeEdit({ dep: "KMSN" }, { dep: "KMSN", dest: "KDPA" })).toBeNull();
  });
});
