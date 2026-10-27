/**
 * Undo and redo for the route, kept from the address (PlanWorkspace keeps
 * the plan in it): the owner's rule is to make the pilot aware and never
 * stop them, so a Direct to, a route replaced, a stop removed or the
 * route cleared goes through at once, and can be taken back.
 *
 * The history is of what the address says of the plan, not of the buttons
 * that changed it: every way the route changes (the box, a card's Fly
 * Here, Direct to, a food or fuel stop, a procedure picked) writes the
 * address, so watching it catches each one, and the next way added is
 * caught too. The native app keeps the same history (ios PlanHistory).
 */

/** The address's keys that are the plan: the route, what was picked at
 *  its fields (lib/fieldLists), its altitude and its Class B choice. Not
 *  the page's own (the card open, the panel, the departure time). */
export const PLAN_KEYS = [
  "dep", "dest", "stops", "direct", "was", "fuel", "alternate",
  "altitude_ft", "altitude_nearest", "altitude_choice", "class_b", "class_b_via",
  "pattern", "takeoff", "auto", "procs", "altitudes", "cross", "ground", "holds",
] as const;

/** The plan as the address has it: only the keys set. */
export type PlanState = Readonly<Record<string, string>>;

export function planStateOf(params: URLSearchParams): PlanState {
  const state: Record<string, string> = {};
  for (const key of PLAN_KEYS) {
    const value = params.get(key);
    if (value) state[key] = value;
  }
  return state;
}

export function sameState(a: PlanState, b: PlanState): boolean {
  return PLAN_KEYS.every(key => (a[key] ?? "") === (b[key] ?? ""));
}

/** The address with the plan put back as it was, the page's own keys
 *  left as they are. */
export function restored(params: URLSearchParams, state: PlanState): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of PLAN_KEYS) {
    const value = state[key];
    if (value) next.set(key, value);
    else next.delete(key);
  }
  return next;
}

/** Changes the page makes by itself just after one of the pilot's (the
 *  ident typed made the field's own, "ORD" to KORD; the picks at a field
 *  that left the route taken out; a runway picked into the wind) are part
 *  of that change: one Undo takes the whole of it back. */
export const SETTLE_MS = 1500;
/** As many steps back as a pilot would take; the oldest go first. */
export const LIMIT = 50;

export interface PlanHistory {
  readonly past: readonly PlanState[];
  readonly now: PlanState;
  readonly future: readonly PlanState[];
  /** When the last change was taken in, for SETTLE_MS. */
  readonly at: number;
}

/** The history of a page opened on this plan: the changes the page makes
 *  to it as it loads are not the pilot's to undo. */
export const started = (now: PlanState, at: number): PlanHistory => ({ past: [], now, future: [], at });

/** The plan as the address has it now, taken in: a change of the pilot's
 *  is a step back, with what it did in words where it took something away
 *  (`note`, for the Undo bar); one the page made as it settled is folded
 *  into the step before. */
export function observed(h: PlanHistory, next: PlanState, at: number): { history: PlanHistory; note: string | null } {
  if (sameState(h.now, next)) return { history: h, note: null };
  if (at - h.at < SETTLE_MS) return { history: { ...h, now: next }, note: null };
  return {
    history: { past: [...h.past, h.now].slice(-LIMIT), now: next, future: [], at },
    note: describeEdit(h.now, next),
  };
}

/** One step back: the plan to put in the address, or null with none. */
export function undone(h: PlanHistory, at: number): PlanHistory | null {
  const back = h.past.at(-1);
  if (!back) return null;
  return { past: h.past.slice(0, -1), now: back, future: [h.now, ...h.future], at };
}

/** The step taken back, again. */
export function redone(h: PlanHistory, at: number): PlanHistory | null {
  const again = h.future[0];
  if (!again) return null;
  return { past: [...h.past, h.now], now: again, future: h.future.slice(1), at };
}

const listOf = (value: string | undefined) => (value ? value.split(",").filter(Boolean) : []);

/** What a change took away, in the bar's words ("Route Cleared", "KMSN
 *  removed"); null for one that only added or changed a figure, which the
 *  keyboard still undoes. */
export function describeEdit(before: PlanState, after: PlanState): string | null {
  const hadRoute = !!(before.dep || before.dest);
  if (hadRoute && !after.dep && !after.dest) return "Route Cleared";
  if (after.direct && after.direct !== before.direct) return `Direct to ${after.direct}`;
  if (before.dep && before.dest && (after.dep !== before.dep || after.dest !== before.dest)) return "Route Replaced";
  const gone = listOf(before.stops).filter(stop => !listOf(after.stops).includes(stop));
  if (gone.length === 1) return `${gone[0]} Removed`;
  if (gone.length > 1) return "Stops Removed";
  if (listOf(after.procs).length < listOf(before.procs).length) return "Procedure Removed";
  if (listOf(after.holds).length < listOf(before.holds).length) return "Hold Removed";
  return null;
}
