import { create, type StoreApi, type UseBoundStore } from "zustand";
import { persist, type PersistStorage, type StateStorage } from "zustand/middleware";

/**
 * What the app keeps in this browser (localStorage), through zustand's
 * persist, as its preferences are (lib/preferences). Storage can be refused
 * outright (a private window, site data blocked) or full, and what is
 * there can be from an older build: the reads and writes here never throw,
 * where each of the keepers wrapped its own in a try (the commonality
 * audit's D-22), and own ship's wrote each GPS fix's same few fields.
 */

/** What each key was last written with, so the same is not written again:
 *  own ship's store is set at every GPS fix (lib/map/ownShip). */
const written = new Map<string, string>();
/** The keys whose last write the browser refused. */
const refused = new Set<string>();

/** localStorage for persist's createJSONStorage: quiet where storage is
 *  refused or full, and a key written only when what it holds changes. */
export const browserStorage: StateStorage = {
  getItem: name => {
    try { return localStorage.getItem(name); } catch { return null; }
  },
  setItem: (name, value) => {
    if (written.get(name) === value) return;
    // Remembered before the try: a refused write is not tried again at
    // each fix with the same value.
    written.set(name, value);
    try {
      localStorage.setItem(name, value);
      refused.delete(name);
    } catch {
      refused.add(name);   // not kept: private browsing, storage full
    }
  },
  removeItem: name => {
    written.delete(name);
    refused.delete(name);
    try { localStorage.removeItem(name); } catch { /* nothing kept to remove */ }
  },
};

/** persist's storage for a store of one `value`, kept as that value's JSON
 *  alone, not in persist's { state, version } wrapper: what the keepers
 *  wrote under these keys before they were stores, so nothing a pilot kept
 *  is lost, and a build before this one still reads it. A null forgets it. */
function bareStorage<T>(): PersistStorage<{ value: T }> {
  return {
    getItem: name => {
      const raw = browserStorage.getItem(name) as string | null;
      if (raw === null) return null;
      try {
        return { state: { value: JSON.parse(raw) as T }, version: 0 };
      } catch {
        return null;   // not JSON: kept by something else, read as none
      }
    },
    setItem: (name, kept) => {
      if (kept.state.value === null) browserStorage.removeItem(name);
      else void browserStorage.setItem(name, JSON.stringify(kept.state.value));
    },
    removeItem: name => void browserStorage.removeItem(name),
  };
}

export type KeptStore<T> = UseBoundStore<StoreApi<{ value: T }>>;
const stores = new Map<string, KeptStore<unknown>>();

/** The store of what is kept under `name`, `fallback` where nothing is or
 *  storage cannot be read: made at its first use, read from storage then
 *  (persist reads a synchronous storage at once), and the same store
 *  after. Its `value` set is written; set to null, forgotten. */
export function keptStore<T>(name: string, fallback: T): KeptStore<T> {
  let store = stores.get(name) as KeptStore<T> | undefined;
  if (!store) {
    store = create<{ value: T }>()(persist(() => ({ value: fallback }), { name, storage: bareStorage<T>() }));
    stores.set(name, store as KeptStore<unknown>);
  }
  return store;
}

/** Whether the browser took the last write under `name`: false where it
 *  refused it or was full, for the caller to say so or to keep it for the
 *  page. */
export function wasKept(name: string): boolean {
  return !refused.has(name);
}
