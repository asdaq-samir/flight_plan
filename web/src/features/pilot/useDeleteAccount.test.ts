import { describe, expect, it } from "vitest";
import { forgetThisDevice } from "./useDeleteAccount";

/** The part of Storage forgetThisDevice reads, kept in a Map. */
function fakeStorage(entries: Record<string, string>): Storage {
  const map = new Map(Object.entries(entries));
  return {
    get length() { return map.size; },
    key: i => Array.from(map.keys())[i] ?? null,
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: key => void map.delete(key),
    clear: () => map.clear(),
  };
}

describe("forgetThisDevice", () => {
  it("removes what the app keeps under its two prefixes and nothing else", () => {
    const storage = fakeStorage({ "vfr.prefs": "1", "vfr.track.7": "[]", "wingtip.drills": "2", "other.key": "3" });
    forgetThisDevice(storage);
    expect(Array.from({ length: storage.length }, (_, i) => storage.key(i))).toEqual(["other.key"]);
  });

  it("leaves an empty storage empty", () => {
    const storage = fakeStorage({});
    forgetThisDevice(storage);
    expect(storage.length).toBe(0);
  });
});
