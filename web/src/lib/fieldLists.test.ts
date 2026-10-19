import { describe, expect, it } from "vitest";
import { fieldListParams, fieldListsOf, prunedFieldLists, renamedFieldLists } from "./fieldLists";

const address = new URLSearchParams("pattern=C81:24,KMSN:18,KORD:27&takeoff=KMSN:36&procs=KMSN:I18:MSN,KDLH:I09,KORD:R27&altitudes=VPBNG:4500,KORD:2000");

describe("the flight's field lists", () => {
  it("read and written back as the address has them", () => {
    const lists = fieldListsOf(address);
    expect(lists.pattern.get("KMSN")).toBe("18");
    expect(lists.takeoff.get("KMSN")).toBe("36");
    expect(lists.procs.map(p => p.ident)).toEqual(["KMSN", "KDLH", "KORD"]);
    expect(fieldListParams(lists)).toEqual({
      pattern: "C81:24,KMSN:18,KORD:27", takeoff: "KMSN:36", procs: "KMSN:I18:MSN,KDLH:I09,KORD:R27", altitudes: "VPBNG:4500,KORD:2000",
    });
    expect(fieldListParams(fieldListsOf(new URLSearchParams()))).toEqual({ pattern: null, takeoff: null, procs: null, altitudes: null });
  });

  it("drop what the route no longer has, matching ICAO and FAA idents", () => {
    // KORD taken off the route; MSN typed for KMSN.
    const kept = prunedFieldLists(fieldListsOf(address), { dep: "C81", stops: ["MSN", "VPBNG"], dest: "KDLH" });
    expect([...kept.pattern.keys()]).toEqual(["C81", "KMSN"]);
    expect([...kept.takeoff.keys()]).toEqual(["KMSN"]);
    expect(kept.procs.map(p => p.ident)).toEqual(["KMSN", "KDLH"]);
    expect(kept.altitudes).toEqual({ VPBNG: 4500 });
  });

  it("keep an approach only where the route lands, a departure only where it leaves, a stop's runway out only at a stop", () => {
    // KMSN now the departure: its approach and its stop runway go.
    const kinds = { I18: "approach", I09: "approach", R27: "approach" } as const;
    const kept = prunedFieldLists(fieldListsOf(address), { dep: "KMSN", stops: [], dest: "KDLH" }, p => kinds[p.id as keyof typeof kinds]);
    expect(kept.procs.map(p => p.ident)).toEqual(["KDLH"]);
    expect(kept.takeoff.size).toBe(0);
  });

  it("rename a field in all four", () => {
    const renamed = renamedFieldLists(fieldListsOf(new URLSearchParams("pattern=ORD:27&procs=ORD:R27&altitudes=ORD:2000")), "ORD", "KORD");
    expect(fieldListParams(renamed)).toEqual({ pattern: "KORD:27", takeoff: null, procs: "KORD:R27", altitudes: "KORD:2000" });
  });
});
