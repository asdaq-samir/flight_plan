import { use, useCallback, useContext, useSyncExternalStore } from "react";
import { UNSAFE_DataRouterContext, UNSAFE_LocationContext } from "react-router-dom";

/**
 * One key of the address, the component drawn again only when that key
 * changes. React Router's `useSearchParams` draws every component that
 * calls it again at any change to the address: a tab switched (`tab`)
 * drew the hidden Brief, the kneeboard and the route's procedures again,
 * which read only the runways picked, the fuel stops or the alternate --
 * a sixth of a switch's React time on a phone-speed processor (the 23 Oct
 * profile, 4x throttle). Read from the data router's own state, which
 * says when it changes; outside one, from the location as the router's
 * hook would.
 */
export function useSearchParam(key: string): string | null {
  const router = useContext(UNSAFE_DataRouterContext)?.router;
  const subscribe = useCallback((changed: () => void) => (router ? router.subscribe(changed) : () => {}), [router]);
  const read = () => (router ? new URLSearchParams(router.state.location.search).get(key) : null);
  const now = useSyncExternalStore(subscribe, read, read);
  if (router) return now;
  // Outside a data router (none in the app; a bare component in a test),
  // the location's context, which draws it again at every change.
  return new URLSearchParams(use(UNSAFE_LocationContext).location.search).get(key);
}
