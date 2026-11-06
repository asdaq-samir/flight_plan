import { describe, expect, it } from "vitest";
import { clampHeight, follow, restingAt, settleSeconds, sheetTakes, speedAt, type Box, type Detents, type Track } from "./engine";

const detents: Detents = { peek: 62, half: 376, full: 820 };

describe("clampHeight", () => {
  it("holds a drag between the lowest and the highest detent", () => {
    expect(clampHeight(detents, 10)).toBe(62);
    expect(clampHeight(detents, 200)).toBe(200);
    expect(clampHeight(detents, 900)).toBe(820);
  });
});

describe("restingAt", () => {
  it("lets a still finger go to the nearest detent", () => {
    expect(restingAt(detents, 100, 0)).toBe("peek");
    expect(restingAt(detents, 300, 0)).toBe("half");
    expect(restingAt(detents, 700, 0)).toBe("full");
  });
  it("reads a throw as where the finger would be a fifth of a second on", () => {
    // Let go at 150, nearer the pill, but thrown up at 1.5 pt/ms: 450 in
    // 200 ms, past half way to half.
    expect(restingAt(detents, 150, 1.5)).toBe("half");
    // Let go at 300, nearer half, thrown down.
    expect(restingAt(detents, 300, -1.5)).toBe("peek");
  });
  it("goes one size a throw: never the pill straight to full, nor full straight to the pill", () => {
    // The owner's notice: "The pill should not go straight to full".
    expect(restingAt(detents, 150, 5)).toBe("half");
    expect(restingAt(detents, 700, -5)).toBe("half");
  });
  it("goes on up past half when the finger itself took it past half", () => {
    expect(restingAt(detents, 400, 2)).toBe("full");
    expect(restingAt(detents, 400, 0)).toBe("half");
  });
  it("lets go on a detent to that detent or the next, by the throw", () => {
    expect(restingAt(detents, 376, 0)).toBe("half");
    expect(restingAt(detents, 376, 3)).toBe("full");
    expect(restingAt(detents, 376, -3)).toBe("peek");
  });
});

describe("settleSeconds", () => {
  it("takes the owner's 0.3 s over the pill-to-half distance, clamped either side", () => {
    expect(settleSeconds(273)).toBe(0.3);
    expect(settleSeconds(20)).toBe(0.22);
    expect(settleSeconds(900)).toBe(0.35);
    expect(settleSeconds(-273)).toBe(0.3);
  });
});

describe("speedAt", () => {
  it("reads the speed over the last window of moves", () => {
    const track: Track = [];
    for (let t = 0; t <= 100; t += 20) follow(track, 500 - t * 2, t);
    expect(speedAt(track, 100)).toBeCloseTo(-2, 5);
  });
  it("is nothing once the finger has held still past the window", () => {
    const track: Track = [];
    for (let t = 0; t <= 100; t += 20) follow(track, 500 - t * 2, t);
    expect(speedAt(track, 100 + 101)).toBe(0);
  });
  it("keeps only the last window and one before it", () => {
    const track: Track = [];
    for (let t = 0; t <= 1000; t += 10) follow(track, t, t);
    expect(track.length).toBeLessThan(14);
    expect(track[0]!.t).toBeLessThanOrEqual(900);
  });
});

describe("sheetTakes", () => {
  const body: Box = { isBody: true, scroller: true, scrolls: false, atStart: true, atEnd: true };
  it("takes a drag toward opening while the sheet is not all the way out", () => {
    expect(sheetTakes([body], -30, true, true)).toBe(true);
    expect(sheetTakes([body], -30, true, false)).toBe(false);
    // From the top of the screen, opening is a drag down.
    expect(sheetTakes([body], 30, false, true)).toBe(true);
  });
  it("toward closing, lets scrolled content scroll back to its start first", () => {
    const scrolled: Box = { scroller: true, scrolls: true, atStart: false, atEnd: false };
    expect(sheetTakes([scrolled, body], 30, true, true)).toBe(false);
    const atTop: Box = { scroller: true, scrolls: true, atStart: true, atEnd: false };
    expect(sheetTakes([atTop, body], 30, true, true)).toBe(true);
    // From the top of the screen, closing is a drag up, from the content's end.
    expect(sheetTakes([scrolled, body], -30, false, true)).toBe(false);
    expect(sheetTakes([{ ...scrolled, atEnd: true }, body], -30, false, true)).toBe(true);
  });
  it("leaves a text area, a slider and a box with gestures of its own their finger", () => {
    expect(sheetTakes([{ keeps: true }, body], -30, true, true)).toBe(false);
    expect(sheetTakes([{ keeps: true }, body], 30, true, true)).toBe(false);
  });
  it("lets a box marked to scroll first scroll while it can, either way", () => {
    const box: Box = { scrollFirst: true, scrolls: true, atStart: true, atEnd: false };
    expect(sheetTakes([box, body], -30, true, true)).toBe(false);
    expect(sheetTakes([box, body], 30, true, true)).toBe(true);
    expect(sheetTakes([{ ...box, atStart: false, atEnd: true }, body], -30, true, true)).toBe(true);
    expect(sheetTakes([{ ...box, atStart: false, atEnd: true }, body], 30, true, true)).toBe(false);
    // Short of a line to scroll, it is no box to scroll first.
    expect(sheetTakes([{ ...box, scrolls: false }, body], -30, true, true)).toBe(true);
  });
});
