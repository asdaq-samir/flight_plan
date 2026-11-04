import { afterEach, describe, expect, it } from "vitest";
import { FROM_CACHE_HEADER, forgetSaved, noteAnswer, savedWords, useSaved } from "./fromCache";
import { useSystemProblems } from "./problems";

const paths = () => Object.keys(useSaved.getState().saved).sort();

function answer(fetchedAt?: string): Response {
  return new Response("{}", { headers: fetchedAt === undefined ? {} : { [FROM_CACHE_HEADER]: fetchedAt } });
}

afterEach(() => {
  forgetSaved();
});

describe("an answer from the service worker's cache", () => {
  it("is kept for the Status page, with when the network gave it", () => {
    noteAnswer("/api/planner/briefing?dep=KPAO&dest=KSQL", answer("Wed, 04 Nov 2026 15:00:00 GMT"));
    expect(useSaved.getState().saved["/api/planner/briefing"]).toBe(Date.parse("2026-11-04T15:00:00Z"));
  });

  it("is never said on the map: no coverage in the air is not a problem", () => {
    noteAnswer("/api/planner/tfrs", answer("Wed, 04 Nov 2026 15:10:00 GMT"));
    expect(useSystemProblems.getState().problems).toHaveLength(0);
  });

  it("goes once the network answers each address again", () => {
    noteAnswer("/api/planner/tfrs", answer("Wed, 04 Nov 2026 15:10:00 GMT"));
    noteAnswer("/api/planner/class-b", answer("Wed, 04 Nov 2026 15:10:00 GMT"));
    noteAnswer("/api/planner/tfrs", answer());
    expect(paths()).toEqual(["/api/planner/class-b"]);
    noteAnswer("/api/planner/class-b", answer());
    expect(paths()).toEqual([]);
  });

  it("is not cleared by an answer for some other address", () => {
    noteAnswer("/api/planner/tfrs", answer("Wed, 04 Nov 2026 15:10:00 GMT"));
    // The steady caches answer from the cache unmarked every time: they
    // say nothing about the network.
    noteAnswer("/api/planner/chart", answer());
    expect(paths()).toEqual(["/api/planner/tfrs"]);
  });
});

describe("the Status page's words", () => {
  const now = Date.parse("2026-11-04T15:12:00Z");
  it("are none with nothing from the cache", () => {
    expect(savedWords([], now)).toBeNull();
  });
  it("age by the oldest answer", () => {
    expect(savedWords([now - 2 * 60_000, now - 72 * 60_000], now)).toBe("Showing what was saved 1h 12m ago");
  });
  it("say a moment ago under a minute", () => {
    expect(savedWords([now - 20_000], now)).toBe("Showing what was saved a moment ago");
  });
  it("say earlier where the answer carried no date", () => {
    expect(savedWords([Number.NaN], now)).toBe("Showing what was saved earlier");
  });
});
