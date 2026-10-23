import { describe, expect, test } from "vitest";
import { altitudesOf, altitudesParam, departureOf, frdIdent, frdOf, groundOf, identOf, nameOwnPoints, placeOfPoint, pointName, positionIdent, routeOf, stopOf, stopsOf, withoutAltitude } from "./identSchema";

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

test("a stop's time on the ground reads as whole minutes up to a day, none too, and writes back the same", () => {
  expect(groundOf("KJVL:45,KMSN:0,KDSM:2000,KRYV:soon,KUES:")).toEqual({ KJVL: 45, KMSN: 0 });
  expect(altitudesParam(groundOf("KJVL:45"))).toBe("KJVL:45");
  expect(groundOf(null)).toEqual({});
});

describe("the pilot's own point off a fix", () => {
  test("is a stop, written as ForeFlight takes it or packed as a flight plan writes it", () => {
    expect(stopOf("vpbng/090/30")).toBe("VPBNG/090/30");
    expect(stopOf("DLH090030")).toBe("DLH090030");
    expect(stopOf("VPBNG/090/4.5")).toBe("VPBNG/090/4.5");
    expect(stopOf("VPBNG/90/30")).toBe("");
    expect(frdOf("VPBNG/090/30")).toEqual({ base: "VPBNG", course: 90, distanceNm: 30 });
    expect(frdOf("DLH090030")).toEqual({ base: "DLH", course: 90, distanceNm: 30 });
    expect(frdOf("VPBNG")).toBeNull();
    expect(frdIdent("vpbng", 360, 12.25)).toBe("VPBNG/000/12.3");
  });
});

describe("the route's points as named", () => {
  test("a present position is POS0, the pilot's own points POS1 on in the route's order, the rest by their idents", () => {
    nameOwnPoints(["KJVL", "DLH/090/30", "VPBNG/180/5", "DLH/090/30"]);
    expect(pointName("@42.2333,-87.9883")).toBe("POS0");
    expect(pointName("DLH/090/30")).toBe("POS1");
    expect(pointName("VPBNG/180/5")).toBe("POS2");
    expect(pointName("KJVL")).toBe("KJVL");
    // Taken out of the route: named by itself again, the next one up.
    nameOwnPoints(["VPBNG/180/5"]);
    expect(pointName("VPBNG/180/5")).toBe("POS1");
    expect(pointName("DLH/090/30")).toBe("DLH/090/30");
  });

  test("told after the flight, a present position by its coordinates", () => {
    expect(placeOfPoint("@42.2333,-87.9883")).toMatch(/^N42°14\.0′ W087°59\.3′$/);
    expect(placeOfPoint("KDLH")).toBe("KDLH");
  });
});
