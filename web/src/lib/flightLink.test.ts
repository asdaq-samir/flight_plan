import { describe, expect, it } from "vitest";
import { picksOf, planHrefOf } from "./flightLink";

const flight = { departureIdent: "C81", destinationIdent: "KDLH", stops: ["KMSN"], cruiseAltitudeFt: 5500, altitudes: "VPBNG:4500" };

describe("a flight's picks", () => {
  it("are the address's own keys alone", () => {
    const address = new URLSearchParams("dep=C81&dest=KDLH&pattern=KMSN:18&holds=KMSN:180:L:1M:2T&class_b=0&view=briefing&altitudes=VPBNG:4500");
    expect(new URLSearchParams(picksOf(address)).toString()).toBe("pattern=KMSN%3A18&holds=KMSN%3A180%3AL%3A1M%3A2T&class_b=0");
    expect(picksOf(address, ["altitudes"])).toContain("altitudes=VPBNG%3A4500");
  });

  it("open a saved flight again as it was planned, its departure while still ahead", () => {
    const now = Date.parse("2026-10-20T12:00:00Z");
    const href = planHrefOf({ ...flight, picks: "altitude_choice=economical&procs=KDLH%3AI09", plannedFor: "2026-10-21T15:00:00Z" }, now);
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("altitude_choice")).toBe("economical");
    expect(params.get("procs")).toBe("KDLH:I09");
    // The plan flown, not its cruise typed as the pilot's own.
    expect(params.has("altitude_ft")).toBe(false);
    expect(params.get("depart")).toBe("2026-10-21T15:00:00Z");
    expect(new URLSearchParams(planHrefOf({ ...flight, plannedFor: "2026-10-19T15:00:00Z" }, now).split("?")[1]).has("depart")).toBe(false);
  });

  it("fly a flight saved before its picks were kept at its altitude, as before", () => {
    expect(new URLSearchParams(planHrefOf(flight).split("?")[1]).get("altitude_ft")).toBe("5500");
  });
});
