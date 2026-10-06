import { describe, expect, test } from "vitest";
import { identOf, routeOf, stopsOf } from "./identSchema";

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
