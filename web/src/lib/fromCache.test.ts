import { afterEach, describe, expect, it, vi } from "vitest";
import { FROM_CACHE_HEADER, forgetSaved, noteAnswer, onAskAgain, savedWords } from "./fromCache";
import { useSystemProblems } from "./problems";

const line = () => useSystemProblems.getState().problems.find(p => p.id === "from-cache");

function answer(fetchedAt?: string): Response {
  return new Response("{}", { headers: fetchedAt === undefined ? {} : { [FROM_CACHE_HEADER]: fetchedAt } });
}

afterEach(() => {
  forgetSaved();
  vi.useRealTimers();
});

describe("an answer from the service worker's cache", () => {
  it("is said on the map, with how long ago the network gave it", () => {
    vi.useFakeTimers({ now: Date.parse("2026-11-04T15:12:00Z") });
    noteAnswer("/api/planner/briefing?dep=KPAO&dest=KSQL", answer("Wed, 04 Nov 2026 15:00:00 GMT"));
    expect(line()?.title).toBe("No connection: showing what was saved 12m ago");
  });

  it("is one line for every answer, aged by the oldest", () => {
    vi.useFakeTimers({ now: Date.parse("2026-11-04T15:12:00Z") });
    noteAnswer("/api/planner/tfrs", answer("Wed, 04 Nov 2026 15:10:00 GMT"));
    noteAnswer("/api/planner/briefing", answer("Wed, 04 Nov 2026 14:00:00 GMT"));
    expect(useSystemProblems.getState().problems.filter(p => p.id === "from-cache")).toHaveLength(1);
    expect(line()?.title).toBe("No connection: showing what was saved 1h 12m ago");
  });

  it("goes once the network answers each address again", () => {
    noteAnswer("/api/planner/tfrs", answer("Wed, 04 Nov 2026 15:10:00 GMT"));
    noteAnswer("/api/planner/class-b", answer("Wed, 04 Nov 2026 15:10:00 GMT"));
    noteAnswer("/api/planner/tfrs", answer());
    expect(line()).toBeDefined();
    noteAnswer("/api/planner/class-b", answer());
    expect(line()).toBeUndefined();
  });

  it("is not cleared by an answer for some other address", () => {
    noteAnswer("/api/planner/tfrs", answer("Wed, 04 Nov 2026 15:10:00 GMT"));
    // The steady caches answer from the cache unmarked every time: they
    // say nothing about the network.
    noteAnswer("/api/planner/chart", answer());
    expect(line()).toBeDefined();
  });

  it("is aged again each minute while it is up", () => {
    vi.useFakeTimers({ now: Date.parse("2026-11-04T15:12:00Z") });
    noteAnswer("/api/planner/tfrs", answer("Wed, 04 Nov 2026 15:00:00 GMT"));
    vi.advanceTimersByTime(3 * 60_000);
    expect(line()?.title).toBe("No connection: showing what was saved 15m ago");
  });

  it("asks everything again from its Try again", () => {
    const ask = vi.fn();
    onAskAgain(ask);
    noteAnswer("/api/planner/tfrs", answer("Wed, 04 Nov 2026 15:00:00 GMT"));
    line()?.retry?.();
    expect(ask).toHaveBeenCalledOnce();
    expect(line()).toBeUndefined();
  });
});

describe("the line's words", () => {
  const now = Date.parse("2026-11-04T15:12:00Z");
  it("say a moment ago under a minute", () => {
    expect(savedWords([now - 20_000], now)).toBe("No connection: showing what was saved a moment ago");
  });
  it("say earlier where the answer carried no date", () => {
    expect(savedWords([Number.NaN], now)).toBe("No connection: showing what was saved earlier");
  });
});
