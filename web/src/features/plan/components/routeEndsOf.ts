import type { Runway } from "../../../lib/api/types";
import { sameField } from "../../../lib/procedures";
import type { NavLogRow } from "./navlog/rows";

/** A field of the route as the half sheet's ends say it (RouteEnds). */
export interface RouteEnd {
  row: NavLogRow;
  runways: Runway[] | null;
  /** The runway end picked for its pattern, as painted ("24"). */
  pattern: string | null;
  /** Its procedures in the route, as the route's box names them. */
  procedures: { kind: "approach" | "arrival" | "departure"; label: string }[];
}

/** The route's ends from its rows and what is picked at each field. */
export function routeEndsOf(rows: NavLogRow[], fields: { ident: string; runways: Runway[] | null }[], patterns: Map<string, string>,
  procedures: { ident: string; kind: "approach" | "arrival" | "departure"; label: string }[]): [RouteEnd, RouteEnd] | null {
  const first = rows[0], last = rows.at(-1);
  if (!first || !last || first === last || !("airport" in first) || !("airport" in last)) return null;
  const end = (row: NavLogRow & { airport: { ident: string } }): RouteEnd => ({
    row,
    runways: fields.find(f => f.ident === row.airport.ident)?.runways ?? null,
    pattern: patterns.get(row.airport.ident) ?? null,
    procedures: procedures.filter(p => sameField(p.ident, row.airport.ident)),
  });
  return [end(first), end(last)];
}
