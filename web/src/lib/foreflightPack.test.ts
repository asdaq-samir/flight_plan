import { describe, expect, test } from "vitest";
import { openInForeFlight, packOrigin, packPath } from "./foreflightPack";

describe("the route's checkpoints for ForeFlight", () => {
  /** The query a pack's address carries, read back as the planner reads it. */
  const queryOf = (path: string) => {
    const [, , , , token] = path.split("/");
    return new URLSearchParams(atob(token!.replace(/-/g, "+").replace(/_/g, "/")));
  };

  test("the pack's address ends in its file name and carries each checkpoint, a leg's figures empty where the nav log has none", () => {
    const path = packPath("C81", "KDLH", [], [
      { category: "town", lat: 42.3719883, lon: -88.0928421, score: 5, alongNm: 2.94, headingDeg: 321.6, altitudeFt: 4500, minutesFlown: 2.43 },
      { category: "water", lat: 42.977274, lon: -88.611603, score: 3.1834, alongNm: 45.8 },
    ]);
    // ForeFlight names its download by the end of the address.
    expect(path).toMatch(/^\/api\/planner\/foreflight-pack\/[A-Za-z0-9_-]+\/C81-KDLH-checkpoints\.zip$/);
    const query = queryOf(path);
    expect(query.get("dep")).toBe("C81");
    expect(query.get("stops")).toBe("");
    expect(query.get("cp")).toBe("42.37199,-88.09284,town,5,2.9,322,4500,2.4~42.97727,-88.6116,water,3.18,45.8,,,");
  });

  test("the stops go with it, and into its name", () => {
    const path = packPath("C81", "KDLH", ["KRYV", "KEAU"], []);
    expect(queryOf(path).get("stops")).toBe("KRYV,KEAU");
    expect(path).toMatch(/\/C81-KRYV-KEAU-KDLH-checkpoints\.zip$/);
  });

  test("ForeFlight fetches from this origin, but from the plain port beside the local stack's HTTPS one", () => {
    expect(packOrigin(new URL("https://planner.example/app/plan"))).toBe("https://planner.example");
    expect(packOrigin(new URL("https://10.0.0.218:8443/app/plan"))).toBe("http://10.0.0.218:8080");
    expect(packOrigin(new URL("http://localhost:8080/app/plan"))).toBe("http://localhost:8080");
  });

  test("ForeFlight's link hands it the whole address", () => {
    const link = new URL(openInForeFlight("https://planner.example/api/planner/foreflight-pack?dep=C81&dest=KDLH&cp=1,2"));
    expect(link.origin + link.pathname).toBe("https://foreflight.com/content");
    expect(link.searchParams.get("downloadURL")).toBe("https://planner.example/api/planner/foreflight-pack?dep=C81&dest=KDLH&cp=1,2");
  });
});
