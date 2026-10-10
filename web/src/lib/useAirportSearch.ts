import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "./api/client";
import { searchIndex, useAirportIndex } from "./airportIndex";

/** 100ms, not on every keystroke -- a lookup this app already treats
 *  as cheap server-side (an index of idents and words) still isn't worth
 *  a request per character while someone's still mid-word. It was 200,
 *  which with the answer's own time read as the suggestions lagging the
 *  typing. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

/**
 * The airports whose ident or name starts with what is typed -- the
 * route form's pickers (AirportPicker) and the panel's search bar
 * (PanelCapsule) alike -- and, with `fixes`, a stop's: the VFR and GPS
 * waypoints too. The airports from the phone's own copy of the search
 * (lib/airportIndex) once it is in, at each letter, at the pilot's ask:
 * each letter's question waited on the planner, and a second and more
 * while it planned a route (0.2 to 1.5 s, measured 2026-10-09). A stop's
 * waypoints are still the planner's, a debounce and a request behind the
 * typing, the airports shown meanwhile; so are the airports until the
 * copy is in. `answered` says whether the rows are the answer to what is
 * in the box now, which is when Enter may take the first of them.
 */
/** One answer: an airport, or with `fixes` a waypoint (`kind` "fix"). */
export type AirportSearchRow = Awaited<ReturnType<typeof api.airportSearch>>[number];

/** Where the route is, as its ends' "lat,lon;lat,lon", for a stop's
 *  search (PlanWorkspace provides it round the route's box): of an
 *  ident's navaids in two places -- "AA", a beacon in North Dakota and
 *  another in Georgia -- the one the route will fly over is the one named
 *  (the planner's `near`). Empty off a route. */
export const SearchNear = createContext("");

export function useAirportSearch(text: string, enabled = true, fixes = false) {
  const typed = text.trim();
  const q = useDebounced(typed, 100);
  const near = useContext(SearchNear);
  const by = fixes ? near : "";
  const index = useAirportIndex(enabled, typed.length > 0);
  // Once per typed value: the scan covers every row, and the panel
  // re-renders for much besides typing (map moves, weather, sheet drags).
  const local = useMemo(() => (index && typed ? searchIndex(index, typed) : null), [index, typed]);
  const { data, isPlaceholderData, isFetching } = useQuery({
    queryKey: ["airportSearch", q, fixes, by],
    queryFn: () => api.airportSearch(q, fixes, by),
    // Airports alone and the copy in: nothing to ask.
    enabled: enabled && q.length > 0 && (fixes || !index),
    placeholderData: keepPreviousData,
  });
  const asked = q === typed && !isPlaceholderData && !!data;
  if (local && !fixes) return { typed, rows: local, answered: true };
  // A stop's: the planner's answer, the waypoints with the airports, once
  // it answers what is typed; the airports from the copy until then, and
  // after it, when the request has failed or the phone is offline: the
  // query has settled, so Enter may take the first airport shown.
  if (local && !asked) return { typed, rows: local, answered: q === typed && !isFetching };
  return { typed, rows: typed && q ? (data ?? []) : [], answered: q === typed && !isPlaceholderData };
}
