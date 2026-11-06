import { create } from "zustand";
import { ago } from "./clock";

/**
 * Answers the service worker gave from its cache because the network did
 * not, kept for the Status page (StatusPanel): "Showing what was saved
 * 12m ago". Never said on the map: a phone in the air is out of coverage
 * most of the flight, and a line about it over the chart for the whole
 * flight was noise (the owner, 2026-11-04: "we shouldn't show the errors
 * for internet loss specially in no coverage up in the air"). The
 * briefing, the TFRs and the rest are kept for a dropped moment
 * (vite.config.ts, planner-now); the worker marks each one it gives from
 * its cache with this header (markFromCache), holding when the network
 * gave it -- the response's own Date.
 */
export const FROM_CACHE_HEADER = "X-From-Cache";

/** Each address answered from the cache, by its path, to when the
 *  network gave that answer (ms; NaN where the date was missing). By
 *  path, not the whole address: a network answer for the briefing of any
 *  route means the briefing is reaching the network again. */
export const useSaved = create<{ saved: Record<string, number> }>(() => ({ saved: {} }));

/** Every answer from the planner or the webapp, as it arrives: one from
 *  the cache is noted, one from the network clears its path's note. */
export function noteAnswer(url: string, response: Response) {
  const path = pathOf(url);
  const marked = response.headers.get(FROM_CACHE_HEADER);
  const { saved } = useSaved.getState();
  if (marked === null) {
    if (path in saved) {
      const rest = { ...saved };
      delete rest[path];
      useSaved.setState({ saved: rest });
    }
    return;
  }
  // Date.parse of an empty header is NaN: still from the cache, its age
  // unknown.
  useSaved.setState({ saved: { ...saved, [path]: Date.parse(marked) } });
}

function pathOf(url: string): string {
  try {
    return new URL(url, "http://localhost").pathname;
  } catch {
    return url;
  }
}

/** The Status page's line, aged by the oldest answer the page is showing
 *  from the cache: the one the pilot most needs to know about; null when
 *  everything came from the network. */
export function savedWords(fetchedAt: number[], now: number): string | null {
  if (fetchedAt.length === 0) return null;
  const known = fetchedAt.filter(Number.isFinite);
  if (known.length === 0) return "Showing what was saved earlier";
  const since = ago(now - Math.min(...known));
  return `Showing what was saved ${since === "just now" ? "a moment ago" : since}`;
}

/** For tests: nothing noted. */
export function forgetSaved() {
  useSaved.setState({ saved: {} });
}
