import { useEffect } from "react";
import { routeSearch, useDevMode } from "../hooks/use-dev-mode";
import { useConsoleOpen } from "./mapChrome";

/** Dev mode's refusal: someone it is not for, on the dev page, is taken
 *  to the map, with the console put away (it stays out across a change
 *  of page otherwise: useConsoleOpen). Mounted with the page, not with
 *  the console, which is only in the page while it is out. */
export default function DevGuard() {
  const { refused, navigate, search } = useDevMode();
  useEffect(() => {
    if (!refused) return;
    useConsoleOpen.getState().setOpen(false);
    void navigate(`/plan${routeSearch(search)}`, { replace: true });
  }, [refused, navigate, search]);
  return null;
}
