import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { whenBack } from "./queryClient";

/** A page's visibility, as the phone changes it. */
function page(visibilityState: DocumentVisibilityState) {
  const listeners = new Set<() => void>();
  return {
    visibilityState,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    show() {
      this.visibilityState = "visible";
      for (const fn of [...listeners]) fn();
    },
    listening: () => listeners.size,
  };
}

describe("a dropped request asked again", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("is asked a second after, the page in sight", () => {
    const run = vi.fn();
    whenBack(run, page("visible") as unknown as Document);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(run).toHaveBeenCalledOnce();
  });

  it("waits for the page to be in sight again, then is asked once", () => {
    const run = vi.fn();
    const doc = page("hidden");
    whenBack(run, doc as unknown as Document);
    vi.advanceTimersByTime(5000);
    expect(run).not.toHaveBeenCalled();
    doc.show();
    doc.show();
    vi.advanceTimersByTime(1000);
    expect(run).toHaveBeenCalledOnce();
    expect(doc.listening()).toBe(0);
  });
});
