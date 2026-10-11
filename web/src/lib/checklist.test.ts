import { describe, expect, it } from "vitest";
import { checklistOf, textOf } from "./checklist";

describe("a checklist written as text", () => {
  it("reads sections and items, each split as a printed checklist sets it", () => {
    const checklist = checklistOf([
      "Preflight inspection -- Complete",
      "",
      "# Before takeoff",
      "Fuel selector -- Both",
      "Mixture ..... Rich",
      "Flight controls\tFree and correct",
      "Doors – Closed and latched",
      "Seat belts",
      "#   Empty section",
    ].join("\n"));
    expect(checklist).toEqual({ sections: [
      { title: "Checklist", items: [{ challenge: "Preflight inspection", response: "Complete" }] },
      { title: "Before takeoff", items: [
        { challenge: "Fuel selector", response: "Both" },
        { challenge: "Mixture", response: "Rich" },
        { challenge: "Flight controls", response: "Free and correct" },
        { challenge: "Doors", response: "Closed and latched" },
        { challenge: "Seat belts", response: null },
      ] },
    ] });
    // Written back, and read again as it was.
    expect(checklistOf(textOf(checklist))).toEqual(checklist);
  });

  it("keeps a hyphenated word whole, and cuts to the webapp's lengths", () => {
    expect(checklistOf("Pitot-static heat -- On").sections[0]!.items[0]).toEqual({ challenge: "Pitot-static heat", response: "On" });
    const long = checklistOf(`# ${"S".repeat(60)}\n${"C".repeat(100)} -- ${"R".repeat(100)}`).sections[0]!;
    expect([long.title.length, long.items[0]!.challenge.length, long.items[0]!.response!.length]).toEqual([40, 80, 80]);
  });
});
