import { describe, expect, it, vi } from "vitest";

vi.mock("../api/client", () => ({
  api: {
    stopsAlong: vi.fn(async () => ({ pending: 0, fields: [{ ident: "KIOW" }, { ident: "C81" }] })),
    airportPhotos: vi.fn(async (ident: string) => ident === "KIOW"
      ? { aerial_url: "/api/planner/airport-aerial/KIOW.jpg", photo: { url: "/api/planner/airport-photo/KIOW.jpg" } }
      : { aerial_url: `/api/planner/airport-aerial/${ident}.jpg`, photo: null }),
  },
}));

import { routeStopsKept } from "./keepRoute";

describe("a route kept for the air keeps its stops", () => {
  it("asks for the route's own fields and its Stops' fields once each: their services and pictures", async () => {
    const course = {
      departure: { ident: "C81", kind: "airport" }, destination: { ident: "KOMA", kind: "airport" },
      stops: [{ ident: "BAE", kind: "fix" }],
    } as unknown as Parameters<typeof routeStopsKept>[0];
    const urls = await routeStopsKept(course);
    expect(urls).toEqual([
      "/api/planner/airport/C81/services", "/api/planner/airport-aerial/C81.jpg",
      "/api/planner/airport/KOMA/services", "/api/planner/airport-aerial/KOMA.jpg",
      "/api/planner/airport/KIOW/services", "/api/planner/airport-aerial/KIOW.jpg", "/api/planner/airport-photo/KIOW.jpg",
    ]);
  });
});
