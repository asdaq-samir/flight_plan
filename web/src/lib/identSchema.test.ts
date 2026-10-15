import { describe, expect, test } from "vitest";
import { altitudesOf, altitudesParam, departureOf, identOf, positionIdent, routeOf, stopsOf, withoutAltitude } from "./identSchema";

describe("identOf and stopsOf", () => {
  test("an airport's ident trimmed and uppercased, else empty", () => {
    expect(identOf(" kdlh ")).toBe("KDLH");
    expect(identOf("C81")).toBe("C81");
    expect(identOf("KD")).toBe("");
    expect(identOf("KDLH1")).toBe("");
    expect(identOf("K-LH")).toBe("");
    expect(identOf(null)).toBe("");
  });
  test("the stops: airports and fixes of two to five, the rest dropped", () => {
    expect(stopsOf("kdsm, VPBNG ,x,TOOLONG,KR")).toEqual(["KDSM", "VPBNG", "KR"]);
    expect(stopsOf(null)).toEqual([]);
  });
});

describe("routeOf", () => {
  test("two valid idents, normalized", () => {
    expect(routeOf(" c81", "kdlh ")).toEqual({ dep: "C81", dest: "KDLH" });
  });
  test("one airport twice is no route", () => {
    expect(routeOf("C81", "c81")).toBeNull();
  });
  test("a malformed or missing end is no route", () => {
    expect(routeOf("K", "KDLH")).toBeNull();
    expect(routeOf("C81", null)).toBeNull();
    expect(routeOf(undefined, undefined)).toBeNull();
  });
});

describe("altitudesOf", () => {
  test("points' own altitudes by ident, and what is not one left out", () => {
    expect(altitudesOf("vpbng:4500,KMSN:1900")).toEqual({ VPBNG: 4500, KMSN: 1900 });
    expect(altitudesOf("VPBNG:18000,KMSN:0,KDLH:abc,:4500,KRYV")).toEqual({});
    expect(altitudesOf(null)).toEqual({});
  });
  test("back to the address", () => {
    expect(altitudesParam({ VPBNG: 4500, KMSN: 1900 })).toBe("VPBNG:4500,KMSN:1900");
    expect(altitudesParam({})).toBe("");
  });
});


describe("a present position", () => {
  test("is written with the GPS's altitude, to the hundred, where it has one", () => {
    expect(positionIdent({ lat: 42.32461, lon: -88.07412, altitudeFt: 3487 })).toBe("@42.3246,-88.0741,3500");
    expect(positionIdent({ lat: 42.32461, lon: -88.07412, altitudeFt: null })).toBe("@42.3246,-88.0741");
    expect(positionIdent({ lat: 42.32461, lon: -88.07412 })).toBe("@42.3246,-88.0741");
  });
  test("is a departure with its altitude or without", () => {
    expect(departureOf("@42.3246,-88.0741,3500")).toBe("@42.3246,-88.0741,3500");
    expect(departureOf("@42.3246,-88.0741")).toBe("@42.3246,-88.0741");
    expect(departureOf("@42.3246,-88.0741,3500,1")).toBe("");
  });
  test("is saved without the moment's altitude", () => {
    expect(withoutAltitude("@42.3246,-88.0741,3500")).toBe("@42.3246,-88.0741");
    expect(withoutAltitude("KDLH")).toBe("KDLH");
  });
});
