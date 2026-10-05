import { describe, expect, test } from "vitest";
import { answered, DECKS, dueCards, INTERVAL_DAYS, nextDue } from "./drills";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-05T12:00:00Z");

describe("the drills", () => {
  test("every light signal on the ground and in flight, as 91.125 has them", () => {
    const deck = DECKS["light-gun"];
    expect(deck.cards).toHaveLength(12);
    expect(deck.cards.find(c => c.id === "steady-red-flight")!.answer).toBe("Give way to other aircraft and continue circling");
    expect(deck.cards.find(c => c.id === "flashing-white-flight")!.answer).toBe("Not applicable");
    expect(deck.cards.find(c => c.id === "alternating-surface")!.light).toEqual({ colors: ["red", "green"], flashing: true });
    expect(DECKS["vfr-minimums"].cards.map(c => c.id)).toContain("g-low-night");
  });

  test("a card known goes up a box and away; a card missed comes back at once", () => {
    const deck = DECKS["vfr-minimums"];
    let progress = {};
    expect(dueCards(deck, progress, NOW)).toHaveLength(deck.cards.length);
    progress = answered(progress, "b", true, NOW);
    expect(progress).toEqual({ b: { box: 2, due: NOW + INTERVAL_DAYS[1] * DAY } });
    expect(dueCards(deck, progress, NOW).map(c => c.id)).not.toContain("b");
    progress = answered(progress, "c", false, NOW);
    expect(dueCards(deck, progress, NOW).map(c => c.id)).toContain("c");
    // Up the boxes no further than the last, and back to the first on a miss.
    for (let i = 0; i < 8; i++) progress = answered(progress, "b", true, NOW);
    expect((progress as Record<string, { box: number }>).b!.box).toBe(INTERVAL_DAYS.length);
    progress = answered(progress, "b", false, NOW);
    expect((progress as Record<string, { box: number }>).b!.box).toBe(1);
  });

  test("cards never seen come before a card missed, and the next day is known", () => {
    const deck = DECKS["light-gun"];
    let progress = answered({}, "steady-green-surface", false, NOW);
    expect(dueCards(deck, progress, NOW)[0]!.id).not.toBe("steady-green-surface");
    progress = Object.fromEntries(deck.cards.map(c => [c.id, { box: 2, due: NOW + DAY }]));
    expect(dueCards(deck, progress, NOW)).toEqual([]);
    expect(nextDue(deck, progress, NOW)).toBe(NOW + DAY);
  });
});
