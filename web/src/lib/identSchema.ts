import { z } from "zod";

/** An airport ident, normalized (trimmed, uppercased) and shape-checked
 *  -- the same 3-4 alphanumeric character rule springboot-app's own
 *  SaveFlightRequest already enforces server-side. Every dep/dest form
 *  in this app (Plan and Train) used to hand-copy
 *  its own trim/uppercase/empty-check; this is the one place that
 *  logic lives now. `.safeParse(raw).data` is `undefined` for anything
 *  that doesn't fit -- callers treat that the same way they treated an
 *  empty string before: don't submit.
 */
export const identSchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{3,4}$/, "must be a 3-4 character airport ident");

/** A valid ident from an address parameter, or "" -- a workspace's
 *  queries run only on a route both ends of which are real. */
export function identOf(value: string | null | undefined): string {
  return identSchema.safeParse(value ?? "").data ?? "";
}

/** A stop's ident: an airport's, or a named fix's -- a VFR waypoint
 *  (VPBNG), a GPS waypoint -- two to five letters and digits. */
export const stopSchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,5}$/, "must be a 2-5 character airport or waypoint ident");

/** The stops a route makes on the way, from the address's `stops`
 *  ("KDSM,VPBNG"): each a valid ident, in order. */
export function stopsOf(value: string | null | undefined): string[] {
  return (value ?? "").split(",").map(s => stopSchema.safeParse(s).data ?? "").filter(Boolean);
}

/** The most stops a route makes: the planner's own limit (MAX_STOPS). */
export const MAX_STOPS = 8;

/** A route the planner can plan, or null: both ends valid idents, and no
 *  airport straight after itself -- a route from an airport to itself is
 *  a round trip once it lands somewhere between. Plan's and Train's forms
 *  and hooks each used to decide this for themselves, three different
 *  ways -- Train's form let a same-airport route through, and its chart
 *  read then asked for that corridor. */
export function routeOf(
  dep: string | null | undefined, dest: string | null | undefined, stops: string[] = [],
): { dep: string; dest: string } | null {
  const d = identOf(dep), a = identOf(dest);
  if (!d || !a) return null;
  const idents = [d, ...stops, a];
  return idents.every((ident, i) => i === 0 || ident !== idents[i - 1]) ? { dep: d, dest: a } : null;
}

/** "C81 → KMSN → KDLH": a route's airports in order, as the capsule and a
 *  saved flight name it. */
export const routeName = (dep: string, dest: string, stops: string[] = []) => [dep, ...stops, dest].join(" → ");

