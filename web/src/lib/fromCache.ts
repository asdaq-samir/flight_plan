import { ago } from "./clock";
import { clearProblem, raiseProblem } from "./problems";

/**
 * An answer the service worker gave from its cache because the network
 * did not, said on the map: "No connection: showing what was saved 12m
 * ago", one system problem (lib/problems) for every such answer at once,
 * gone when the network answers again. The briefing, the TFRs and the
 * rest are kept for a dropped moment (vite.config.ts, planner-now), and
 * an old one shown as current was why they were once never kept: the
 * page could not tell. The worker marks each one it gives from its
 * cache with this header (markFromCache), holding when the network gave
 * it -- the response's own Date.
 */
export const FROM_CACHE_HEADER = "X-From-Cache";

/** Its line's id, which the Status page reads too. */
export const PROBLEM_ID = "from-cache";

/** Each address answered from the cache, by its path, to when the
 *  network gave that answer (ms; NaN where the date was missing). By
 *  path, not the whole address: a network answer for the briefing of any
 *  route means the briefing is reaching the network again. */
const saved = new Map<string, number>();

/** How "Try again" asks: the query client's, set by lib/queryClient
 *  (which imports the API client, which calls here). */
let askAgain: (() => void) | undefined;
export function onAskAgain(run: () => void) {
  askAgain = run;
}

/** The line's age is said again each minute while it is up: "2m ago"
 *  left on the map for an hour would be its own wrong figure. Stopped
 *  when the line goes. */
let ticking: ReturnType<typeof setInterval> | undefined;

/** Every answer from the planner or the webapp, as it arrives: one from
 *  the cache is noted, one from the network clears its path's note. */
export function noteAnswer(url: string, response: Response) {
  const path = pathOf(url);
  const marked = response.headers.get(FROM_CACHE_HEADER);
  if (marked === null) {
    if (saved.delete(path)) say();
    return;
  }
  // Date.parse of an empty header is NaN: still from the cache, its age
  // unknown.
  saved.set(path, Date.parse(marked));
  say();
}

function pathOf(url: string): string {
  try {
    return new URL(url, "http://localhost").pathname;
  } catch {
    return url;
  }
}

function say() {
  if (saved.size === 0) {
    clearProblem(PROBLEM_ID);
    clearInterval(ticking);
    ticking = undefined;
    return;
  }
  raiseProblem({
    id: PROBLEM_ID,
    title: savedWords([...saved.values()], Date.now()),
    // Everything the page shows asked again: what the network answers
    // clears its note, what the cache answers again notes it again.
    // Cleared first, so a note left by a query no longer shown -- a
    // route since closed -- goes with it.
    retry: askAgain && (() => {
      saved.clear();
      say();
      askAgain?.();
    }),
  });
  ticking ??= setInterval(say, 60_000);
}

/** The line, aged by the oldest answer the page is showing from the
 *  cache: the one the pilot most needs to know about. */
export function savedWords(fetchedAt: number[], now: number): string {
  const known = fetchedAt.filter(Number.isFinite);
  if (known.length === 0) return "No connection: showing what was saved earlier";
  const since = ago(now - Math.min(...known));
  return `No connection: showing what was saved ${since === "just now" ? "a moment ago" : since}`;
}

/** For tests: nothing noted. */
export function forgetSaved() {
  saved.clear();
  say();
}
