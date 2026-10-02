import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "./api/client";

/** 200ms, not on every keystroke -- a lookup this app already treats
 *  as cheap server-side (an in-memory prefix filter) still isn't worth
 *  a request per character while someone's still mid-word. */
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
 * waypoints too. The rows answer the typed text a debounce and a
 * request behind it, the last answer staying up while the next loads:
 * `answered` says whether they are the answer to what is in the box now,
 * which is when Enter may take the first of them.
 */
export function useAirportSearch(text: string, enabled = true, fixes = false) {
  const typed = text.trim();
  const q = useDebounced(typed, 200);
  const { data, isPlaceholderData } = useQuery({
    queryKey: ["airportSearch", q, fixes],
    queryFn: () => api.airportSearch(q, fixes),
    enabled: enabled && q.length > 0,
    placeholderData: keepPreviousData,
  });
  return { typed, rows: typed && q ? (data ?? []) : [], answered: q === typed && !isPlaceholderData };
}
