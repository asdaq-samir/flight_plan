import { createContext } from "react";

/**
 * The way back out to the whole route, for anything drawn inside the
 * map that needs it. `MapShell` provides it; `MapCard` takes it, so
 * that closing a card returns the map to the route it came from on
 * either map, without every card having to be handed a fit of its own.
 *
 * Its own file rather than a second export from `MapShell`, which is
 * what Fast Refresh wants: a module that exports both a component and a
 * context cannot be hot-replaced.
 */
export const FitRoute = createContext<(() => void) | null>(null);
