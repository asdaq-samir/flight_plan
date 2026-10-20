/**
 * The flight's picks for each of its fields, as the address keeps them,
 * read, written, renamed and pruned in one place: the runway picked at
 * each field (`pattern`: the departure's runway out, every other field's
 * runway in), a stop's runway out (`takeoff`), the instrument procedures
 * (`procs`), points' own altitudes (`altitudes`), the altitudes given
 * to cross the procedures' fixes at (`cross`), a stop's time on the
 * ground (`ground`) and the holds (`holds`). Each was parsed by its own
 * reader, and the route's changes kept different ones: a field taken off
 * the route kept its runway and approach in the address, and came back
 * with them on old wind, and a field that became the departure kept an
 * approach that locked its takeoff runway (the 19 and 20 Oct audits).
 */
import { altitudesOf, altitudesParam, groundOf } from "./identSchema";
import { holdsOf, holdsParam, type Hold } from "./holds";
import { proceduresOf, proceduresParam, sameField, type PickedProcedure } from "./procedures";
import { patternsOf, patternsParam } from "./trafficPattern";

export const FIELD_LIST_KEYS = ["pattern", "takeoff", "procs", "altitudes", "cross", "ground", "holds"] as const;
export type FieldListKey = (typeof FIELD_LIST_KEYS)[number];

export interface FieldLists {
  pattern: Map<string, string>;
  takeoff: Map<string, string>;
  procs: PickedProcedure[];
  altitudes: Record<string, number>;
  /** By the procedure's fix, not the route's field. */
  cross: Record<string, number>;
  ground: Record<string, number>;
  holds: Hold[];
}

/** The lists from the address. */
export function fieldListsOf(params: URLSearchParams): FieldLists {
  return {
    pattern: patternsOf(params.get("pattern")),
    takeoff: patternsOf(params.get("takeoff")),
    procs: proceduresOf(params.get("procs")),
    altitudes: altitudesOf(params.get("altitudes")),
    cross: altitudesOf(params.get("cross")),
    ground: groundOf(params.get("ground")),
    holds: holdsOf(params.get("holds")),
  };
}

/** And back, for `patched()`: null where a list is empty, so its key goes. */
export function fieldListParams(lists: FieldLists): Record<FieldListKey, string | null> {
  return {
    pattern: patternsParam(lists.pattern) || null,
    takeoff: patternsParam(lists.takeoff) || null,
    procs: proceduresParam(lists.procs) || null,
    altitudes: altitudesParam(lists.altitudes) || null,
    cross: altitudesParam(lists.cross) || null,
    // Minutes are written as altitudes are: "KJVL:45".
    ground: altitudesParam(lists.ground) || null,
    holds: holdsParam(lists.holds) || null,
  };
}

const keepMap = (m: Map<string, string>, keep: (ident: string) => boolean) => new Map([...m].filter(([ident]) => keep(ident)));
const renameMap = (m: Map<string, string>, rename: (ident: string) => string) => new Map([...m].map(([ident, v]) => [rename(ident), v]));

const renameRecord = (r: Record<string, number>, rename: (ident: string) => string) =>
  Object.fromEntries(Object.entries(r).map(([ident, v]) => [rename(ident), v]));

/** A field named anew -- "ORD" made "KORD" -- in every list naming fields
 *  (not `cross`, whose idents are a procedure's fixes). */
export function renamedFieldLists(lists: FieldLists, from: string, to: string): FieldLists {
  const rename = (ident: string) => (ident === from ? to : ident);
  return {
    pattern: renameMap(lists.pattern, rename),
    takeoff: renameMap(lists.takeoff, rename),
    procs: lists.procs.map(p => ({ ...p, ident: rename(p.ident) })),
    altitudes: renameRecord(lists.altitudes, rename),
    cross: lists.cross,
    ground: renameRecord(lists.ground, rename),
    holds: lists.holds.map(h => ({ ...h, fix: rename(h.fix) })),
  };
}

export type ProcedureKind = "approach" | "arrival" | "departure";

/**
 * The lists kept for a route, and only what still fits it: picks at a
 * field the route no longer has go (by its ICAO or FAA ident alike), a
 * stop's runway out only at a stop, and -- where `kindOf` knows a
 * procedure's kind -- an approach or an arrival only at a field the route
 * lands at, a departure only at one it leaves. A waypoint's own altitude
 * is kept while the waypoint is on the route, a hold while its point is, a
 * time on the ground only at a stop, and the crossing altitudes only while
 * a procedure is picked to cross them on.
 */
export function prunedFieldLists(lists: FieldLists, route: { dep: string | null; stops: string[]; dest: string | null },
  kindOf?: (p: PickedProcedure) => ProcedureKind | undefined): FieldLists {
  const fields = [route.dep, ...route.stops, route.dest].filter((i): i is string => !!i);
  const on = (ident: string, among: string[] = fields) => among.some(f => sameField(f, ident));
  const landed = [...route.stops, ...(route.dest ? [route.dest] : [])];
  const leftFrom = [...(route.dep ? [route.dep] : []), ...route.stops];
  const procs = lists.procs.filter(p => {
    if (!on(p.ident)) return false;
    const kind = kindOf?.(p);
    if (kind === "departure") return on(p.ident, leftFrom);
    if (kind === "approach" || kind === "arrival") return on(p.ident, landed);
    return true;
  });
  return {
    pattern: keepMap(lists.pattern, ident => on(ident)),
    takeoff: keepMap(lists.takeoff, ident => on(ident, route.stops) || (!!route.dep && route.dep === route.dest && on(ident, [route.dep]))),
    procs,
    altitudes: Object.fromEntries(Object.entries(lists.altitudes).filter(([ident]) => on(ident))),
    cross: procs.length ? lists.cross : {},
    ground: Object.fromEntries(Object.entries(lists.ground).filter(([ident]) => on(ident, route.stops))),
    holds: lists.holds.filter(h => on(h.fix)),
  };
}
