/**
 * The app's keys in the browser's storage were "vfr." and are "wingtip."
 * (the owner, 2026-11-06: the app plans VFR and IFR flights, and is named
 * Wingtip). Each kept "vfr." key is moved to its "wingtip." name before
 * anything reads one, so a pilot's preferences, own ship, tips seen and
 * the rest come with them: imported first by main.tsx, as the stores read
 * their key when their module is first evaluated. A "wingtip." key already
 * there is the newer and wins; the old one goes either way.
 */
const OLD = "vfr.";
const NEW = "wingtip.";

export function renameKeys(storage: Storage): number {
  const old: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(OLD)) old.push(key);
  }
  for (const key of old) {
    const value = storage.getItem(key);
    const renamed = NEW + key.slice(OLD.length);
    if (value !== null && storage.getItem(renamed) === null) storage.setItem(renamed, value);
    storage.removeItem(key);
  }
  return old.length;
}

for (const area of ["localStorage", "sessionStorage"] as const) {
  try {
    const storage = globalThis[area];
    if (storage) renameKeys(storage);
  } catch {
    // Storage refused (a private window, blocked site data): nothing kept to move.
  }
}
