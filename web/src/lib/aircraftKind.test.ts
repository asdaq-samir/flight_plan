import { describe, expect, it } from "vitest";
import { aircraftKind, keptKind } from "./aircraftKind";

describe("an airplane's shape", () => {
  it("is the registry's type first", () => {
    expect(aircraftKind({ type: "C172", faa: { aircraft_type: "Rotorcraft", engines: 1, engine_type: "Turbo-shaft", manufacturer: null, model: null } })).toBe("helicopter");
    expect(aircraftKind({ faa: { aircraft_type: "Glider", engines: 0, engine_type: "None", manufacturer: "SCHLEICHER", model: "ASK 21" } })).toBe("glider");
    expect(aircraftKind({ faa: { aircraft_type: "Balloon", engines: 0, engine_type: "None", manufacturer: null, model: null } })).toBe("balloon");
  });

  it("is the transponder's category where it says", () => {
    expect(aircraftKind({ category: "A7" })).toBe("helicopter");
    expect(aircraftKind({ category: "B1" })).toBe("glider");
    expect(aircraftKind({ category: "B2" })).toBe("balloon");
    expect(aircraftKind({ type: "B738", category: "A3" })).toBe("jet");
  });

  it("is a jet by designator or by its engine", () => {
    expect(aircraftKind({ type: "C25A", category: "A2" })).toBe("jet");
    expect(aircraftKind({ faa: { aircraft_type: "Fixed wing multi engine", engines: 2, engine_type: "Turbo-fan", manufacturer: "CESSNA", model: "525" } })).toBe("jet");
  });

  it("is a twin by designator or by the engines counted", () => {
    expect(aircraftKind({ type: "PA44", category: "A1" })).toBe("twin");
    expect(aircraftKind({ faa: { aircraft_type: "Fixed wing multi engine", engines: 2, engine_type: "Reciprocating", manufacturer: "BEECH", model: "58" } })).toBe("twin");
  });

  it("is a single's wing by model, high where not known", () => {
    expect(aircraftKind({ type: "C172" })).toBe("high");
    expect(aircraftKind({ type: "P28A" })).toBe("low");
    expect(aircraftKind({ type: "SR22" })).toBe("low");
    expect(aircraftKind({ faa: { aircraft_type: "Fixed wing single engine", engines: 1, engine_type: "Reciprocating", manufacturer: "PIPER", model: "PA-28-181" } })).toBe("low");
    expect(aircraftKind({ faa: { aircraft_type: "Fixed wing single engine", engines: 1, engine_type: "Reciprocating", manufacturer: "PIPER", model: "PA-18-150" } })).toBe("high");
    expect(aircraftKind({ faa: { aircraft_type: "Fixed wing single engine", engines: 1, engine_type: "Reciprocating", manufacturer: "CESSNA", model: "182T" } })).toBe("high");
    expect(aircraftKind({ type: "ZZZZ" })).toBe("high");
    expect(aircraftKind({})).toBe("high");
  });

  it("is the kept one's own, else its designator's", () => {
    expect(keptKind({ type: "C172", kind: "low" })).toBe("low");
    expect(keptKind({ type: "BE58" })).toBe("twin");
  });
});
