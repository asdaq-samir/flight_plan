import { useQuery } from "@tanstack/react-query";
import { api } from "./api/client";
import type { AirportSearchRow } from "./useAirportSearch";

/** One airport of the planner's index (vfr.airports.search_index): the
 *  ident pilots use, its name, town and state, its size rank (0 large to
 *  3 other), and the idents it is also found by. */
type Entry = [ident: string, name: string, town: string, state: string, size: number, ...others: string[]];

export interface AirportIndex {
  rows: Entry[];
  /** Every ident a row goes by, whole. */
  exact: Map<string, number[]>;
  /** Every ident and every word of a name and its town, each with its
   *  row, sorted for a prefix to be found by bisection. */
  idents: [string, number][];
  words: [string, number][];
}

const byKey = (a: [string, number], b: [string, number]) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]);

/** The index's lookups, made once as it arrives: the planner's own
 *  (_search_index_of), so the phone answers as it does. */
export function indexOf(rows: Entry[]): AirportIndex {
  const exact = new Map<string, number[]>();
  const idents: [string, number][] = [];
  const words: [string, number][] = [];
  rows.forEach(([ident, name, town, , , ...others], row) => {
    for (const key of new Set([ident.toUpperCase(), ...others])) {
      exact.set(key, [...(exact.get(key) ?? []), row]);
      idents.push([key, row]);
    }
    for (const word of new Set(`${name} ${town}`.toUpperCase().split(/\s+/).filter(Boolean))) words.push([word, row]);
  });
  idents.sort(byKey);
  words.sort(byKey);
  return { rows, exact, idents, words };
}

/** The rows of `keys` whose key starts with `query`. */
function prefixed(keys: [string, number][], query: string): Set<number> {
  let low = 0, high = keys.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (keys[middle]![0] < query) low = middle + 1;
    else high = middle;
  }
  const found = new Set<number>();
  for (let at = low; at < keys.length && keys[at]![0].startsWith(query); at++) found.add(keys[at]![1]);
  return found;
}

/**
 * The airports answering what is typed, as the planner's search_airports
 * answers: the ident typed whole first, then the idents that start with
 * it, then the fields with a word of their name or town that does; the
 * bigger fields first in each, then by ident; eight at most. On the phone,
 * at once, where each letter's question waited on the planner.
 */
export function searchIndex(index: AirportIndex, typed: string, limit = 8): AirportSearchRow[] {
  const query = typed.trim().toUpperCase();
  if (!query) return [];
  const ranked: [number, number, string, number][] = [];
  const add = (rank: number, row: number) => ranked.push([rank, index.rows[row]![4], index.rows[row]![0], row]);
  if (!query.includes(" ")) {
    const exact = new Set(index.exact.get(query) ?? []);
    const ident = new Set([...prefixed(index.idents, query)].filter(row => !exact.has(row)));
    const word = [...prefixed(index.words, query)].filter(row => !exact.has(row) && !ident.has(row));
    exact.forEach(row => add(0, row));
    ident.forEach(row => add(1, row));
    word.forEach(row => add(2, row));
  } else {
    // More than a word: a scan, as the planner's, of each row's idents
    // whole and from their start, and its name and town from a word's.
    index.rows.forEach(([ident, name, town, , , ...others], row) => {
      const keys = [ident.toUpperCase(), ...others];
      if (keys.includes(query)) add(0, row);
      else if (keys.some(key => key.startsWith(query))) add(1, row);
      else if (` ${name} ${town}`.toUpperCase().includes(` ${query}`)) add(2, row);
    });
  }
  ranked.sort((a, b) => a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0));
  return ranked.slice(0, limit).map(([, , , row]) => {
    const [ident, name, town, state] = index.rows[row]!;
    return { ident, name, municipality: town || null, region: state ? `US-${state}` : null, kind: "airport" };
  });
}

/** The index, asked for once a search is about and kept a day, as the
 *  planner says it may be; none until it is in, when the planner answers
 *  as before. */
export function useAirportIndex(enabled = true): AirportIndex | null {
  const { data } = useQuery({
    queryKey: ["airportIndex"],
    queryFn: async () => indexOf((await api.airportIndex()).airports as Entry[]),
    enabled,
    staleTime: 24 * 60 * 60_000,
    gcTime: Infinity,
    meta: { silent: true },
  });
  return data ?? null;
}
