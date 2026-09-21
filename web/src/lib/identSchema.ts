import { z } from "zod";

/** An airport ident, normalized (trimmed, uppercased) and shape-checked
 *  -- the same 3-4 alphanumeric character rule springboot-app's own
 *  SaveFlightRequest already enforces server-side. Every dep/dest form
 *  in this app (Plan, Label, Playground's two panels) used to hand-copy
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
