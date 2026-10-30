import { describe, expect, it } from "vitest";
import { airportBox, ownShipBox, overlaps, vorTagSide } from "./declutter";

describe("the VORs' idents kept off the airports' marks and own ship", () => {
  it("counts an airport's ident to its right as part of its mark", () => {
    const kpwk = airportBox({ x: 100, y: 100 }, "KPWK");
    expect(overlaps(kpwk, { x0: 130, y0: 95, x1: 140, y1: 105 })).toBe(true);
    expect(overlaps(kpwk, { x0: 80, y0: 95, x1: 86, y1: 105 })).toBe(false);
  });

  it("flips a VOR's tag to the hexagon's left off an airport or own ship, and hides it when both sides are", () => {
    const vor = { x: 0, y: 0 };
    expect(vorTagSide(vor, "DPA", [])).toBe("right");
    const kdpa = airportBox({ x: 30, y: 4 }, "KDPA");
    expect(vorTagSide(vor, "DPA", [kdpa])).toBe("left");
    expect(vorTagSide(vor, "OBK", [ownShipBox({ x: 20, y: 0 })])).toBe("left");
    expect(vorTagSide(vor, "OBK", [ownShipBox({ x: 0, y: 0 })])).toBe("none");
    expect(vorTagSide(vor, "DPA", [kdpa, airportBox({ x: -60, y: 0 }, "KXYZ")])).toBe("none");
  });
});
