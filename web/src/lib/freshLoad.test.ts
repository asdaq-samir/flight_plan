import { describe, expect, test } from "vitest";
import { startingAddress } from "./freshLoad";

const at = (search: string, hash = "", pathname = "/app/plan") => ({ pathname, search, hash });
const NOW = 1_000_000;

describe("a fresh load starts clean", () => {
  test("a reload forgets the route, and keeps a sign-in's fragment", () => {
    expect(startingAddress(at("?dep=C81&dest=KDLH&view=briefing"), "reload", null, NOW)).toBe("/app/plan");
    expect(startingAddress(at("?dep=C81&dest=KDLH", "#signin=abc"), "reload", null, NOW)).toBe("/app/plan#signin=abc");
  });

  test("a link, Back, and the planner with nothing to forget land where they say", () => {
    expect(startingAddress(at("?dep=C81&dest=KDLH"), "navigate", null, NOW)).toBeNull();
    expect(startingAddress(at("?dep=C81&dest=KDLH"), "back_forward", null, NOW)).toBeNull();
    expect(startingAddress(at("?dep=C81&dest=KDLH"), undefined, null, NOW)).toBeNull();
    expect(startingAddress(at(""), "reload", null, NOW)).toBeNull();
  });

  test("the developer's page keeps its route", () => {
    expect(startingAddress(at("?dep=C81&dest=KDLH", "", "/app/dev"), "reload", null, NOW)).toBeNull();
  });

  test("the app's own reload for a new build keeps the route, for half a minute", () => {
    expect(startingAddress(at("?dep=C81&dest=KDLH"), "reload", NOW - 2_000, NOW)).toBeNull();
    expect(startingAddress(at("?dep=C81&dest=KDLH"), "reload", NOW - 60_000, NOW)).toBe("/app/plan");
  });
});
