import { describe, expect, test } from "vitest";
import { openInForeFlight, packPath } from "./foreflightPack";

describe("the route's checkpoints for ForeFlight", () => {
  test("the pack's address carries each checkpoint, a leg's figures empty where the nav log has none", () => {
    const path = packPath("C81", "KDLH", [], [
      { category: "town", lat: 42.3719883, lon: -88.0928421, score: 5, alongNm: 2.94, headingDeg: 321.6, altitudeFt: 4500, minutesFlown: 2.43 },
      { category: "water", lat: 42.977274, lon: -88.611603, score: 3.1834, alongNm: 45.8 },
    ]);
    const url = new URL(path, "https://planner.example");
    expect(url.pathname).toBe("/api/planner/foreflight-pack");
    expect(url.searchParams.get("dep")).toBe("C81");
    expect(url.searchParams.get("stops")).toBeNull();
    expect(url.searchParams.get("cp")).toBe("42.37199,-88.09284,town,5,2.9,322,4500,2.4~42.97727,-88.6116,water,3.18,45.8,,,");
  });

  test("the stops go with it", () => {
    const url = new URL(packPath("C81", "KDLH", ["KRYV", "KEAU"], []), "https://planner.example");
    expect(url.searchParams.get("stops")).toBe("KRYV,KEAU");
  });

  test("ForeFlight's link hands it the whole address", () => {
    const link = new URL(openInForeFlight("https://planner.example/api/planner/foreflight-pack?dep=C81&dest=KDLH&cp=1,2"));
    expect(link.origin + link.pathname).toBe("https://foreflight.com/content");
    expect(link.searchParams.get("downloadURL")).toBe("https://planner.example/api/planner/foreflight-pack?dep=C81&dest=KDLH&cp=1,2");
  });
});
