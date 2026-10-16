import { afterEach, describe, expect, it, vi } from "vitest";
import { readKept, writeKept } from "./storage";

describe("a value kept in this browser", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is read back as it was kept, and forgotten with null", () => {
    const held = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => held.get(k) ?? null,
      setItem: (k: string, v: string) => void held.set(k, v),
      removeItem: (k: string) => void held.delete(k),
    });
    expect(readKept("k", { none: true })).toEqual({ none: true });
    expect(writeKept("k", { a: 1 })).toBe(true);
    expect(readKept("k", null)).toEqual({ a: 1 });
    expect(writeKept("k", null)).toBe(true);
    expect(readKept("k", "gone")).toBe("gone");
  });

  it("falls back where storage is refused or what is kept is not JSON", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => "{not json",
      setItem: () => { throw new DOMException("full", "QuotaExceededError"); },
      removeItem: () => undefined,
    });
    expect(readKept("k", 7)).toBe(7);
    expect(writeKept("k", { a: 1 })).toBe(false);
  });
});
