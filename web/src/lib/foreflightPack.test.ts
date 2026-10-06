import { describe, expect, test } from "vitest";
import { openInForeFlight, packOrigin, packPath } from "./foreflightPack";

describe("the route's checkpoints for ForeFlight", () => {
  test("the pack's address is the route and the pack's name, short as ForeFlight needs it", () => {
    expect(packPath("C81", "KDLH", [])).toBe("/api/planner/foreflight-pack/C81-KDLH/C81-KDLH-checkpoints.zip");
    expect(packPath("C81", "KDLH", ["KRYV", "KEAU"])).toBe("/api/planner/foreflight-pack/C81-KRYV-KEAU-KDLH/C81-KRYV-KEAU-KDLH-checkpoints.zip");
  });

  test("ForeFlight fetches from this origin, but from the plain port beside the local stack's HTTPS one", () => {
    expect(packOrigin(new URL("https://planner.example/app/plan"))).toBe("https://planner.example");
    expect(packOrigin(new URL("https://10.0.0.218:8443/app/plan"))).toBe("http://10.0.0.218:8080");
    expect(packOrigin(new URL("http://localhost:8080/app/plan"))).toBe("http://localhost:8080");
  });

  test("ForeFlight's link hands it the whole address", () => {
    const link = new URL(openInForeFlight("https://planner.example/api/planner/foreflight-pack/abc/C81-KDLH-checkpoints.zip"));
    expect(link.origin + link.pathname).toBe("https://foreflight.com/content");
    expect(link.searchParams.get("downloadURL")).toBe("https://planner.example/api/planner/foreflight-pack/abc/C81-KDLH-checkpoints.zip");
  });
});
