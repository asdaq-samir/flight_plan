import { describe, expect, it } from "vitest";
import type { Leg } from "../../lib/api/types";
import type { NavLogRow } from "../plan/components/navlog/rows";
import { flownAlong, initialsOf } from "./stripData";

/** A leg of the planner's with the three figures the sum reads. */
const leg = (distance_nm: number, ete_min: number, fuel_gal: number) => ({ distance_nm, ete_min, fuel_gal }) as unknown as Leg;

/** C81 → a checkpoint → KJVL (a stop) → KDLH: the departure, a
 *  checkpoint with its top of climb on the way, the stop, the
 *  destination, each row's leg the planner's. */
const ROWS = [
  { kind: "departure", key: "C81", airport: { ident: "C81", kind: "airport" }, minutesFlown: 0 },
  { kind: "toc", key: "toc", leg: leg(30, 20, 3), part: leg(10, 8, 1.5), minutesFlown: 8 },
  { kind: "checkpoint", key: "cp", leg: leg(30, 20, 3), part: leg(20, 12, 1.5), minutesFlown: 20 },
  { kind: "stop", key: "KJVL", airport: { ident: "KJVL", kind: "airport" }, leg: leg(40, 24, 4), minutesFlown: 44, groundMin: 30 },
  { kind: "destination", key: "KDLH", airport: { ident: "KDLH", kind: "airport" }, leg: leg(100, 60, 9), minutesFlown: 104 },
] as unknown as NavLogRow[];

describe("flownAlong", () => {
  it("is nothing before the legs are in, or with no position", () => {
    expect(flownAlong(ROWS, null)).toBeNull();
    expect(flownAlong([ROWS[0]!, { ...ROWS[2]!, leg: undefined, part: undefined } as NavLogRow], { leg: 0, along: 0.5 })).toBeNull();
  });

  it("sums the legs behind the airplane whole, and the one under it by distance", () => {
    // Half way along the first ribbon leg (30 nm): all of the top of
    // climb's 10 nm piece and 5 of the checkpoint's 20.
    const half = flownAlong(ROWS, { leg: 0, along: 0.5 })!;
    expect(half.burntGal).toBeCloseTo(1.5 + 1.5 * 0.25, 5);
    expect(half.leftNm).toBeCloseTo(170 - 15, 5);
    expect(half.leftMin).toBeCloseTo(104 - (8 + 12 * 0.25), 5);
    expect(half.hop).toBe(0);
  });

  it("starts the fuel burnt again after a landing, on the next hop", () => {
    // A quarter of the way from KJVL to KDLH: the first hop's fuel is
    // behind it, the tanks filled at KJVL.
    const on = flownAlong(ROWS, { leg: 2, along: 0.25 })!;
    expect(on.hop).toBe(1);
    expect(on.burntGal).toBeCloseTo(9 * 0.25, 5);
    expect(on.leftNm).toBeCloseTo(75, 5);
  });

  it("has nothing left at the destination", () => {
    const there = flownAlong(ROWS, { leg: 2, along: 1 })!;
    expect(there.leftNm).toBe(0);
    expect(there.leftMin).toBe(0);
    expect(there.burntGal).toBeCloseTo(9, 5);
  });
});

describe("initialsOf", () => {
  it("takes the first letters of a name, or the address's first", () => {
    expect(initialsOf({ displayName: "Asdaq Samir" })).toBe("AS");
    expect(initialsOf({ displayName: "Amelia" })).toBe("AM");
    expect(initialsOf({ displayName: "pilot@example.com", email: "pilot@example.com" })).toBe("P");
    expect(initialsOf(null)).toBe("");
  });
});
