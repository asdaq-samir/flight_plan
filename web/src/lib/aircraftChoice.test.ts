import { describe, expect, it } from "vitest";
import { aircraftKey, N_NUMBER, profileOfRegistered } from "./aircraftChoice";

describe("an airplane picked by its N-number", () => {
  it("is told from other words by its shape (14 CFR 47.15)", () => {
    expect(["N3429J", "N1", "N12345", "N172SP"].every(n => N_NUMBER.test(n))).toBe(true);
    expect(["N0123", "N123456", "C172", "KDLH"].some(n => N_NUMBER.test(n))).toBe(false);
  });

  it("flies on its type's stock profile where there is one, and none for another type", () => {
    expect(profileOfRegistered({ manufacturer: "Cessna", model: "172S" })).toBe("c172");
    expect(profileOfRegistered({ manufacturer: "CESSNA", model: "172" })).toBe("c172");
    expect(profileOfRegistered({ manufacturer: "Piper", model: "PA-28-181" })).toBe("pa28");
    expect(profileOfRegistered({ manufacturer: "Cessna", model: "150G" })).toBeNull();
    expect(profileOfRegistered({ manufacturer: "Piper", model: "PA-28-140" })).toBeNull();
  });

  it("has its own place in the picker beside the stock profile it flies on", () => {
    expect(aircraftKey({ profile: "c172", label: "N12345 · C172", tail: "N12345" })).toBe("tail:N12345");
    expect(aircraftKey({ profile: "c172", label: "C172 · Cessna 172" })).toBe("profile:c172");
    expect(aircraftKey({ profile: "c172", label: "N2 · C172", aircraftId: 7 })).toBe("mine:7");
  });
});
