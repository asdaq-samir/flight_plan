/**
 * A value kept in this browser as JSON (localStorage), read and written in
 * one place: storage can be refused outright (a private window, site data
 * blocked) or full, and what is there can be from an older build. Each of
 * the six that kept something wrapped its own read and write in a try for
 * it (the commonality audit's D-22).
 */

/** What is kept under `key`, or `fallback` where nothing is or storage
 *  cannot be read. */
export function readKept<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

/** Keeps `value` under `key`, or forgets it (null): false where storage is
 *  refused or full, for the caller to say so or to keep it for the page. */
export function writeKept(key: string, value: unknown): boolean {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
