import { describe, expect, test } from "vitest";
import { altitudesOf, altitudesParam, identOf, routeNameWithin, routeOf, stopsOf } from "./identSchema";

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

describe("routeNameWithin", () => {
  const within = (letters: number) => (shown: string) => shown.length <= letters;
  test("a name that fits, whole", () => {
    expect(routeNameWithin("C81 → KHIB → JIXAB → KMSN", within(40))).toBe("C81 → KHIB → JIXAB → KMSN");
    expect(routeNameWithin("C81 → KDLH", within(3))).toBe("C81 → KDLH");
    expect(routeNameWithin("C81 local", within(3))).toBe("C81 local");
  });
  test("cut in the middle, the destination kept at the end", () => {
    expect(routeNameWithin("C81 → KHIB → JIXAB → KMSN", within(22))).toBe("C81 → KHIB → … → KMSN");
    expect(routeNameWithin("C81 → KHIB → JIXAB → KMSN", within(16))).toBe("C81 → … → KMSN");
    expect(routeNameWithin("C81 → KHIB → JIXAB → KMSN", within(5))).toBe("C81 → … → KMSN");
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
