/**
 * A fresh load of the planner starts clean, as Maps does when it is
 * opened: no route, no card, the sheet half way up on the search bar,
 * Favorites and Recents (MapPage). The route lives in the address, so a
 * reload kept it -- pulled down to refresh, the phone came back to the
 * last route, never to the search. A link still lands where it says (a
 * route sent from another device, a saved flight, the address typed), as
 * does Back; only a reload forgets.
 *
 * Except the app's own reload, for a new build (main.tsx, registerSW's
 * onNeedReload): the pilot asked for nothing, and the route they had open
 * stays, for half a minute after it is marked.
 */
const KEEP = "wingtip.keepAddress";
const KEEP_MS = 30_000;

/** The address to start from: the one loaded, or the planner's own with
 *  nothing after it but a fragment (an emailed sign-in's), on a reload a
 *  person made. Pure, for the tests. */
export function startingAddress(
  location: { pathname: string; search: string; hash: string },
  navigation: string | undefined,
  keptAt: number | null,
  now: number,
): string | null {
  if (navigation !== "reload" || location.pathname !== "/app/plan" || !location.search) return null;
  if (keptAt !== null && now - keptAt < KEEP_MS) return null;
  return location.pathname + location.hash;
}

/** Before the router reads the address: on a reload, the planner's
 *  address emptied of its route. */
export function startFresh() {
  let keptAt: number | null = null;
  try {
    keptAt = Number(sessionStorage.getItem(KEEP)) || null;
    sessionStorage.removeItem(KEEP);
  } catch {
    // No storage (blocked site data): every reload starts clean.
  }
  const navigation = (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)?.type;
  const address = startingAddress(window.location, navigation, keptAt, Date.now());
  if (address !== null) history.replaceState(history.state, "", address);
}

/** The next load is the app's own reload: what is on screen stays. */
export function keepAddressThroughReload() {
  try {
    sessionStorage.setItem(KEEP, String(Date.now()));
  } catch {
    // No storage: the reload starts clean, as a person's would.
  }
}
