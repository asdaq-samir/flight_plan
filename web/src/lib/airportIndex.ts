import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api/client";
import type { AirportSearchRow } from "./useAirportSearch";

/** One airport of the planner's index (vfr.airports.search_index): the
 *  ident pilots use, its name, town and state, its size rank (0 large to
 *  3 other), where it is, and the idents it is also found by. An index
 *  kept from before it said where (a day's, in the browser's cache) has
 *  the idents straight after the size. */
type Entry = [ident: string, name: string, town: string, state: string, size: number, ...rest: (number | string)[]];

export interface AirportIndex {
  rows: Entry[];
  /** Each row's latitude and longitude; NaN where the index does not say. */
  lat: Float64Array;
  lon: Float64Array;
  /** Each row's name upper-cased, for a name that starts with what is typed. */
  names: string[];
  /** Each row's idents, upper-cased: the one shown and the others. */
  keys: string[][];
  /** Each row's name and town upper-cased, a space before every word, so
   *  a word's start is a space and what is typed. */
  words: string[];
}

/**
 * The index's lookups: each row's idents and its words, upper-cased, and
 * nothing sorted -- a search reads every row (searchIndex). The planner's
 * own sorted lists (_search_index_of), copied here at first, took a third
 * of a second of a phone's main thread to sort as the page opened, its
 * longest task (measured 2026-10-09, CPU 4x); these take a tenth of that,
 * and a search through them some 8 to 13 ms (on this Mac, unthrottled).
 */
export function indexOf(rows: Entry[]): AirportIndex {
  const placed = (row: Entry) => typeof row[5] === "number";
  return {
    rows,
    lat: Float64Array.from(rows, row => (placed(row) ? row[5] as number : NaN)),
    lon: Float64Array.from(rows, row => (placed(row) ? row[6] as number : NaN)),
    names: rows.map(([, name]) => name.toUpperCase()),
    keys: rows.map(row => [row[0].toUpperCase(), ...(row.slice(placed(row) ? 7 : 5) as string[])]),
    words: rows.map(([, name, town]) => ` ${name} ${town}`.toUpperCase()),
  };
}

/** How far a row is from the nearest of `near`, as an order: squared
 *  degrees, the longitude's shrunk by the latitude's cosine. */
function nearness(index: AirportIndex, row: number, near: readonly { lat: number; lon: number }[]): number {
  const lat = index.lat[row]!, lon = index.lon[row]!;
  if (!near.length || Number.isNaN(lat)) return 0;
  let least = Infinity;
  for (const p of near) {
    const d = (lat - p.lat) ** 2 + ((lon - p.lon) * Math.cos((p.lat * Math.PI) / 180)) ** 2;
    if (d < least) least = d;
  }
  return least;
}

/**
 * The airports answering what is typed, as the planner's search_airports
 * answers: the ident typed whole first, then the idents that start with
 * it, then the fields with a word of their name or town that does; the
 * bigger fields first in each, then one whose name starts with it, then
 * the nearest to `near` (the pilot, or the route), then by ident; eight at
 * most. "campbell" is C81, Campbell Airport, at Grayslake for a pilot
 * there, where eight strips named or towned Campbell elsewhere came first
 * by their idents (the owner's ask, 2026-10-22). On the phone, at once,
 * where each letter's question waited on the planner.
 */
export function searchIndex(index: AirportIndex, typed: string, limit = 8, near: readonly { lat: number; lon: number }[] = []): AirportSearchRow[] {
  const query = typed.trim().toUpperCase();
  if (!query) return [];
  const ranked: [number, number, number, number, string, number][] = [];
  const word = ` ${query}`;
  for (let row = 0; row < index.rows.length; row++) {
    const keys = index.keys[row]!;
    const rank = keys.includes(query) ? 0
      : keys.some(key => key.startsWith(query)) ? 1
        : index.words[row]!.includes(word) ? 2 : -1;
    if (rank >= 0) {
      ranked.push([rank, index.rows[row]![4], index.names[row]!.startsWith(query) ? 0 : 1, nearness(index, row, near), index.rows[row]![0], row]);
    }
  }
  ranked.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3] || (a[4] < b[4] ? -1 : a[4] > b[4] ? 1 : 0));
  return ranked.slice(0, limit).map(([, , , , , row]) => {
    const [ident, name, town, state] = index.rows[row]!;
    return { ident, name, municipality: town || null, region: state ? `US-${state}` : null, kind: "airport" };
  });
}

/** Once the page has nothing else to do: what is put off until then.
 *  Safari has no requestIdleCallback; two seconds stand in for it there. */
function useIdle(): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    const wait = window.requestIdleCallback ?? ((go: () => void) => window.setTimeout(go, 2000));
    const stop = window.cancelIdleCallback ?? window.clearTimeout;
    const id = wait(() => setIdle(true), { timeout: 4000 });
    return () => stop(id);
  }, []);
  return idle;
}

/** Once the pilot goes to type: a field of the page focused, the
 *  keyboard on its way up. */
function useFocused(): boolean {
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (focused) return;
    const go = (e: FocusEvent) => {
      if (e.target instanceof HTMLInputElement) setFocused(true);
    };
    document.addEventListener("focusin", go);
    return () => document.removeEventListener("focusin", go);
  }, [focused]);
  return focused;
}

/**
 * The index, read once the pilot goes to type -- a field focused, or
 * something typed (`wanted`), and only where the caller's search is on
 * (`enabled`; a screen that never searches never downloads or reads it)
 * -- and kept a day, as the planner says it may be; none until it is in, when the planner answers as before. Its bytes
 * are downloaded before that, once the page is idle after opening
 * (api.warmAirportIndex), so the reading finds them in the browser's
 * cache. Asked for and read as the page opened (#156), it put two long
 * tasks in the opening -- reading half a megabyte of JSON and building the
 * lookups, 95 and 64 ms at CPU 4x -- for a search the pilot may not make.
 */
export function useAirportIndex(enabled = true, wanted = false): AirportIndex | null {
  const focused = useFocused();
  useWarmAirportIndex(enabled);
  const { data } = useQuery({
    queryKey: ["airportIndex"],
    queryFn: async () => indexOf((await api.airportIndex()).airports as Entry[]),
    enabled: enabled && (wanted || focused),
    staleTime: 24 * 60 * 60_000,
    gcTime: Infinity,
    meta: { silent: true },
  });
  return data ?? null;
}

/** The index's bytes downloaded once the page is idle, by the page itself
 *  as well as by a search: the planner opens as its tabs alone, no search
 *  in sight, and the first one opened should find them there. */
export function useWarmAirportIndex(enabled = true) {
  const idle = useIdle();
  useQuery({
    queryKey: ["airportIndexWarm"],
    queryFn: api.warmAirportIndex,
    enabled: enabled && idle,
    staleTime: Infinity,
    gcTime: Infinity,
    meta: { silent: true },
  });
}
