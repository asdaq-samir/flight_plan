import { describe, expect, test } from "vitest";
import { whenGroups } from "./whenGroups";

const route = (at: number) => ({ dep: "C81", dest: "KDLH", stops: [], at });

describe("whenGroups", () => {
  test("Today, This Week, This Month and Earlier, as Maps' Recents head them, empty ones left out", () => {
    const now = new Date(2026, 9, 28, 15).getTime();
    const at = (day: number, hour = 9) => new Date(2026, 9, day, hour).getTime();
    const groups = whenGroups([route(at(28)), route(at(27, 23)), route(at(22)), route(at(21, 23)), route(at(1)), route(new Date(2026, 8, 20).getTime())], now);
    expect(groups.map(g => [g.title, g.routes.length])).toEqual([["Today", 1], ["This Week", 2], ["This Month", 2], ["Earlier", 1]]);
    expect(whenGroups([route(at(3))], now).map(g => g.title)).toEqual(["This Month"]);
  });
});
