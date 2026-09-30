import { useEffect } from "react";
import { routeSearch, useDevMode } from "../hooks/use-dev-mode";

/** Dev mode's refusal: someone it is not for, on the dev page, is taken
 *  to the map. Mounted with the page, not with the settings, which are
 *  only in the page while they are open. */
export default function DevGuard() {
  const { refused, navigate, search } = useDevMode();
  useEffect(() => {
    if (refused) void navigate(`/plan${routeSearch(search)}`, { replace: true });
  }, [refused, navigate, search]);
  return null;
}
