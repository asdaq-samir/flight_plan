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
    expect(profileOfRegistered({ manufacturer: "Cessna", model: "150G" })).toBe("c150");
    expect(profileOfRegistered({ manufacturer: "Cessna", model: "A152" })).toBe("c152");
    expect(profileOfRegistered({ manufacturer: "Cessna", model: "182T" })).toBe("c182");
    expect(profileOfRegistered({ manufacturer: "Piper", model: "PA-28-140", year: 1971 })).toBe("pa28140");
    expect(profileOfRegistered({ manufacturer: "Piper", model: "PA-28-140", year: 1975 })).toBe("pa28140cruiser");
    // No year: the Cruiser's, the lower ceiling.
    expect(profileOfRegistered({ manufacturer: "Piper", model: "PA-28-140" })).toBe("pa28140cruiser");
    expect(profileOfRegistered({ manufacturer: "Cirrus Design Corp", model: "SR22" })).toBe("sr22");
    expect(profileOfRegistered({ manufacturer: "Diamond Aircraft IND Inc", model: "DA 40 NG" })).toBe("da40ng");
    expect(profileOfRegistered({ manufacturer: "Piper", model: "PA-28-161" })).toBe("pa28161");
    expect(profileOfRegistered({ manufacturer: "Piper", model: "PA-28R-201" })).toBe("pa28r201");
    expect(profileOfRegistered({ manufacturer: "Mooney", model: "M20J" })).toBe("m20j");
    // A model sharing the name but not the figures: none.
    for (const [manufacturer, model] of [["Cessna", "R182"], ["Cessna", "T182T"], ["Piper", "PA-28-180"], ["Cirrus Design Corp", "SR22T"], ["Diamond Aircraft IND Inc", "DA 40"], ["Piper", "PA-28R-201T"], ["Beech", "A36"]]) {
      expect(profileOfRegistered({ manufacturer, model })).toBeNull();
    }
  });

  it("has its own place in the picker beside the stock profile it flies on", () => {
    expect(aircraftKey({ profile: "c172", label: "N12345 · C172", tail: "N12345" })).toBe("tail:N12345");
    expect(aircraftKey({ profile: "c172", label: "C172 · Cessna 172" })).toBe("profile:c172");
    expect(aircraftKey({ profile: "c172", label: "N2 · C172", aircraftId: 7 })).toBe("mine:7");
  });
});
