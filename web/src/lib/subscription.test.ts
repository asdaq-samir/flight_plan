import { describe, expect, it } from "vitest";
import type { Subscription } from "./api/types";
import { entitlementOf, mayUse, standing, usesLeft } from "./subscription";

const sub = (over: Partial<Subscription>): Subscription => ({
  state: "FREE", entitled: false, until: null, trialAvailable: true, trialDays: 30, plan: null, store: null,
  uses: [{ feature: "NARRATIVE", used: 3, cap: 60 }, { feature: "ORAL", used: 61, cap: 60 }],
  ...over,
});

describe("the subscription as the page shows it", () => {
  it("is open where nobody can sign in, and waits for who is signed in", () => {
    expect(entitlementOf("OPEN", undefined, undefined)).toEqual({ kind: "open" });
    expect(entitlementOf("SIGN_IN", undefined, undefined)).toEqual({ kind: "loading" });
    expect(entitlementOf("SIGN_IN", false, undefined)).toEqual({ kind: "signed-out" });
    expect(entitlementOf("SIGN_IN", true, undefined)).toEqual({ kind: "loading" });
    // Not read: the server's own check answers each paid call.
    expect(entitlementOf("SIGN_IN", true, undefined, true)).toEqual({ kind: "unknown" });
    expect(mayUse({ kind: "unknown" })).toBe(true);
  });

  it("lets the paid features be asked for only open or entitled", () => {
    const free = entitlementOf("SIGN_IN", true, sub({}));
    const trial = entitlementOf("SIGN_IN", true, sub({ state: "TRIAL", entitled: true, trialAvailable: false }));
    expect(free.kind).toBe("free");
    expect(mayUse(free)).toBe(false);
    expect(mayUse(trial)).toBe(true);
    expect(mayUse({ kind: "open" })).toBe(true);
    expect(mayUse({ kind: "signed-out" })).toBe(false);
  });

  it("counts what is left of the month, never below none, and not for one given it", () => {
    const trial = entitlementOf("SIGN_IN", true, sub({ state: "TRIAL", entitled: true }));
    expect(usesLeft(trial, "NARRATIVE")).toBe("57 of 60 left this month");
    expect(usesLeft(trial, "ORAL")).toBe("0 of 60 left this month");
    expect(usesLeft(trial, "DEBRIEF")).toBeNull();
    expect(usesLeft(entitlementOf("SIGN_IN", true, sub({ state: "COMPED", entitled: true })), "NARRATIVE")).toBeNull();
    expect(usesLeft({ kind: "open" }, "NARRATIVE")).toBeNull();
  });

  it("says what the pilot has, the day first, the year only when it is not this one", () => {
    const now = new Date("2026-10-11T12:00:00Z");
    expect(standing(sub({ state: "TRIAL", until: "2026-11-10T12:00:00Z" }), now)).toBe("Free until 10 November");
    expect(standing(sub({ state: "SUBSCRIBED", until: "2027-10-11T12:00:00Z" }), now)).toBe("Paid until 11 October 2027");
    expect(standing(sub({ state: "COMPED" }), now)).toBe("Included");
    expect(standing(sub({}), now)).toBe("Not started");
    expect(standing(sub({ trialAvailable: false }), now)).toBe("Ended");
  });
});
