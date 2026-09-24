import { describe, expect, test } from "vitest";
import { routeOf } from "./identSchema";

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
