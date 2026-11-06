import { describe, expect, test } from "vitest";
import { renameKeys } from "./storageRename";

/** A Storage over a Map, as the browser's behaves. */
function fakeStorage(entries: Record<string, string>): Storage {
  const map = new Map(Object.entries(entries));
  return {
    get length() { return map.size; },
    key: i => [...map.keys()][i] ?? null,
    getItem: k => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: k => { map.delete(k); },
    clear: () => map.clear(),
  };
}

describe("the browser's keys move from vfr. to wingtip.", () => {
  test("each kept key comes across, and the old one goes", () => {
    const storage = fakeStorage({ "vfr.preferences": '{"state":{"alerts":false}}', "vfr.ownship": "{}", "other.key": "1" });
    expect(renameKeys(storage)).toBe(2);
    expect(storage.getItem("wingtip.preferences")).toBe('{"state":{"alerts":false}}');
    expect(storage.getItem("wingtip.ownship")).toBe("{}");
    expect(storage.getItem("vfr.preferences")).toBeNull();
    expect(storage.getItem("other.key")).toBe("1");
  });

  test("a wingtip. key already there is the newer, and is kept", () => {
    const storage = fakeStorage({ "vfr.tips": "old", "wingtip.tips": "new" });
    renameKeys(storage);
    expect(storage.getItem("wingtip.tips")).toBe("new");
    expect(storage.getItem("vfr.tips")).toBeNull();
  });

  test("a second run has nothing to move", () => {
    const storage = fakeStorage({ "vfr.tv": "webos" });
    renameKeys(storage);
    expect(renameKeys(storage)).toBe(0);
    expect(storage.getItem("wingtip.tv")).toBe("webos");
  });
});
