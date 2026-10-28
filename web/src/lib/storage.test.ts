import { afterEach, describe, expect, it, vi } from "vitest";
import { browserStorage, keptStore, wasKept } from "./storage";

function heldStorage(held = new Map<string, string>()) {
  const writes: string[] = [];
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => held.get(k) ?? null,
    setItem: (k: string, v: string) => { writes.push(k); held.set(k, v); },
    removeItem: (k: string) => void held.delete(k),
  });
  return { held, writes };
}

describe("a value kept in this browser", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads what the keepers wrote before persist, and writes it in the same shape", () => {
    // A drill deck's progress as lib/drills wrote it: the bare JSON.
    const { held } = heldStorage(new Map([["t.old", JSON.stringify({ "light-1": { box: 2, due: 5 } })]]));
    const store = keptStore<Record<string, { box: number; due: number }>>("t.old", {});
    expect(store.getState().value).toEqual({ "light-1": { box: 2, due: 5 } });
    store.setState({ value: { "light-1": { box: 3, due: 9 } } });
    expect(JSON.parse(held.get("t.old")!)).toEqual({ "light-1": { box: 3, due: 9 } });
    // The same store at the next ask, not a second one.
    expect(keptStore("t.old", {})).toBe(store);
  });

  it("is the fallback where nothing is kept, and forgotten with null", () => {
    const { held } = heldStorage();
    const store = keptStore<{ a: number } | null>("t.new", null);
    expect(store.getState().value).toBeNull();
    store.setState({ value: { a: 1 } });
    expect(held.get("t.new")).toBe('{"a":1}');
    expect(wasKept("t.new")).toBe(true);
    store.setState({ value: null });
    expect(held.has("t.new")).toBe(false);
  });

  it("falls back where what is kept is not JSON, and says when storage refused a write", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => "{not json",
      setItem: () => { throw new DOMException("full", "QuotaExceededError"); },
      removeItem: () => undefined,
    });
    const store = keptStore("t.full", 7);
    expect(store.getState().value).toBe(7);
    store.setState({ value: 8 });
    expect(store.getState().value).toBe(8);
    expect(wasKept("t.full")).toBe(false);
  });

  it("writes a key only when what it holds changes", () => {
    const { writes } = heldStorage();
    browserStorage.setItem("t.fix", "a");
    browserStorage.setItem("t.fix", "a");
    browserStorage.setItem("t.fix", "b");
    expect(writes).toEqual(["t.fix", "t.fix"]);
  });
});
